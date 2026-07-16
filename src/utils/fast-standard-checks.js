// fast-standard-checks.js — four deterministic checks directly derived
// from named, specific rules in the FAST Standard (FAST Standard 02c,
// July 2019, www.fast-standard.org), a professional financial-modelling
// design standard. Confirmed against a real copy of the standard: A1
// and A2 built earlier this session already turned out to match FAST
// 4.01-03 (no OFFSET/INDIRECT) and FAST 3.02-03 (no partial range
// references) almost verbatim — these four are new gaps the standard
// names explicitly that nothing in this pipeline checked before.
//
// Reuses cellScoreIndex (from validator-tier0.js's runTier0() result) for
// the two formula-text checks, same pattern as cell-dependency-tracer.js —
// avoids a second full-workbook scan.

// ── FAST 4.01-02: "Do not use the NPV function — ever" ─────────────────
// Rationale (FAST's own): NPV() assumes end-of-period cash flows; most
// real models don't actually have that timing, so NPV() silently
// discounts a period's cash flow within that same period rather than
// from a real anchor date. XNPV (or careful manual construction) is the
// FAST-recommended alternative. Word-boundary-safe: XNPV( must NOT match
// here, since a naive substring check on "NPV(" would also match inside
// "XNPV(" — the negative lookbehind blocks that specifically.
const BARE_NPV_RE = /(?<![A-Za-z])NPV\s*\(/i;

function checkBareNPV(cellScoreIndex) {
  const findings = [];
  for (const [key, info] of Object.entries(cellScoreIndex)) {
    if (info.formulaText && BARE_NPV_RE.test(info.formulaText)) {
      const [sheet, cell] = key.split('!');
      findings.push({ sheet, cell, formula: info.formulaText.slice(0, 120) });
    }
  }
  return { applicable: true, flaggedCount: findings.length, findings };
}

// ── FAST 3.03-07: "Never use nested IFs" ────────────────────────────────
// Deliberately paren-depth-aware, not a naive count of "IF(" occurrences —
// a formula with two SEPARATE (sibling) IF calls like
// =IF(A1>0,1,0)+IF(B1>0,1,0) is not nested and must not be flagged.
// Only a genuine IF(...IF(...)...) — a second IF( strictly inside the
// first one's own parenthesis span — counts.
function hasNestedIF(formula) {
  if (!formula) return false;
  const ifPositions = [];
  const ifRe = /\bIF\s*\(/gi;
  let m;
  while ((m = ifRe.exec(formula)) !== null) ifPositions.push(m.index);
  if (ifPositions.length < 2) return false;

  for (const start of ifPositions) {
    const openParenIdx = formula.indexOf('(', start);
    let depth = 1;
    let j = openParenIdx + 1;
    while (j < formula.length && depth > 0) {
      if (formula[j] === '(') depth++;
      else if (formula[j] === ')') depth--;
      j++;
    }
    const endIdx = j; // just past this IF's own matching close-paren
    for (const other of ifPositions) {
      if (other > openParenIdx && other < endIdx) return true;
    }
  }
  return false;
}

function checkNestedIFs(cellScoreIndex) {
  const findings = [];
  for (const [key, info] of Object.entries(cellScoreIndex)) {
    if (hasNestedIF(info.formulaText)) {
      const [sheet, cell] = key.split('!');
      findings.push({ sheet, cell, formula: info.formulaText.slice(0, 150) });
    }
  }
  return { applicable: true, flaggedCount: findings.length, findings };
}

// ── FAST 4.02-02: "Do not merge cells" ──────────────────────────────────
// FAST's own stated reason is directly relevant to a tool exactly like
// this one: "Model review or audit software also struggles with merged
// cells and may sometimes simply unmerge all cells in the process of
// running their analysis procedures."
function checkMergedCells(workbook) {
  const findings = [];
  workbook.eachSheet(ws => {
    const merges = (ws.model && ws.model.merges) ? ws.model.merges : [];
    if (merges.length > 0) {
      findings.push({ sheet: ws.name, mergeCount: merges.length, sampleRanges: merges.slice(0, 5) });
    }
  });
  return { applicable: true, flaggedCount: findings.length, findings };
}

// ── FAST 2.01-08: "Do not hide anything" (rows/columns) ─────────────────
// Distinct from the existing no_hidden_sheets check (hidden SHEETS only)
// — this covers hidden rows/columns within an otherwise-visible sheet,
// which the existing check doesn't look at.
function checkHiddenRowsColumns(workbook) {
  const findings = [];
  workbook.eachSheet(ws => {
    const hiddenRows = [];
    ws.eachRow({ includeEmpty: true }, (row, rowNum) => {
      if (row.hidden) hiddenRows.push(rowNum);
    });
    const hiddenCols = [];
    const colCount = ws.columnCount || 0;
    for (let i = 1; i <= colCount; i++) {
      const col = ws.getColumn(i);
      if (col && col.hidden) hiddenCols.push(i);
    }
    if (hiddenRows.length > 0 || hiddenCols.length > 0) {
      findings.push({
        sheet: ws.name,
        hiddenRowCount: hiddenRows.length, hiddenRows: hiddenRows.slice(0, 10),
        hiddenColCount: hiddenCols.length, hiddenCols: hiddenCols.slice(0, 10),
      });
    }
  });
  return { applicable: true, flaggedCount: findings.length, findings };
}

module.exports = { checkBareNPV, checkNestedIFs, checkMergedCells, checkHiddenRowsColumns, hasNestedIF };
