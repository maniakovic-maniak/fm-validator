// column-pattern-consistency-check.js — the column-direction sibling to
// formula-pattern-consistency-check.js, explicitly named in that file's
// own note as "a deliberate, documented gap for a future pass, not
// silently ignored." Built following a book-mining pass: Clermont,
// Hanin & Mittermeir's field-audit paper (EuSpRIG) found this exact
// pattern — a "logical equivalence class" of formulas distributed DOWN
// a column, not just across a row — catching real errors across a
// 3.03% cell error rate in 78 audited spreadsheets. A column of
// formulas that should all follow the same pattern (e.g. a running
// total, a per-line-item calculation repeated down many rows) with one
// outlier is exactly as real a defect as the row-direction case
// already checked.
//
// Reuses normalizeFormula from formula-pattern-consistency-check.js
// directly — the function is already direction-agnostic (anchored at
// baseRow/baseCol), so building a second, independent copy would be
// exactly the kind of duplicated-logic risk already fixed once this
// session (cell-label.js's independent, buggy copy of cellText).

const { normalizeFormula } = require('./formula-pattern-consistency-check');

const MIN_COL_LENGTH = 4;          // need a meaningful run to establish "the pattern" -- matches the row-direction check's own threshold
const MIN_MAJORITY_FRACTION = 0.7; // dominant template must clearly be the norm, not a coin flip
const MIN_MAJORITY_COUNT = 3;      // and be an actual established pattern, not 2 cells agreeing by chance

// The vertical analog of the row-direction check's isLikelyRowTotal —
// a column total (e.g. =SUM(C10:C50) sitting below a run of per-line
// formulas in the same column) is a legitimate, deliberate structural
// difference, not a defect.
const COL_TOTAL_RE = /^(SUM|SUBTOTAL|AVERAGE)\s*\(\s*(?:\d+\s*,\s*)?\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)$/i;

function isLikelyColumnTotal(formula, colNum) {
  if (!formula) return false;
  const m = COL_TOTAL_RE.exec(formula.trim());
  if (!m) return false;
  const [, , c1, , c2] = m;
  function colToNum(col) {
    let n = 0;
    for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }
  // Range must be entirely within (or equal to) this same column — a
  // vertical total — not a horizontal SUM across a row, which is a
  // completely different pattern this exclusion isn't for.
  return colToNum(c1) === colNum && colToNum(c2) === colNum;
}

// FIX: found via real-file testing — beyond the date-vs-number case
// above, a "Model Checks" register sheet (each row a differently-named
// validation with its own appropriate condition — "PASS"/"FAIL"/
// "CONTROLLED" text results) and plain string-literal cells ("N/A",
// "-") sitting in an otherwise-numeric column both produced the same
// class of false positive: cells that are structurally different BY
// DESIGN, not by defect, being compared against an unrelated majority.
// Generalized from a date-specific check into a broader result-type
// segmentation (date / string / number / other), so each category is
// only ever compared against its own peers.
function resultCategory(cell) {
  const v = cell.value;
  const raw = (v && typeof v === 'object' && 'result' in v) ? v.result : v;
  if (raw instanceof Date) return 'date';
  if (typeof raw === 'string') return 'string';
  if (typeof raw === 'number') return 'number';
  if (typeof raw === 'boolean') return 'boolean';
  return 'other';
}

// FIX: found via further real-file testing — even after segmenting by
// result category, a "Model Checks" register sheet still produced
// false positives, because every row's check (each testing something
// different and NAMED differently — "GST / BAS roll-forward",
// "External reliance gate", etc.) still shared the same "string"
// category (all producing PASS/FAIL/CONTROLLED). A register of
// deliberately different named checks was never meant to follow one
// shared formula pattern at all — column consistency doesn't apply to
// it conceptually, the same way it doesn't apply to a row of unrelated
// dashboard pulls. Detected via a strong, mechanical signal: a segment
// whose values are mostly drawn from a small set of common status-like
// terms is treated as a checks register and skipped entirely, rather
// than trying to flag individual "outliers" within it.
const STATUS_LIKE_VALUES = new Set(['pass', 'fail', 'ok', 'error', 'warning', 'controlled', 'n/a', 'yes', 'no', 'true', 'false']);
const STATUS_LIKE_FRACTION = 0.6; // a majority of a segment being status-like text is a strong enough signal on its own

function isLikelyChecksRegisterSegment(formulaCells) {
  const statusLikeCount = formulaCells.filter(c => {
    const v = c.cell.value;
    const raw = (v && typeof v === 'object' && 'result' in v) ? v.result : v;
    return typeof raw === 'string' && STATUS_LIKE_VALUES.has(raw.trim().toLowerCase());
  }).length;
  return statusLikeCount / formulaCells.length >= STATUS_LIKE_FRACTION;
}

function checkColumnPatternConsistency(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    // Group formula cells by column across the whole sheet -- ExcelJS
    // doesn't offer a native per-column iterator the way it does for
    // rows, so this builds the grouping directly.
    const byColumn = new Map(); // colNum -> [{cell, rowNum}]
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (!cell.formula) return;
        if (!byColumn.has(colNum)) byColumn.set(colNum, []);
        byColumn.get(colNum).push({ cell, rowNum });
      });
    });

    for (const [colNum, allFormulaCells] of byColumn) {
      // Segment by result category first -- cells producing different
      // KINDS of result (a date-metadata block, a PASS/FAIL text
      // check, a plain string literal, a real numeric calculation) are
      // different logical sections or purposes by design, not a single
      // pattern with outliers.
      const segments = new Map(); // category -> cells
      for (const c of allFormulaCells) {
        const cat = resultCategory(c.cell);
        if (!segments.has(cat)) segments.set(cat, []);
        segments.get(cat).push(c);
      }

      for (const formulaCells of segments.values()) {
        if (formulaCells.length < MIN_COL_LENGTH) continue;
        if (isLikelyChecksRegisterSegment(formulaCells)) continue;

        const templates = formulaCells.map(c => normalizeFormula(c.cell.formula, c.rowNum, colNum));
        const counts = {};
        templates.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
        const modeTemplate = Object.keys(counts).reduce((a, b) => (counts[a] >= counts[b] ? a : b));
        const modeCount = counts[modeTemplate];

        if (modeCount < MIN_MAJORITY_COUNT) continue;
        if (modeCount / formulaCells.length < MIN_MAJORITY_FRACTION) continue;

        formulaCells.forEach((c, i) => {
          if (templates[i] === modeTemplate) return;
          if (isLikelyColumnTotal(c.cell.formula, colNum)) return;
          findings.push({
            sheet: ws.name,
            cell: c.cell.address,
            formula: c.cell.formula.length > 120 ? c.cell.formula.slice(0, 120) + '…' : c.cell.formula,
            columnMajorityCount: modeCount,
            columnTotalCount: formulaCells.length,
            note: `${ws.name}!${c.cell.address}'s formula structure differs from the majority pattern used by the other ${modeCount} formula cell(s) in this column (out of ${formulaCells.length} formula cells checked, among cells producing the same kind of result). Same signal as the row-direction consistency check, applied down a column instead of across a row.`,
          });
        });
      }
    }
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags formula cells whose structure (cell references normalized to relative offsets) differs from the dominant pattern used by the rest of their column — only columns with at least 4 formula cells and a clear majority pattern (>=70%, >=3 cells) are evaluated. Cells are first segmented by cached result category (date / string / number / boolean / other), so a date-metadata block, a text-based checks register, or a stray string literal sharing a column with unrelated numeric calculations is never compared against that unrelated group. A segment dominated by common status-like text (PASS/FAIL/CONTROLLED/etc.) is skipped entirely as a likely checks register, where each row is deliberately a different named check by design — confirmed necessary via real-file testing on multiple real false-positive patterns. A cell matching a vertical SUM/SUBTOTAL/AVERAGE column-total pattern is excluded from flagging, the vertical analog of the row-direction check\'s own row-total exclusion. The column-direction sibling to formula-pattern-consistency-check.js\'s row-direction check.',
  };
}

module.exports = { checkColumnPatternConsistency };
