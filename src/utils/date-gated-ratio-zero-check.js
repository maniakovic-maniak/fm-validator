// date-gated-ratio-zero-check.js
//
// Found via an independent review: DEBT!F131 (DSCR), F132 (interest-
// cover ratio), and F133 (debt yield) are all structurally forced to
// zero for any period before a named milestone date (B35, resolving
// to 2030-07-31), via a formula shape like
// IF(OR(F$64<$B$35, ...), 0, <genuine ratio>). Confirmed directly.
//
// The existing findings on this model correctly observe the symptom
// ("DSCR shows 0 while distributions continue") but don't name the
// actual mechanism — that this is a deliberate, structural date gate,
// not missing data or a calculation failure. Naming the mechanism
// precisely matters because a "0" produced this way is easy to
// mistake for a genuinely catastrophic covenant breach, when it
// actually means "not yet measurable by design" — a different
// problem with a different fix (the covenant/distribution logic
// referencing this ratio should treat the gated period as N/A, not as
// a value to compare against a threshold — see the related R-3
// degenerate-covenant-branch check for what happens when it doesn't).
//
// Deliberately scoped to rows labelled with a specific covenant/ratio
// term (DSCR, ICR, interest cover, debt yield, coverage ratio) — date-
// gating alone (IF(date<milestone,...)) is an extremely common and
// often entirely legitimate pattern (hiding a future/past period, a
// blank template column, etc.), so this check does not flag it in
// general, only when it produces a numeric 0 on a row that is
// specifically a covenant/ratio test.
//
// PREVALENCE TESTED before finalizing: the broad, unscoped date<
// milestone pattern matched 363 cells on the real file and zero on
// three other real test files — but only rows with one of the
// specific covenant/ratio labels below are flagged here.

const RATIO_LABEL_TERMS = ['dscr', 'interest-cover', 'interest cover', 'debt yield', 'coverage ratio', 'icr'];

// FIX: found via testing directly against the real formula — the
// original single regex required NO parentheses at all within the
// OR() clause, but the real formula has a nested SUM(...) call inside
// it (a common, expected shape for this kind of gate), which broke
// the match entirely. Redesigned as two simpler, independent checks
// rather than one complex regex trying to match the whole nested
// shape at once: does the formula start with IF(OR( and contain a
// date-style comparison early on, and does it contain a literal
// ",0," zero-default branch — avoids the nested-parentheses matching
// problem entirely.
const STARTS_IF_OR_RE = /^IF\s*\(\s*OR\s*\(/i;
const DATE_COMPARISON_RE = /[A-Z]+\$?\d+\s*<\s*\$?[A-Z]+\$?\d+/;
const ZERO_BRANCH_RE = /,\s*0\s*,/;

function isDateGatedToZero(formula) {
  if (!STARTS_IF_OR_RE.test(formula)) return false;
  // The date comparison should appear within the OR(...) clause itself
  // — check just the early portion of the formula (comfortably inside
  // where the OR's own arguments live) rather than anywhere at all, so
  // an unrelated "<" comparison deep in the TRUE-branch calculation
  // doesn't cause a false match.
  const orClauseGuess = formula.slice(0, 80);
  if (!DATE_COMPARISON_RE.test(orClauseGuess)) return false;
  return ZERO_BRANCH_RE.test(formula);
}

function checkDateGatedRatioZero(workbook) {
  const groups = new Map(); // "sheet!row" -> { sheet, rowNum, label, cells: [...] }

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      // Find this row's own label (its first non-numeric text value).
      let label = null;
      row.eachCell({ includeEmpty: false }, cell => {
        if (label) return;
        const v = cell.value;
        if (typeof v === 'string' && v.trim() && isNaN(parseFloat(v))) label = v;
      });
      if (!label) return;
      const lowerLabel = label.toLowerCase();
      const matchedTerm = RATIO_LABEL_TERMS.find(t => lowerLabel.includes(t));
      if (!matchedTerm) return;

      row.eachCell({ includeEmpty: false }, cell => {
        const formula = cell.formula;
        if (!formula || !isDateGatedToZero(formula)) return;
        const key = `${ws.name}!row${rowNum}`;
        if (!groups.has(key)) groups.set(key, { sheet: ws.name, rowNum, label, cells: [] });
        groups.get(key).cells.push({ address: cell.address, formula });
      });
    });
  });

  const findings = [];
  for (const [, g] of groups) {
    const sample = g.cells[0];
    findings.push({
      sheet: g.sheet, rowNum: g.rowNum, label: g.label, sampleCell: sample.address,
      instanceCount: g.cells.length,
      note: `${g.sheet}!${sample.address} ("${g.label}", and ${g.cells.length - 1} other period(s) on the same row) is structurally forced to 0 for any period before a named milestone date, via a formula shape like "${sample.formula.length > 100 ? sample.formula.slice(0, 100) + '…' : sample.formula}" — not a calculation failure or missing data, but a deliberate date gate. A "0" produced this way is easy to mistake for a genuine covenant breach; anything comparing this ratio against a threshold (a covenant test, a distribution gate) should treat these gated periods as not-yet-measurable rather than as a value to test.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} covenant/ratio row(s) are structurally forced to zero before a named milestone date, rather than genuinely measuring the ratio.`
      : 'No covenant/ratio row was found to be structurally date-gated to zero.',
  };
}

module.exports = { checkDateGatedRatioZero };
