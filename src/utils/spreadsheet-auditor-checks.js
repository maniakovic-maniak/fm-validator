// spreadsheet-auditor-checks.js — G8-G11, inspired by patterns found in
// the (verified real) petehottelet/spreadsheet-auditor project. Each
// deliberately leans on peer-comparison or cached-value reconciliation
// rather than guessing business logic in isolation — the same lesson
// learned from G1/G7's false-positive fixes this session: a check that
// asks "does this look wrong on its own" is much noisier than one that
// asks "does this differ from its own peers, or from an independently
// computable expectation".

const AGG_RANGE_RE = /\b(SUM|AVERAGE|COUNT|COUNTA|MAX|MIN)\s*\(\s*\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)\s*\)/gi;
const CHECK_LABEL_RE = /\b(total|subtotal|sum)\b/i;
const IFERROR_RE = /\bIFERROR\s*\(/gi;
const IFNA_RE = /\bIFNA\s*\(/gi;

function colToNum(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}
function numToCol(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ── G8: off-by-one ranges, via peer comparison ──────────────────────────
// A range's own plausibility is hard to judge in isolation. Comparing it
// against structurally-identical sibling formulas (same function, same
// range start, same orientation) is much more reliable — if 9 of 10 rows
// in a "Total" column sum 14 periods and one sums only 13, that's a
// strong, well-evidenced signal, not a guess about business logic.
function checkOffByOneRanges(cellScoreIndex) {
  const horizontalGroups = {}; // key: ownCol|SUM|startCol -> [{key, endCol, ownRow}]
  const verticalGroups = {};   // key: ownRow|SUM|startRow -> [{key, endRow, ownCol}]

  for (const [key, info] of Object.entries(cellScoreIndex)) {
    if (!info.formulaText) continue;
    const [sheet, addr] = key.split('!');
    const ownMatch = addr.match(/^([A-Z]+)(\d+)$/);
    if (!ownMatch) continue;
    const [, ownCol, ownRowStr] = ownMatch;
    const ownRow = parseInt(ownRowStr, 10);

    let m;
    AGG_RANGE_RE.lastIndex = 0;
    while ((m = AGG_RANGE_RE.exec(info.formulaText)) !== null) {
      const [, fn, startCol, startRowStr, endCol, endRowStr] = m;
      const startRow = parseInt(startRowStr, 10);
      const endRow = parseInt(endRowStr, 10);

      if (startRow === endRow) {
        // Horizontal range (same row, spans columns) — compare end column across rows.
        // Exclude cumulative/running-total formulas (end column equals this
        // cell's OWN column, e.g. E121=SUM($C120:E120)) — a legitimate,
        // common technique (fixed anchor, growing end as it's copied
        // across a row), structurally different from a fixed-width total
        // and not comparable to one.
        if (endCol.toUpperCase() === ownCol) continue;
        const gkey = `${sheet}|${ownCol}|${fn.toUpperCase()}|${startCol}`;
        (horizontalGroups[gkey] ||= []).push({ key, endCol: endCol.toUpperCase(), ownRow });
      } else if (startCol === endCol) {
        // Vertical range (same column, spans rows) — compare end row across columns.
        if (endRow === ownRow) continue; // same reasoning, vertical orientation
        const gkey = `${sheet}|${ownRow}|${fn.toUpperCase()}|${startRow}`;
        (verticalGroups[gkey] ||= []).push({ key, endRow, ownCol });
      }
    }
  }

  const findings = [];

  for (const members of Object.values(horizontalGroups)) {
    if (members.length < 3) continue; // need a real peer group to trust a mode
    const counts = {};
    members.forEach(m => { counts[m.endCol] = (counts[m.endCol] || 0) + 1; });
    const mode = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    if (counts[mode] < members.length * 0.6) continue; // no clear majority shape — too ambiguous to trust
    members.forEach(m => {
      if (m.endCol !== mode && colToNum(m.endCol) < colToNum(mode)) {
        findings.push({ cell: m.key, expectedEndCol: mode, actualEndCol: m.endCol, peerCount: members.length });
      }
    });
  }

  for (const members of Object.values(verticalGroups)) {
    if (members.length < 3) continue;
    const counts = {};
    members.forEach(m => { counts[m.endRow] = (counts[m.endRow] || 0) + 1; });
    const mode = parseInt(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0], 10);
    if (counts[mode] < members.length * 0.6) continue;
    members.forEach(m => {
      if (m.endRow !== mode && m.endRow < mode) {
        findings.push({ cell: m.key, expectedEndRow: mode, actualEndRow: m.endRow, peerCount: members.length });
      }
    });
  }

  return { applicable: true, flaggedCount: findings.length, findings };
}

// ── G9: a SUM/aggregate formula's cached result doesn't match an
// independently-computed sum of its own EXPLICIT range's cached values ──
// Deliberately does NOT guess what block a "Total"-labeled cell should
// cover from its position — testing against real files showed that
// approach produces heavy false positives on dashboard-style layouts,
// where unrelated metrics (Revenue, EBITDA, Cash) are stacked in the
// same column above an unrelated "Total Debt" link, not genuine
// components of a total. Using the formula's own EXPLICIT range removes
// the guesswork entirely, and has a valuable side effect: it directly
// detects stale cached values (the file wasn't recalculated/saved with
// calculation enabled), which every pipeline run has only ever been able
// to caveat generically until now.
function checkAggregateResultMismatch(workbook) {
  const findings = [];
  const TOLERANCE = 1;

  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (!cell.formula || typeof cell.result !== 'number') return;
        const m = AGG_RANGE_RE.exec(cell.formula);
        AGG_RANGE_RE.lastIndex = 0; // exec with /g is stateful — reset per cell
        if (!m) return;
        // Require the matched call to BE the entire formula (allowing
        // only surrounding whitespace) — a formula like F16+SUM(F18:F22)
        // has the aggregate as only one term of a larger expression, and
        // comparing just that fragment's range against the full
        // formula's cached result will always mismatch by whatever the
        // other terms contribute. Confirmed as a real bug via testing:
        // this exact pattern (SUM(range)+another_cell) produced two
        // false positives before this guard was added.
        if (m[0].trim() !== cell.formula.trim()) { AGG_RANGE_RE.lastIndex = 0; return; }
        const [, fn, startColLetter, startRowStr, endColLetter, endRowStr] = m;
        if (fn.toUpperCase() !== 'SUM') return; // AVERAGE/COUNT/MAX/MIN need different comparison logic, not a simple independent re-sum
        const startCol = colToNum(startColLetter), endCol = colToNum(endColLetter);
        const startRow = parseInt(startRowStr, 10), endRow = parseInt(endRowStr, 10);
        if ((endCol - startCol + 1) * (endRow - startRow + 1) > 500) return; // guard against pathological huge ranges

        let independentSum = 0, numericCount = 0;
        for (let c = startCol; c <= endCol; c++) {
          for (let r = startRow; r <= endRow; r++) {
            const rc = worksheet.getRow(r).getCell(numToCol(c));
            const v = rc.formula ? rc.result : rc.value;
            if (typeof v === 'number') { independentSum += v; numericCount++; }
          }
        }
        if (numericCount === 0) return;

        if (Math.abs(cell.result - independentSum) > TOLERANCE) {
          findings.push({
            sheet: worksheet.name, cell: cell.address,
            formula: cell.formula, cachedResult: cell.result,
            independentSum, diff: cell.result - independentSum,
          });
        }
      });
    });
  });

  return { applicable: true, flaggedCount: findings.length, findings };
}

// ── G10: an aggregate range includes a row that is itself a subtotal ───
// A SUM spanning rows 2-10 where row 7 is itself labeled "Subtotal"
// likely double-counts row 7's own components alongside row 7 itself.
function checkRangeIncludesOwnTotal(cellScoreIndex, workbook) {
  const findings = [];

  for (const [key, info] of Object.entries(cellScoreIndex)) {
    if (!info.formulaText) continue;
    const [sheet] = key.split('!');
    const worksheet = workbook.getWorksheet(sheet);
    if (!worksheet) continue;

    let m;
    AGG_RANGE_RE.lastIndex = 0;
    while ((m = AGG_RANGE_RE.exec(info.formulaText)) !== null) {
      const [, fn, startCol, startRowStr, endCol, endRowStr] = m;
      if (fn.toUpperCase() !== 'SUM') continue; // AVERAGE/COUNT/MAX/MIN including a subtotal isn't the same double-count risk
      const startRow = parseInt(startRowStr, 10);
      const endRow = parseInt(endRowStr, 10);
      if (startCol !== endCol || endRow - startRow < 2) continue; // only vertical, multi-row ranges are at risk here

      // Check each row strictly INSIDE the range (not the boundary rows,
      // which are the range's own natural start/end) for a total-like label.
      for (let r = startRow + 1; r < endRow; r++) {
        const row = worksheet.getRow(r);
        let rowLabel = null;
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (rowLabel === null && typeof cell.value === 'string' && cell.value.length <= 60) rowLabel = cell.value;
        });
        if (rowLabel && CHECK_LABEL_RE.test(rowLabel)) {
          findings.push({ cell: key, range: `${startCol}${startRow}:${endCol}${endRow}`, subtotalRow: r, subtotalLabel: rowLabel });
          break; // one flag per formula is enough, even if multiple rows inside match
        }
      }
    }
  }

  return { applicable: true, flaggedCount: findings.length, findings };
}

// ── G11: IFERROR/IFNA with a suspicious, non-zero hardcoded fallback ───
// Falling back to 0 or blank is the common, usually-safe pattern (e.g.
// an early-period ratio dividing by zero). A fallback to a SPECIFIC
// non-zero hardcoded number is a much less common, higher-risk pattern —
// it can look like a plug masking whatever the real formula would have
// produced, rather than a genuine, reasoned default.
function checkSuspiciousErrorMasking(cellScoreIndex) {
  const findings = [];

  for (const [key, info] of Object.entries(cellScoreIndex)) {
    if (!info.formulaText) continue;
    const formula = info.formulaText;

    for (const re of [IFERROR_RE, IFNA_RE]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(formula)) !== null) {
        const openParenIdx = m.index + m[0].length - 1;
        let depth = 1, j = openParenIdx + 1;
        const argStart = j;
        let commaAtDepth1 = -1;
        while (j < formula.length && depth > 0) {
          if (formula[j] === '(') depth++;
          else if (formula[j] === ')') depth--;
          else if (formula[j] === ',' && depth === 1 && commaAtDepth1 === -1) commaAtDepth1 = j;
          j++;
        }
        if (commaAtDepth1 === -1) continue; // malformed or single-arg — nothing to check
        const closeParenIdx = j - 1;
        const fallbackArg = formula.slice(commaAtDepth1 + 1, closeParenIdx).trim();

        // A "suspicious" fallback is a bare numeric literal that isn't 0.
        // Anything with a cell reference, function call, or text string is
        // out of scope for this specific, narrow check.
        if (/^-?\d+(\.\d+)?$/.test(fallbackArg) && parseFloat(fallbackArg) !== 0) {
          findings.push({ cell: key, functionName: formula.slice(m.index, m.index + m[0].length - 1), fallbackValue: fallbackArg });
        }
      }
    }
  }

  return { applicable: true, flaggedCount: findings.length, findings };
}

module.exports = { checkOffByOneRanges, checkAggregateResultMismatch, checkRangeIncludesOwnTotal, checkSuspiciousErrorMasking };
