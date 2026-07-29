// mid-row-formula-regime-change-check.js
//
// Found via an independent review directly disproving the automated
// audit's own output: Financial Statements!row 89 ("Equity
// Contributions") uses one formula template for columns G-L (a
// cumulative balance reference) and a completely different template
// for columns M onward (a period-flow reference, wrapped in an IF).
// Confirmed directly: this is the exact cause of a downstream equity
// check reaching $805.8m (row 94). The same clean break was confirmed
// on rows 90 and 91 too.
//
// Tested the EXISTING formula-pattern-consistency-check.js against
// this exact row before building anything new, rather than assuming
// a gap existed: it returned zero findings, and tracing why revealed
// precisely why — that check requires a clear majority template
// (>=70% of cells) before flagging anything, a deliberate,
// documented anti-noise safeguard. This row splits 6 cells vs 12
// cells (66.7%) — just under that threshold, so NEITHER side reads
// as "the dominant pattern, with an outlier" to that check. But a
// clean split into two internally-consistent blocks, with exactly
// one transition point, is arguably the MORE suspicious shape, not
// the less — a genuine copy-paste error or model surgery boundary,
// not random per-cell noise. This is a complementary detection
// strategy, not a replacement: it looks for a clean two-block split
// specifically, rather than a majority-vs-outlier pattern.
//
// Reuses normalizeFormula from formula-pattern-consistency-check.js
// directly, rather than duplicating that logic.

const { normalizeFormula } = require('./formula-pattern-consistency-check');

const MIN_SEGMENT_LENGTH = 3; // each side of the split must be a genuine run, not a single "first period differs" setup cell
const MIN_ROW_LENGTH = 8;     // need enough cells total for a two-block split to be meaningful at all

function checkMidRowFormulaRegimeChange(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      const seq = [];
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (!cell.formula) return;
        seq.push({ colNum, address: cell.address, template: normalizeFormula(cell.formula, rowNum, colNum), formula: cell.formula });
      });
      if (seq.length < MIN_ROW_LENGTH) return;

      // Find the row's own label, looking left of the first formula cell.
      let label = null;
      const firstCol = seq[0].colNum;
      for (let c = firstCol - 1; c >= Math.max(1, firstCol - 8); c--) {
        const v = row.getCell(c).value;
        if (typeof v === 'string' && v.trim()) { label = v; break; }
      }

      // Look for exactly one transition point: everything before it is
      // template A, everything from it onward is template B, A !== B,
      // and both sides meet the minimum segment length.
      for (let splitIdx = MIN_SEGMENT_LENGTH; splitIdx <= seq.length - MIN_SEGMENT_LENGTH; splitIdx++) {
        const before = seq.slice(0, splitIdx);
        const after = seq.slice(splitIdx);
        const beforeTemplate = before[0].template;
        const afterTemplate = after[0].template;
        if (beforeTemplate === afterTemplate) continue;
        const beforeConsistent = before.every(s => s.template === beforeTemplate);
        const afterConsistent = after.every(s => s.template === afterTemplate);
        if (beforeConsistent && afterConsistent) {
          findings.push({
            sheet: ws.name, rowNum, label,
            splitCell: after[0].address,
            beforeTemplate, afterTemplate,
            beforeCount: before.length, afterCount: after.length,
            beforeSample: before[0].formula, afterSample: after[0].formula,
            note: `${ws.name}!row${rowNum}${label ? ` ("${label}")` : ''} switches formula shape cleanly at ${after[0].address}: ${before.length} period(s) use one formula pattern (e.g. "${before[0].formula}"), then every period from ${after[0].address} onward uses a completely different pattern (e.g. "${after[0].formula}"). This can be a genuine, intentional boundary (e.g. an actuals-to-forecast transition, or a construction-to-operations phase change) — but it is worth confirming deliberately, since the same clean, single-point shape is also a common signature of a copy-paste error or an incomplete model-surgery boundary.`,
          });
          break; // one finding per row is enough — don't also report every other possible split point
        }
      }
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} row(s) show a clean formula-template regime change at a single column, splitting the row into two internally-consistent but mutually different blocks.`
      : 'No row was found with a clean, single-point formula-template regime change.',
  };
}

module.exports = { checkMidRowFormulaRegimeChange };
