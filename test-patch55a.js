'use strict';
const assert = require('assert');
const { isNotApplicableAbsence, isConfirmedAbsence, keptUncertainReason } = require('./src/utils/absence-policy');
const { markNotApplicable } = require('./src/utils/applicability-record');
let n = 0; const ok = (m, f) => { f(); n++; console.log('  ok  ' + m); };
const mk = (id, text, extra = {}) => Object.assign({ id, status: 'uncertain', condition: text, priority: 'Query' }, extra);
ok('answer opening "Not applicable:" is marked Not Applicable (Fm-00060 wording)', () => {
  const r = [mk('T2-S10-376', 'Not applicable: no PPP credit-support instruments (PCGs, bonds, LCs) exist in this single-company regulatory revenue model.'),
             mk('T2-S10-508', 'Not applicable: RatingSimulator is a self-assessment credit-rating tool, not externally-imposed lender covenants.')];
  const m = markNotApplicable(r, { ruleById: new Map([['T2-S10-376', { severity: 'critical' }]]) });
  assert.deepStrictEqual(m, ['T2-S10-376', 'T2-S10-508']);
  assert.strictEqual(r[0].record_type, 'Not Applicable'); assert.ok(r[0]._applicability.subject);
});
ok('a fatal-severity rule is still never set aside', () => {
  const r = [mk('X', 'Not applicable: nothing here.')];
  assert.deepStrictEqual(markNotApplicable(r, { ruleById: new Map([['X', { severity: 'fatal' }]]) }), []);
  assert.strictEqual(r[0].record_type, undefined);
});
ok('"not applicable" in the middle of a real finding is not caught', () => {
  assert.strictEqual(isNotApplicableAbsence(mk('Y', 'Tax rate differs from 19%; the reviewer notes capital allowances are not applicable to one asset.')), false);
});
ok('only uncertain answers; pass/fail untouched', () => {
  assert.strictEqual(isNotApplicableAbsence(mk('Z', 'Not applicable: x', { status: 'fail' })), false);
  assert.strictEqual(isNotApplicableAbsence(mk('Z', 'Not applicable: x', { status: 'pass' })), false);
});
ok('an explicit "Not applicable" answer is never converted into an absence defect', () => {
  assert.strictEqual(isConfirmedAbsence(mk('Q', 'Not applicable: there is no hedge')), false);
  assert.strictEqual(keptUncertainReason(mk('Q', 'Not applicable: no hedge profile exists')), null);
});
ok('existing behaviour kept: "No ..." opening with not-applicable wording is still set aside', () => {
  assert.strictEqual(isNotApplicableAbsence(mk('W', 'No manual-adjustments register is identifiable.', { reason: 'Not applicable to a regulated model by design' })), true);
});
console.log('\n' + n + ' check(s) passed');
