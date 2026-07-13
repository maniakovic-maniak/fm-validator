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
];

function checkSignConventions(workbook) {
  const results = [];

  for (const group of SIGN_CHECK_GROUPS) {
    const candidates = findLabeledValues(workbook, group.terms, { maxDistance: 8 });
    // Ignore zero values — a zero has no sign to be inconsistent about,
    // and including it would understate genuine agreement between the
    // real nonzero candidates.
    const nonzero = candidates.filter(c => c.value !== 0);
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
