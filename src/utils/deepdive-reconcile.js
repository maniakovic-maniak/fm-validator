'use strict';
// deepdive-reconcile.js - Patch 29. Compares what the Formula Deep Dive was asked to review with what came back, so the
// count of "reviewed" formulas is the count of valid answers and nothing else. Before this, the module reported
// `reviewed = items.length` whatever the reviewer returned: 40 sent and one valid answer read as 40 reviewed.
//
// A result counts as completed only when:
//   - it names a ufi (the reviewer is told to copy it from the item) that was in the request,
//   - that ufi has not already been answered (the first valid answer is kept; later ones are duplicates),
//   - its status is pass, fail or uncertain.
// Everything else is listed, not dropped: unknown ids, duplicates, malformed answers, and the requested ufis with no
// valid answer. A reply cut off at the output limit is flagged as truncated.

const VALID_STATUS = new Set(['pass', 'fail', 'uncertain']);

function reconcileDeepDive(items, results, opts = {}) {
  const requested = new Set((items || []).map(i => i && i.ufi).filter(v => v !== undefined && v !== null));
  const answered = new Map();            // ufi -> first valid result
  const unknown = [], duplicates = [], malformed = [];

  for (const r of Array.isArray(results) ? results : []) {
    if (!r || typeof r !== 'object') { malformed.push({ reason: 'not an object' }); continue; }
    const ufi = r.ufi;
    if (ufi === undefined || ufi === null || ufi === '') { malformed.push({ id: r.id, reason: 'no ufi' }); continue; }
    if (!requested.has(ufi)) { unknown.push({ id: r.id, ufi }); continue; }
    const status = String(r.status || '').toLowerCase();
    if (!VALID_STATUS.has(status)) { malformed.push({ id: r.id, ufi, reason: `status "${r.status}"` }); continue; }
    if (answered.has(ufi)) { duplicates.push({ id: r.id, ufi }); continue; }
    answered.set(ufi, Object.assign({}, r, { status }));
  }

  const missing = [...requested].filter(u => !answered.has(u));
  const valid = [...answered.values()];
  const stop = opts.stopReason || null;
  return {
    requested: requested.size,
    completed: valid.length,
    passed: valid.filter(r => r.status === 'pass').length,
    findings: valid.filter(r => r.status === 'fail' || r.status === 'uncertain'),
    valid,
    notCompleted: missing,
    unknown, duplicates, malformed,
    truncated: stop === 'max_tokens',
    stopReason: stop,
    reconciled: valid.length === requested.size && !unknown.length && !duplicates.length && !malformed.length && stop !== 'max_tokens'
  };
}

// One line a reader can use: "Completed 1 of 40; 39 not completed (...)".
function describeReconciliation(rec) {
  const bits = [`completed ${rec.completed} of ${rec.requested} requested`];
  if (rec.notCompleted.length) bits.push(`${rec.notCompleted.length} not completed`);
  if (rec.unknown.length) bits.push(`${rec.unknown.length} answer(s) for formulas that were not requested were discarded`);
  if (rec.duplicates.length) bits.push(`${rec.duplicates.length} duplicate answer(s) were discarded`);
  if (rec.malformed.length) bits.push(`${rec.malformed.length} malformed answer(s) were discarded`);
  if (rec.truncated) bits.push('the reply was cut off at the output limit');
  return bits.join('; ');
}

module.exports = { reconcileDeepDive, describeReconciliation };
