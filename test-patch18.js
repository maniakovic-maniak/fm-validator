#!/usr/bin/env node
// test-patch18.js - documentation requests are Queries; the two fatal-gate procedures with no skill text now have one.
'use strict';
const assert = require('assert');
const fs = require('fs');
const { classifyRecordType } = require('./src/utils/record-type-classifier');
const checklist = require('./config/checklist.json');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const doc = o => Object.assign({ id: 'T2-S12-009', confidence: 30, severity: 'critical', category: 'Documentation', cell: 'AP36', sheet: 'SystemOperator',
  condition: 'SystemOperator!AP36 (LSOMODt legacy adjustment) is a modelled formula line, not evidence of an off-model overlay register.' }, o);

console.log('Documentation requests');
test('a critical-severity "no register found" at 30% is a Query, anchored to a cell or not (Fm-00049 T2-S12-009)', () => {
  assert.strictEqual(classifyRecordType(doc({})), 'Query');
  assert.strictEqual(classifyRecordType(doc({ cell: 'A1', sheet: '' })), 'Query');
});
test('a high-severity documentation register at 30% is a Query (T2-S11-004)', () => {
  assert.strictEqual(classifyRecordType(doc({ id: 'T2-S11-004', severity: 'high', condition: 'Legacy adjustment terms exist, but no register documenting owner, date, source and rationale was found.' })), 'Query');
});
test('a documentation finding at 60%+ confidence is not capped', () => {
  assert.strictEqual(classifyRecordType(doc({ confidence: 70 })), 'Critical Query');
  assert.strictEqual(classifyRecordType(doc({ confidence: 70, severity: 'high' })), 'Confirmed Finding');
});
test('a non-documentation low-confidence finding that touches a key output keeps its escalation', () => {
  assert.strictEqual(classifyRecordType(doc({ category: 'Valuation', condition: 'IRR may be overstated by the timing of equity.' })), 'Critical Query');
});
test('the cap is written to skip fatal rules', () => {
  assert.ok(/severity !== 'fatal' &&\s*\n\s*\/documentation\//.test(fs.readFileSync(__dirname + '/src/utils/record-type-classifier.js', 'utf8')));
});
test('Tier 0 findings are not touched', () => {
  assert.strictEqual(classifyRecordType({ id: 'T0-XYZ-001', confidence: 30, severity: 'high', category: 'Documentation', condition: 'x' }), classifyRecordType({ id: 'T0-XYZ-001', confidence: 30, severity: 'high', category: 'Other', condition: 'x' }));
});

console.log('Skill text');
const skill = fs.readFileSync(__dirname + '/config/skill.md', 'utf8');
const byId = Object.fromEntries(checklist.tier2.map(r => [r.id, r]));
test('every fatal-gate rule in the infrastructure scope has a skill section for its test, or is in no scope', () => {
  for (const id of ['T2-S9-004', 'T2-S8-005']) assert.ok(skill.includes('### test: ' + byId[id].test), id);
});
test('returns_from_live_cashflows tells the reviewer not to return uncertain for external publication', () => {
  const sec = skill.slice(skill.indexOf('### test: returns_from_live_cashflows'), skill.indexOf('### test: downside_not_suppressed'));
  assert.ok(/outside the workbook/.test(sec) && /Do not return uncertain/.test(sec) && /SavedResults/.test(sec));
});
test('downside_not_suppressed treats a visible equity injection as a pass and a hidden floor as a fail', () => {
  const sec = skill.slice(skill.indexOf('### test: downside_not_suppressed'), skill.indexOf('### test: instructions_complete'));
  assert.ok(/equity injection/i.test(sec) && /Fail \(P2\)/.test(sec));
});
test('T2-S9-004 is no longer manual_only (decidable from the formulas)', () => { assert.strictEqual(byId['T2-S9-004'].manual_only, false); });
console.log('Review mode');
const { resolveReviewMode } = require('./src/utils/review-mode');
test('full-parse route: a missing or llm_only label becomes llm_full_parse (the 60 unlabelled Fm-00049 results)', () => {
  assert.strictEqual(resolveReviewMode(undefined, true), 'llm_full_parse');
  assert.strictEqual(resolveReviewMode('llm_only', true), 'llm_full_parse');
});
test('labels the reviewer chose are kept', () => {
  assert.strictEqual(resolveReviewMode('llm_with_partial_formulas', true), 'llm_with_partial_formulas');
  assert.strictEqual(resolveReviewMode('llm_full_parse', true), 'llm_full_parse');
});
test('curated route is unchanged', () => {
  assert.strictEqual(resolveReviewMode(undefined, false), 'llm_only');
  assert.strictEqual(resolveReviewMode('llm_only', false), 'llm_only');
});
test('validator-tier2.js uses it where review_mode is set', () => {
  assert.ok(fs.readFileSync(__dirname + '/src/validator-tier2.js', 'utf8').includes("resolveReviewMode(r.review_mode, useFullParse)"));
});
console.log(`\n${passed} passed`);
