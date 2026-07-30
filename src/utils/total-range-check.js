// total-range-check.js — Wave 1-style deterministic check.
//
// Named in Anthropic's audit-xls skill: "any rows where the row total does
// not match the sum of its components." A literal value-recomputation
// version of this runs into Mode A's static-value limits (this pipeline
// reads cached values, not a live calculation engine — see the Scope and
// Reliance disclosure). Instead, this targets the single most common real
// cause of that symptom: a SUM() formula whose range was never updated
// after a row was inserted into the block it's meant to total, so the
// formula is internally consistent with ITS OWN range but silently
// excludes real data sitting right next to it.
//
// Deliberately narrow in scope: only handles simple, single-column,
// contiguous SUM(A2:A9)-style ranges — the overwhelmingly common case in
// real models. Multi-range SUMs (SUM(A2:A5,A8:A9)), cross-sheet SUMs, and
// row-wise (horizontal) totals are out of scope for this first pass and
// are silently skipped rather than guessed at.

const SUM_RANGE_RE = /\bSUM\s*\(\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*\)/i;

function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function checkTotalRanges(workbook) {
  // FIX (R-16): found via an independent review's claim that a large
  // share of P2 findings are duplicates, and confirmed directly: all
  // 44 instances this check produced on a real file were the exact
  // same row (PROJECTS!row11), repeated across every period-column via
  // shared-formula mechanics — genuinely one underlying defect, not 44
  // distinct ones. Aggregates by (sheet, row) before returning,
  // matching this project's own established, documented principle for
  // T0-* checks (one Issue Log entry per root cause, with a sample and
  // an instance count, not one per repeated period-column instance).
  const groups = new Map(); // "sheet!row" -> { sheet, rowNum, instances: [...] }

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const formula = cell.formula;
        if (!formula) return;
        const m = SUM_RANGE_RE.exec(formula);
        if (!m) return;

        const [, col1, row1Str, col2, row2Str] = m;
        // Only handle a genuine single-column vertical range — the
        // overwhelmingly common "total column" pattern.
        if (col1.toUpperCase() !== col2.toUpperCase()) return;
        const sumCol = colToNum(col1);
        const sumRowStart = parseInt(row1Str, 10);
        const sumRowEnd = parseInt(row2Str, 10);
        if (sumRowEnd >= rowNum) return; // range includes or is below its own cell — not a simple "total below block" pattern, skip

        // Find the TRUE contiguous run of plain-value (non-formula,
        // numeric) cells sitting directly above the total cell, walking
        // up from row (rowNum - 1) — independent of what the SUM
        // formula's own range says. Stop at any formula cell (a stacked
        // subtotal, a plain addition like L29+L30, or any other
        // calculation — none of these are raw "components", they're a
        // block boundary) or any non-numeric cell (blank/label).
        let trueBlockEnd = null;
        let cursor = rowNum - 1;
        {
          const first = ws.getCell(cursor, sumCol);
          if (!first.formula && typeof first.value === 'number') {
            trueBlockEnd = cursor;
            cursor--;
            while (cursor > 0) {
              const c = ws.getCell(cursor, sumCol);
              if (c.formula) break;
              if (typeof c.value !== 'number') break;
              cursor--;
            }
          }
        }
        if (trueBlockEnd === null) return; // total isn't immediately preceded by a value block in this column — nothing to compare
        const trueBlockStart = cursor + 1;

        // Compare the true block against the SUM's own stated range on
        // BOTH ends — real data can be excluded either because the range
        // starts too late (rows above the range are real data) or ends
        // too early (rows between the range's end and the total itself
        // are real data) — the latter is the far more common real-world
        // pattern (a row inserted just before the total). Confirmed via a
        // synthetic test: SUM(B2:B9) with a real value in B10 sitting
        // directly above the SUM cell in B11 — excluded at the end, not
        // the start — was missed until this check covered both ends.
        const missingAtStart = trueBlockStart < sumRowStart ? sumRowStart - trueBlockStart : 0;
        const missingAtEnd = trueBlockEnd > sumRowEnd ? trueBlockEnd - sumRowEnd : 0;

        if (missingAtStart > 0 || missingAtEnd > 0) {
          const excludedCount = missingAtStart + missingAtEnd;
          const parts = [];
          if (missingAtStart > 0) parts.push(`${missingAtStart} row(s) before the stated range (${col1}${trueBlockStart}:${col2}${sumRowStart - 1})`);
          if (missingAtEnd > 0) parts.push(`${missingAtEnd} row(s) after the stated range but before the total itself (${col1}${sumRowEnd + 1}:${col2}${trueBlockEnd})`);

          const key = `${ws.name}!row${rowNum}`;
          if (!groups.has(key)) groups.set(key, { sheet: ws.name, rowNum, instances: [] });
          groups.get(key).instances.push({
            cell: cell.address, formula, sumRange: `${col1}${sumRowStart}:${col2}${sumRowEnd}`,
            actualBlockRange: `${col1}${trueBlockStart}:${col2}${trueBlockEnd}`, excludedCount, parts,
          });
        }
      });
    });
  });

  const findings = [];
  for (const [, g] of groups) {
    const sample = g.instances[0];
    findings.push({
      sheet: g.sheet,
      cell: sample.cell,
      formula: sample.formula.length > 100 ? sample.formula.slice(0, 100) + '…' : sample.formula,
      sumRange: sample.sumRange,
      actualBlockRange: sample.actualBlockRange,
      excludedCount: sample.excludedCount,
      instanceCount: g.instances.length,
      note: `${g.sheet}!${sample.cell} (and ${g.instances.length - 1} other period-column instance(s) on the same row) sums ${sample.sumRange}, but a contiguous run of plain numeric values in the same column actually extends from ${sample.actualBlockRange.split(':')[0]} to ${sample.actualBlockRange.split(':')[1]} — ${sample.parts.join(' and ')} — not included in this total. This is the classic symptom of a row being inserted into a block after the SUM range was set, without the range being extended to match.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    totalInstances: [...groups.values()].reduce((sum, g) => sum + g.instances.length, 0),
    findings,
    note: 'This check compares a SUM() formula\'s own stated range against the actual contiguous run of numeric values sitting in the same column, to catch a total that silently excludes rows inserted after the range was set. It only handles simple, single-column, contiguous SUM ranges — multi-range, cross-sheet, and row-wise (horizontal) totals are out of scope for this check and are not evaluated. Findings are aggregated by (sheet, row): repeated period-column instances of the same underlying row-level defect are reported once, with an instance count.',
  };
}

module.exports = { checkTotalRanges };
