#!/usr/bin/env node
// test-patch12.js - a missing confidence is unknown, not 100.
'use strict';
const assert = require('assert');
const { classifyRecordType, resolveConfidence } = require('./src/utils/record-type-classifier');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const f = o => Object.assign({ cell: 'B2', sheet: 'S' }, o);

console.log('Tier 1 checks that report no confidence');
test('a fatal name-matching check (T1-009, sheet called Timing/Flags) becomes a Critical Query, not a P1-eligible finding', () => {
  assert.strictEqual(classifyRecordType(f({ id: 'T1-009', severity: 'fatal' })), 'Critical Query');
});
test('the other name-matching fatal checks do the same', () => {
  for (const id of ['T1-002', 'T1-004', 'T1-005', 'T1-008', 'T1-012']) assert.strictEqual(classifyRecordType(f({ id, severity: 'fatal' })), 'Critical Query', id);
});
test('an exact file-fact check stays a Confirmed Finding (hidden rows, sheet names, external links, circularity)', () => {
  for (const [id, severity] of [['T1-013', 'high'], ['T1-015', 'medium'], ['T1-007', 'fatal'], ['T1-011', 'fatal'], ['T1-010', 'fatal']]) {
    assert.strictEqual(classifyRecordType(f({ id, severity })), 'Confirmed Finding', id);
  }
});
test('a name-matching check below fatal is still a Confirmed Finding (65 is above the 60 line)', () => {
  assert.strictEqual(classifyRecordType(f({ id: 'T1-006', severity: 'high' })), 'Confirmed Finding');
});

console.log('Everything else');
test('a non-Tier-1 finding with no confidence is unknown: a Query, or a Critical Query when fatal or critical', () => {
  assert.strictEqual(classifyRecordType(f({ id: 'T0-NEW-001', severity: 'high' })), 'Query');
  assert.strictEqual(classifyRecordType(f({ id: 'T0-NEW-001', severity: 'fatal' })), 'Critical Query');
  assert.strictEqual(classifyRecordType(f({ id: 'T2-S1-001', severity: 'critical' })), 'Critical Query');
});
test('a stated confidence is used exactly as before', () => {
  assert.strictEqual(classifyRecordType(f({ id: 'T0-NEW-001', severity: 'high', confidence: 90 })), 'Confirmed Finding');
  assert.strictEqual(classifyRecordType(f({ id: 'T0-NEW-001', severity: 'high', confidence: 50 })), 'Query');
  assert.strictEqual(classifyRecordType(f({ id: 'T1-009', severity: 'fatal', confidence: 100 })), 'Confirmed Finding');
});
test('confidence 0 is stated (Tier 2 stores a missing value as 0), not unknown', () => {
  assert.strictEqual(resolveConfidence({ id: 'T2-S1-001', confidence: 0 }).basis, null);
});
test('an explicit record_type is still respected', () => {
  assert.strictEqual(classifyRecordType(f({ id: 'T0-NEW-001', severity: 'fatal', record_type: 'Observation' })), 'Observation');
});
test('the basis is recorded on the finding when it was assumed', () => {
  const x = f({ id: 'T1-009', severity: 'fatal' }); classifyRecordType(x);
  assert.ok(/matches names/.test(x.confidence_basis));
  const y = f({ id: 'T0-NEW-001', severity: 'high' }); classifyRecordType(y);
  assert.strictEqual(y.confidence_basis, 'unknown');
});

console.log(`\n${passed} check(s) passed`);
