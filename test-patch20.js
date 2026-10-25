#!/usr/bin/env node
// test-patch20.js - an equity mismatch in the first forecast period is checked against the opening balance first.
'use strict';
const assert = require('assert');
const fs = require('fs');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const skill = fs.readFileSync(__dirname + '/config/skill.md', 'utf8');
const riio = fs.readFileSync(__dirname + '/config/skill-riio-pcfm.md', 'utf8');
const sec = skill.slice(skill.indexOf('### test: equity_reconciliation'), skill.indexOf('### test: working_capital_reconciliation'));

console.log('equity_reconciliation');
test('the reviewer must do the opening-balance check before failing', () => {
  assert.ok(/BEFORE failing/.test(sec) && /Opening-balance check/.test(sec));
});
test('it must quote the opening-equity and opening net debt formulas', () => {
  assert.ok(/Quote the opening-equity formula/.test(sec) && /opening net debt formula/.test(sec));
});
test('three outcomes: already inside (no P2), not inside (fail with amount), cannot see (uncertain)', () => {
  assert.ok(/Do not raise a P2/.test(sec) && /fail\s+with the amount/.test(sec) && /Cannot see the opening-equity formula/.test(sec));
});
test('the section still starts with the original pass rule and keeps the original fail rule', () => {
  assert.ok(/If movements match across both locations → pass/.test(sec) && /If movement appears in one but not the other/.test(sec));
});
test('the next test section is intact', () => {
  assert.ok(skill.includes('### test: working_capital_reconciliation') && skill.includes('### test: no_impossible_balances'));
});

console.log('RIIO layer');
test('the RIIO skill describes the opening gearing reset and warns against double counting', () => {
  assert.ok(/## 8\. Opening gearing reset and the equity roll-forward/.test(riio) && /count it twice/.test(riio));
});
test('the new section sits before the honestly-flagged gap and nothing else moved', () => {
  assert.ok(riio.indexOf('## 8. Opening gearing reset') < riio.indexOf('## A genuine, honestly-flagged gap') && riio.indexOf('## 7. RoRE and financeability') < riio.indexOf('## 8.'));
});
test('it makes no claim beyond what the ESO model shows (named as a model label, not an Ofgem rule)', () => {
  assert.ok(/Some licence models/.test(riio) && /the ESO model labels the row/.test(riio));
});
console.log(`\n${passed} passed`);
