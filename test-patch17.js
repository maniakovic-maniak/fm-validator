#!/usr/bin/env node
// test-patch17.js - "the subject matter does not exist" is not applicable, not a P3 finding; conditional families leave the plan.
'use strict';
const assert = require('assert');
const { isConfirmedAbsence, applyAbsencePolicy } = require('./src/utils/absence-policy');
const { applyRuleExclusions } = require('./src/utils/rule-exclusions');
const checklist = require('./config/checklist.json');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
// the reviewer's own wording from Fm-00048
const NA = {
  'T2-S10-346': 'No waste/gate-fee/take-or-pay subject matter exists anywhere in the workbook.',
  'T2-S10-348': 'No by-product revenue subject matter exists anywhere in the workbook.',
  'T2-S10-362': 'No project-finance refinancing/mini-perm subject matter exists anywhere in the workbook.',
  'T2-S10-376': 'No credit-support instrument subject matter exists anywhere in the workbook.',
  'T2-S10-396': 'No generation degradation/outage/overhaul subject matter exists anywhere in the workbook.',
  'T2-S10-434': 'No road performance-based contract subject matter exists anywhere in the workbook.',
  'T2-S10-468': 'No userpay customer-tariff-class reset mechanism exists in this System Operator regulatory revenue model.',
  'T2-S10-482': 'No construction-project cost-to-complete subject matter exists anywhere in the workbook.',
  'T2-S10-540': 'No feedstock subject matter exists anywhere in the workbook.',
  'T2-S10-610': 'No toll-road willingness-to-pay subject matter exists anywhere in the workbook.',
  'T2-S10-618': 'No toll-road weather/climate traffic subject matter exists anywhere in the workbook.',
  'T2-S10-651': 'No M&V/energy-efficiency subject matter exists anywhere in the workbook.',
  'T2-S10-667': 'No PACE-type financing subject matter exists anywhere in the workbook.',
  'T2-S10-702': 'No power-generation-specific blended equity/shareholder-debt return structure exists in this System Operator model.',
  'T2-S10-733': 'No ADC facility subject matter exists anywhere in the workbook.',
};
const res = (id, text) => ({ id, status: 'uncertain', confidence: 0.5, priority: 'P3', condition: text });

console.log('Absence policy');
test('every "subject matter does not exist" answer stays uncertain (15 real Fm-00048 answers)', () => {
  for (const [id, t] of Object.entries(NA)) assert.strictEqual(isConfirmedAbsence(res(id, t)), false, id);
});
test('a genuine missing control is still recorded as an absence', () => {
  assert.strictEqual(isConfirmedAbsence(res('T2-S13-002', 'No sheet among the 21 in this workbook serves as a change log.')), true);
  assert.strictEqual(isConfirmedAbsence(res('T2-S11-004', 'No adjustments register listing owner, date, source and rationale is visible in the workbook.')), true);
});
test('applyAbsencePolicy converts nothing for the 15 answers', () => {
  const rows = Object.entries(NA).map(([id, t]) => res(id, t));
  const out = applyAbsencePolicy(rows, { complete: true });
  assert.deepStrictEqual(out.converted, []); assert.ok(rows.every(r => r.status === 'uncertain'));
});

console.log('Conditional families');
test('with those answers still uncertain, the 15 procedures (and no pass or issue) leave the plan for a regulated network', () => {
  const t2 = Object.entries(NA).map(([id, t]) => res(id, t));
  const out = applyRuleExclusions({ checklist, t1Results: [], t2Results: t2, domainFile: 'skill-infrastructure.md', modelText: 'electricity transmission system operation regulated utility price control', originalName: 'x.xlsm', log: () => {} });
  const ex = new Set(out.excludedIds || []);
  const stay = Object.keys(NA).filter(id => !ex.has(id));
  assert.deepStrictEqual(stay, [], 'still in plan: ' + stay.join(', '));
});
test('a pass or an issue on one of those families is never removed', () => {
  const t2 = [{ id: 'T2-S10-396', status: 'pass', confidence: 0.8, condition: 'Overhaul schedule reconciles.' }, res('T2-S10-540', NA['T2-S10-540'])];
  const out = applyRuleExclusions({ checklist, t1Results: [], t2Results: t2, domainFile: 'skill-infrastructure.md', modelText: 'electricity transmission price control', originalName: 'x.xlsm', log: () => {} });
  const ex = new Set(out.excludedIds || []);
  assert.ok(!ex.has('T2-S10-396')); assert.ok(ex.has('T2-S10-540'));
});
test('an unrelated infrastructure model is not touched', () => {
  const out = applyRuleExclusions({ checklist, t1Results: [], t2Results: [res('T2-S10-540', NA['T2-S10-540'])], domainFile: 'skill-infrastructure.md', modelText: 'biomass power plant project finance', originalName: 'x.xlsm', log: () => {} });
  assert.ok(!(out.excludedIds || []).includes('T2-S10-540'));
});
console.log(`\n${passed} passed`);
