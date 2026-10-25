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

const GENERIC_CELL = /^(|A1|N\/A|NA|-)$/i;
// Two raised results are the same problem when they point at the same sheet and a specific cell. A result with no
// real cell (an absence, a workbook-wide point) is compared on its wording instead, so two different absences
// under one rule are both kept.
function raisedKey(r) {
  const sheet = String(r.sheet || '').trim().toLowerCase();
  const cell = String(r.cell || '').trim().toUpperCase();
  if (!GENERIC_CELL.test(cell)) return `${sheet}|${cell}`;
  const text = String(r.condition || r.reason || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80);
  return `${sheet}|${cell}|${text}`;
}

/**
 * Reconciles an array of result arrays (one per data sub-batch, all
 * covering the same rule set) into one final array.
 *
 * Every distinct problem a rule raised in any sub-batch is kept (Patch 11): two chunks that each find a different
 * error under one rule both reach the report. The same problem found twice (same sheet and cell) is kept once, from
 * the first sub-batch that raised it. A rule with no issue keeps one result: a pass beats uncertain.
 *
 * @param {Array<Array<object>>} subBatchResultArrays
 * @returns {Array<object>} for each rule id, its distinct raised results, or else one pass or uncertain result
 */
function reconcileDataSplitResults(subBatchResultArrays) {
  const byRuleId = new Map(); // id -> { raised: Map(key -> result), other: result|null, seen: n }

  for (const resultsArray of subBatchResultArrays) {
    for (const result of resultsArray) {
      let e = byRuleId.get(result.id);
      if (!e) { e = { raised: new Map(), other: null, seen: 0 }; byRuleId.set(result.id, e); }
      e.seen++;
      if (statusPriority(result.status) === 3) {
        const k = raisedKey(result);
        if (!e.raised.has(k)) e.raised.set(k, result);
      } else if (!e.other || statusPriority(result.status) > statusPriority(e.other.status)) {
        e.other = result;
      }
    }
  }

  const out = [];
  for (const e of byRuleId.values()) {
    if (e.raised.size > 0) {
      for (const r of e.raised.values()) out.push(e.seen > 1 ? { ...r, _reconciledFrom: e.seen } : r);
    } else if (e.other) {
      out.push(e.seen > 1 ? { ...e.other, _reconciledFrom: e.seen } : e.other);
    }
  }
  return out;
}

module.exports = { reconcileDataSplitResults, statusPriority };
