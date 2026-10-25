'use strict';
// Patch 18: the review mode recorded for a Tier 2 result.
// On the full-parse route the reviewer is given every formula, so a missing or "llm_only" label is a labelling gap,
// not a lower depth of review.
function resolveReviewMode(declared, useFullParse) {
  const d = String(declared || '').trim();
  if (useFullParse && (!d || d === 'llm_only')) return 'llm_full_parse';
  return d || 'llm_only';
}
module.exports = { resolveReviewMode };
