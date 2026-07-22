// sign-convention-check.js — Wave 1-style deterministic check.
//
// Named explicitly in Anthropic's own audit-xls skill as "extremely common":
// sign convention errors (positive vs negative for cash outflows).
//
// Deliberately does NOT assume a universal external convention (e.g. "costs
// must always be negative") — that would contradict this project's own
// established principle (see reasonableness-checks.js) of comparing against
// the model's own stated assumptions and history, not an external rule.
// Instead this checks for INTERNAL inconsistency: if the same conceptual
// line item (e.g. "Capex") appears with a mix of positive and negative
// values across different sheets or periods within the SAME workbook, that
// is a genuine, defensible signal worth flagging — no assumption about
// which sign is "correct" is required, only that a single model should be
// internally consistent about it.

const { findLabeledValues } = require('./find-labeled-value');

// Term groups — each group is treated as one conceptual line item, pooling
// candidates across all its synonyms before checking sign consistency.
// Kept deliberately small and specific rather than exhaustive, mirroring
// reasonableness-checks.js's own scope.
const SIGN_CHECK_GROUPS = [
  { label: 'Capex', terms: ['capex', 'capital expenditure'] },
  { label: 'Operating costs', terms: ['operating expense', 'opex', 'operating costs'] },
  { label: 'Interest expense', terms: ['interest expense', 'interest paid'] },
  { label: 'Distributions', terms: ['distributions paid', 'dividends paid', 'distribution to equity'] },
  { label: 'Depreciation', terms: ['depreciation expense', 'depreciation charge'] },
  // Added from Plum Solutions/Mazars "Top 10 Errors" (fm-validator book-
  // mining D3, error #3): "Incorrect signs: Cash, Fixed Assets, Debt
  // Balance" — named explicitly as common sign-error locations distinct
  // from the flow-statement items above (these are balance-sheet items,
  // where a sign flip is easy to miss since both signs can look
  // superficially plausible on a summary view).
  //
  // KNOWN, DISCLOSED LIMITATION (confirmed via real testing against The
  // Bend): these three groups are structurally less likely to fire than
  // the flow-statement groups above, for a real reason, not a bug.
  // findLabeledValues grabs only the FIRST numeric cell to the right of a
  // label (by design — see its own module comment). For a flow item like
  // Capex that's usually a real figure. For a BALANCE-type time series
  // like "Closing Cash Balance" or "Opening Cash Balance", the first
  // period column is very often a genuine zero (before construction, or
  // before financial close) — correctly filtered out by the |value|>=1
  // floor above, but leaving fewer than 2 usable candidates to compare on
  // real files. Confirmed directly: on The Bend, 10 "cash balance"
  // candidates were found, every one of them 0. This is not silently
  // hidden — it just means these three groups will under-detect relative
  // to the flow-statement groups until findLabeledValues (or a dedicated
  // variant) can scan a full time-series row for a representative
  // non-zero value rather than only the nearest cell.
  { label: 'Cash balance', terms: ['cash balance', 'closing cash', 'cash and cash equivalents'] },
  { label: 'Fixed assets', terms: ['fixed assets', 'property, plant and equipment', 'net fixed assets'] },
  { label: 'Debt balance', terms: ['debt balance', 'loan balance', 'closing debt balance'] },
];

function checkSignConventions(workbook) {
  const results = [];

  for (const group of SIGN_CHECK_GROUPS) {
    const candidates = findLabeledValues(workbook, group.terms, { maxDistance: 8 });
    // Ignore zero values — a zero has no sign to be inconsistent about,
    // and including it would understate genuine agreement between the
    // real nonzero candidates.
    //
    // Also ignore values with |value| < 1 — a genuine dollar-value line
    // item (capex, opex, distributions, interest expense) should never be
    // a fraction in a real financial model, while a percentage/rate
    // assumption always is. Confirmed real on a production file: a
    // "% of Capex" unit descriptor correctly matched the word "capex",
    // then correctly found the nearest number to its right — but that
    // number was a contingency rate (0.1), not a capex dollar figure.
    //
    // KNOWN, DISCLOSED LIMITATION — a magnitude-clustering approach (keep
    // only the single largest order-of-magnitude cluster) was also tried
    // and made things WORSE on this same file: a sensitivity table using
    // "Capex +10%"/"Capex +20%" as scenario labels (not capex figures)
    // produced enough small-magnitude matches that the "dominant" cluster
    // by count became the noise, not the real multi-million-dollar capex
    // line items. Count-based dominance is not the same as semantic
    // correctness, and reverting to the simpler, unambiguous |value| >= 1
    // floor was the more honest choice — it provably removes the
    // percentage-rate contamination without risking flipping the result
    // in the wrong direction. A small residual (sensitivity-delta values
    // that happen to be >= 1) can still get through for a broadly-reused
    // label like "Capex" that appears in many unrelated contexts
    // throughout a real model. Fully solving this would need real
    // semantic understanding of what each candidate actually represents,
    // not another mechanical filter layered on top of label-substring
    // matching.
    const nonzero = candidates.filter(c => c.value !== 0 && Math.abs(c.value) >= 1);
    if (nonzero.length < 2) continue; // need at least 2 real values to compare

    const positives = nonzero.filter(c => c.value > 0);
    const negatives = nonzero.filter(c => c.value < 0);

    if (positives.length > 0 && negatives.length > 0) {
      const posLocations = positives.slice(0, 5).map(c => `${c.sheet}!${c.valueCell} (${c.value})`).join(', ');
      const negLocations = negatives.slice(0, 5).map(c => `${c.sheet}!${c.valueCell} (${c.value})`).join(', ');
      results.push({
        applicable: true,
        label: group.label,
        flagged: true,
        positiveCount: positives.length,
        negativeCount: negatives.length,
        // P1/P2/P3 framework Tier 2 item 1: these two arrays already
        // existed as local variables used only to build the prose note
        // below — exposing them structurally costs nothing and lets
        // root-cause-consolidation.js extract real affected_cells
        // instead of an empty list.
        positiveInstances: positives.map(c => ({ sheet: c.sheet, cell: c.valueCell, value: c.value })),
        negativeInstances: negatives.map(c => ({ sheet: c.sheet, cell: c.valueCell, value: c.value })),
        note: `"${group.label}"-labelled values were found with inconsistent sign across the workbook — ${positives.length} positive instance(s) (e.g. ${posLocations}) and ${negatives.length} negative instance(s) (e.g. ${negLocations}). This may be a genuine sign error in one location, or a deliberate difference in convention between sheets — the model's own convention should be confirmed, not assumed, before treating either as wrong.`,
      });
    }
  }

  return {
    applicable: true,
    flaggedCount: results.filter(r => r.flagged).length,
    results,
    note: 'Sign-consistency checks compare values under the same label across the workbook for internal agreement only — they do not assume any external convention for which sign is "correct". A flagged inconsistency is a specific, named reason to confirm the model\'s own convention, not an automatic error.',
  };
}

module.exports = { checkSignConventions };
