#!/usr/bin/env node
// test-patch15.js - model identity ignores the upload timestamp; tier R8 scopes out seven not-applicable procedures.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeModelIdentity } = require('./src/utils/finding-history');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }

console.log('Model identity');
test('two uploads of the same model resolve to one identity (the Fm-00046 / Fm-00047 names)', () => {
  const a = normalizeModelIdentity('Final_Determinations_-_ESO_Licence_Model-1792397031563.xlsm');
  const b = normalizeModelIdentity('Final_Determinations_-_ESO_Licence_Model-1792921491941.xlsm');
  assert.strictEqual(a, b); assert.ok(!/\d{12}/.test(a), a);
});
test('a name with no timestamp is unchanged by the fix', () => {
  assert.strictEqual(normalizeModelIdentity('Final_Determinations_-_ESO_Licence_Model.xlsm'), normalizeModelIdentity('Final_Determinations_-_ESO_Licence_Model-1792921491941.xlsm'));
});
test('different models stay different', () => {
  assert.notStrictEqual(normalizeModelIdentity('Carlsberg-1792921491941.xlsm'), normalizeModelIdentity('The_Bend-1792921491941.xlsx'));
});
test('short numbers are not stripped (Building 12 vs Building 13 still differ)', () => {
  assert.notStrictEqual(normalizeModelIdentity('Plant-2024-1.xlsx'), normalizeModelIdentity('Plant-2025-1.xlsx'));
});

console.log('Scope tier R8');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'rule-exclusions.json'), 'utf8'));
const tiers = cfg.profiles.find(p => p.id === 'regulated_network_utility').tiers;
const R8 = ['T2-S10-383', 'T2-S10-532', 'T2-S10-574', 'T2-S10-665', 'T2-S10-689', 'T2-S10-700', 'T2-S10-708'];
const byId = {};
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.id) byId[o.id] = o; Object.values(o).forEach(walk); } })(JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'checklist.json'), 'utf8')));
test('R8 holds exactly the seven ids, enabled, not fatal-gate', () => {
  const t = tiers.R8_scope_decision_regulated_network_exploration_not_applicable;
  assert.ok(t && t.enabled === true && t.allowFatal === false);
  assert.deepStrictEqual(t.ruleIds.slice().sort(), R8.slice().sort());
});
test('every id exists and none is fatal or critical', () => {
  for (const id of R8) { assert.ok(byId[id], id); assert.ok(!['fatal', 'critical'].includes(byId[id].severity), id); }
});
test('no rule id appears in two tiers', () => {
  const seen = new Map();
  for (const [n, t] of Object.entries(tiers)) for (const id of t.ruleIds || []) { assert.ok(!seen.has(id), `${id} in ${seen.get(id)} and ${n}`); seen.set(id, n); }
});
test('the rules that must stay in scope are in no tier (336, 508, 369)', () => {
  for (const id of ['T2-S10-336', 'T2-S10-508', 'T2-S10-369']) for (const t of Object.values(tiers)) assert.ok(!(t.ruleIds || []).includes(id), id);
});
console.log(`\n${passed} passed`);
