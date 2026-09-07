// Reconciles multiple sub-batch results for the SAME rule set, when a
// Tier 2 batch's own data (not its rules) had to be split across
// multiple sub-batches because the full-parse payload was too large for
// one call. Each sub-batch's LLM call is given the full, same set of
// applicable rules for that Tier 2 batch, but only a subset of the
// model's sheets - so the same rule can genuinely come back with
// different verdicts across different sub-batches (e.g. "Uncertain" in
// sub-batches that never saw the relevant sheet, "Pass" or "Raised
// Issue" in the one that did).
//
// This is genuinely different from the existing chunkRulesForOutputSafety()
// mechanism (validator-tier2.js) - that splits Batch 2's own RULE SET
// into chunks, with every chunk seeing the SAME, full data. There, each
// rule only ever appears in exactly one chunk, so there is nothing to
// reconcile. Here, the same rule can appear in every sub-batch's result
// set, each with only partial visibility into the model.

// Real, deliberate priority order, most definitive first - never an
// arbitrary "last one wins" or "first one wins", since either would
// silently discard a genuine finding depending on which sub-batch
// happened to run last/first.
//
// Confirmed directly against build_report.py's own real status checks:
// the only two literal, raw status strings are 'pass' and 'uncertain' -
// anything else represents a genuine issue being raised (the raw value
// is the rule's own severity/priority, e.g. 'P1'/'P2'/'P3', not a
// separate 'raised_issue' string). "Not Performed" is never a raw status
// at all - it's inferred purely by a rule id's absence from the results
// list entirely, which the Map-based merge below already handles
// correctly on its own, without needing an explicit status for it.
//
// 1. Anything that isn't literally 'pass' or 'uncertain' is a raised
//    issue, and wins over everything - a specific, evidenced problem
//    found in one sub-batch is real regardless of what other sub-batches
//    (which never saw the relevant data) reported.
// 2. 'pass' wins over 'uncertain' - a sub-batch that genuinely saw the
//    relevant data and confirmed the rule holds is a real, definitive
//    result; 'uncertain' from a sub-batch that never saw the relevant
//    sheet is correctly non-informative, not evidence against the pass.
function statusPriority(status) {
  if (status !== 'pass' && status !== 'uncertain') return 3; // a raised issue
  if (status === 'pass') return 2;
  return 1; // 'uncertain'
}

/**
 * Reconciles an array of result arrays (one per data sub-batch, all
 * covering the same rule set) into one, final array with exactly one
 * result per rule id.
 *
 * @param {Array<Array<object>>} subBatchResultArrays
 * @returns {Array<object>} one reconciled result per distinct rule id
 */
function reconcileDataSplitResults(subBatchResultArrays) {
  const byRuleId = new Map();

  for (const resultsArray of subBatchResultArrays) {
    for (const result of resultsArray) {
      const existing = byRuleId.get(result.id);
      if (!existing) {
        byRuleId.set(result.id, result);
        continue;
      }
      // Real, deliberate tie-break: a strictly higher-priority status
      // always wins. On a genuine tie (both sub-batches raised an issue
      // for the same rule, or both passed), keep the existing one - the
      // two are equally definitive, and arbitrarily replacing the first
      // with the second isn't a genuine improvement, just churn.
      if (statusPriority(result.status) > statusPriority(existing.status)) {
        byRuleId.set(result.id, {
          ...result,
          // Preserve a record that this rule was genuinely re-attempted
          // across sub-batches - useful for audit-trail purposes, not
          // shown in the report itself.
          _reconciledFrom: (existing._reconciledFrom || 1) + 1,
        });
      }
    }
  }

  return Array.from(byRuleId.values());
}

module.exports = { reconcileDataSplitResults, statusPriority };
