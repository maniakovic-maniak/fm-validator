// formula-pattern-consistency-check.js — L10 (fm-validator book-mining:
// "Excel for Auditors", Jelen & Dowell — Formula Auditing chapter).
//
// Formalizes what Excel's own native green-triangle "formula differs from
// surrounding cells" warning does — and what a user can permanently
// dismiss via "Ignore Error" (per the same book chapter's own warning
// about that). A programmatic, formula-text-based check can't be silently
// suppressed the way the UI indicator can.
//
// Independently backed by THREE sources, not just one:
//   - Excel for Auditors: the "Reset Ignored Errors" gotcha (L10 itself)
//   - FAST Standard 3.02-01: "Formulas must be consistent... Series
//     calculations must be constructed from consistent formulas along
//     the axis of presentation."
//   - ICAEW Financial Modelling Code, Principle #12: "Keep formulas
//     consistent across ranges" — "Make formulas strictly consistent
//     across formula blocks... Make any inconsistent formulas, if used
//     for a good reason, immediately apparent."
//
// METHOD: for each row of consecutive formula cells, normalize every
// formula into a relative-offset template (Excel's own R1C1-style
// notation: each same-sheet cell reference becomes R[+n]C[+m] relative
// to the formula's own cell, with $-anchored references kept absolute).
// Two formulas with the same template are structurally identical once
// you account for normal copy-across drift. A cell whose template
// differs from the row's dominant (majority) template is flagged.
//
// FIX (found via testing, mirroring today's earlier _extract_refs
// lesson): a naive per-cell-reference regex would misinterpret a
// sheet-qualified reference like "Sheet1!A1" — matching "Sheet1" as if
// "Sheet" + row "1" were a bare cell reference. Sheet-qualified
// references are masked out and compared as opaque literal tokens
// before the same-sheet reference regex runs, exactly the same
// masking-before-matching approach used in recalc_check.py's
// _extract_refs fix (L23) earlier this session.
//
// SCOPE: row-direction consistency only for this first pass (matching a
// horizontal time-series layout, the dominant pattern per FAST Standard
// 2.01-07 "Present information horizontally" and ICAEW "Display time
// periods horizontally"). Column-direction (vertical) consistency is a
// documented, deliberate gap for a future pass, not silently ignored.

function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const SHEET_QUALIFIED_RE = /((?:'[^']+'|[A-Za-z0-9_]+)!)(\$?)([A-Z]{1,3})(\$?)(\d+)(?::(\$?)([A-Z]{1,3})(\$?)(\d+))?/g;
const CELL_REF_RE = /(\$?)([A-Z]{1,3})(\$?)(\d+)/g;

/** Normalizes a formula into a relative-offset template anchored at
 * (baseRow, baseCol) — the cell the formula itself lives in.
 *
 * FIX (found via reasoning through a real, common pattern before testing,
 * not after a false positive on a real file): an earlier version treated
 * ANY sheet-qualified reference as fully opaque literal text. That would
 * false-flag an extremely common, legitimate pattern: a row referencing
 * consecutive columns on a Timing sheet (Timing!C7, Timing!D7, Timing!E7,
 * ...) — genuinely consistent (each cell's local column shift matches the
 * Timing-sheet column shift), but compared as literally different text
 * under the opaque-token approach. Sheet-qualified references are now
 * ALSO normalized to relative offsets for their cell/range portion — only
 * the sheet name itself stays literal (sheet identity shouldn't shift
 * copy-across the way a row of periods does). */
function normalizeFormula(formula, baseRow, baseCol) {
  if (!formula) return formula;

  // Two-pass with placeholder masking — NOT a direct two-pass replace on
  // the same text. Confirmed via direct reasoning before testing: the
  // normalized sheet-token output itself (e.g. "Sheet1!C[1]R[0]") still
  // contains a letter+digit substring ("t1", from "Sheet1") that
  // CELL_REF_RE would re-match and corrupt if run directly on that
  // output — the exact same class of bug as recalc_check.py's
  // _extract_refs fix (L23) earlier this session. Placeholders use a
  // control character that can't appear in real formula text, so they
  // can't collide with anything CELL_REF_RE or the formula itself contains.
  const sheetTokens = [];
  let masked = formula.replace(
    SHEET_QUALIFIED_RE,
    (m, sheetPrefix, d1, col1, d1r, row1, d2, col2, d2r, row2) => {
      const c1 = colToNum(col1);
      const r1 = parseInt(row1, 10);
      const rowTok1 = d1r ? `R${r1}` : `R[${r1 - baseRow}]`;
      const colTok1 = d1 ? `C${c1}` : `C[${c1 - baseCol}]`;
      let normalized = `${sheetPrefix}${rowTok1}${colTok1}`;
      if (col2 && row2) {
        const c2 = colToNum(col2);
        const r2 = parseInt(row2, 10);
        const rowTok2 = d2r ? `R${r2}` : `R[${r2 - baseRow}]`;
        const colTok2 = d2 ? `C${c2}` : `C[${c2 - baseCol}]`;
        normalized += `:${rowTok2}${colTok2}`;
      }
      sheetTokens.push(normalized);
      return `\u0000${sheetTokens.length - 1}\u0000`;
    }
  );

  masked = masked.replace(CELL_REF_RE, (match, colDollar, colLetters, rowDollar, rowDigits) => {
    const colNum = colToNum(colLetters);
    const rowNum = parseInt(rowDigits, 10);
    const colTok = colDollar ? `C${colNum}` : `C[${colNum - baseCol}]`;
    const rowTok = rowDollar ? `R${rowNum}` : `R[${rowNum - baseRow}]`;
    return `${rowTok}${colTok}`;
  });

  masked = masked.replace(/\u0000(\d+)\u0000/g, (m, idx) => sheetTokens[parseInt(idx, 10)]);
  return masked;
}

const MIN_ROW_LENGTH = 4;       // need a meaningful run to establish "the pattern"
const MIN_MAJORITY_FRACTION = 0.7; // dominant template must clearly be the norm, not a coin flip
const MIN_MAJORITY_COUNT = 3;      // and be an actual established pattern, not 2 cells agreeing by chance

// FIX (found via real testing against The Bend): a row total — e.g.
// "=SUM(C174:H174)" sitting after a run of period-by-period cells in the
// same row — is a legitimate, DELIBERATE structural difference (FAST
// 3.01-05 "Include display totals on all flows"; ICAEW's dashboard/
// summary conventions), not a formula-consistency defect. Without this
// exclusion, every row-total cell in a real model would be false-flagged
// against the period cells' majority pattern. A cell is treated as a row
// total (and excluded from flagging, though still counted toward the
// row's total formula-cell count) if its formula is a single SUM/
// SUBTOTAL/AVERAGE call whose range starts within this row and covers at
// least 2 cells.
const ROW_TOTAL_RE = /^(SUM|SUBTOTAL|AVERAGE)\s*\(\s*(?:\d+\s*,\s*)?\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)$/i;

function isLikelyRowTotal(formula, rowNum) {
  if (!formula) return false;
  const m = ROW_TOTAL_RE.exec(formula.trim());
  if (!m) return false;
  const [, , , r1, , r2] = m;
  // Range must be entirely within (or equal to) this same row — a
  // horizontal total — not a vertical SUM down a column, which is a
  // completely different, non-total pattern this exclusion isn't for.
  return parseInt(r1, 10) === rowNum && parseInt(r2, 10) === rowNum;
}

function checkFormulaPatternConsistency(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      const formulaCells = [];
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (cell.formula) formulaCells.push({ cell, colNum });
      });
      if (formulaCells.length < MIN_ROW_LENGTH) return;

      const templates = formulaCells.map(c => normalizeFormula(c.cell.formula, rowNum, c.colNum));
      const counts = {};
      templates.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
      const modeTemplate = Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b));
      const modeCount = counts[modeTemplate];

      if (modeCount < MIN_MAJORITY_COUNT) return;
      if (modeCount / formulaCells.length < MIN_MAJORITY_FRACTION) return;

      formulaCells.forEach((c, i) => {
        if (templates[i] === modeTemplate) return;
        if (isLikelyRowTotal(c.cell.formula, rowNum)) return;
        findings.push({
          sheet: ws.name,
          cell: c.cell.address,
          formula: c.cell.formula.length > 120 ? c.cell.formula.slice(0, 120) + '…' : c.cell.formula,
          rowMajorityCount: modeCount,
          rowTotalCount: formulaCells.length,
          note: `${ws.name}!${c.cell.address}'s formula structure differs from the majority pattern used by the other ${modeCount} formula cell(s) in row ${rowNum} (out of ${formulaCells.length} formula cells checked). This is the same signal Excel's own "inconsistent formula" warning uses — but unlike that warning, this check cannot be permanently dismissed by clicking "Ignore Error".`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags formula cells whose structure (cell references normalized to relative offsets) differs from the dominant pattern used by the rest of their row — only rows with at least 4 formula cells and a clear majority pattern (>=70%, >=3 cells) are evaluated, to avoid flagging genuinely heterogeneous rows that never had a single intended pattern. A cell matching a horizontal SUM/SUBTOTAL/AVERAGE row-total pattern is excluded from flagging — a display total differing structurally from its row is deliberate (FAST 3.01-05), not a defect. Row-direction (horizontal) consistency only in this pass; column-direction consistency is a deliberate, documented gap for a future pass, not silently skipped.',
  };
}

module.exports = { checkFormulaPatternConsistency, normalizeFormula };
