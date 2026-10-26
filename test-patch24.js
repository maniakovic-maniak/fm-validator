#!/usr/bin/env node
// test-patch24.js - T2-S13-008 is recorded as "needing source documents or live testing" for a regulated-network model,
// so it no longer holds the run; a tier may carry its own scope category.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const scope = require('./src/utils/rule-scope');
const { computeHoldStatus } = require('./src/utils/compute-hold');
const { applyRuleExclusions } = require('./src/utils/rule-exclusions');
const checklist = require('./config/checklist.json');
const exclCfg = require('./config/rule-exclusions.json');
const scopeCfg = require('./config/rule-scope.json');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const quiet = () => {};
const INFRA = 'skill-infrastructure.md';
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'rule-history-seed', 'infrastructure.json'), 'utf8'));
const tiering = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'rule-tiering.json'), 'utf8'));
const plan = (modelText, extra = {}) => scope.buildScopePlan(Object.assign({ checklist, domainFile: INFRA, modelText, runKey: 't', log: quiet,
  configs: { exclusions: exclCfg, scope: scopeCfg, tiering, history: seed } }, extra));
const REG = 'electricity transmission system operator riio price control';

console.log('Scope decision R10');
const tier = exclCfg.profiles.find(p => p.id === 'regulated_network_utility').tiers['R10_scope_decision_regulated_network_external_evidence'];
test('R10 exists, allows fatal on purpose, is an evidence_required tier naming exactly T2-S13-008', () => {
  assert.ok(tier && tier.enabled === true && tier.allowFatal === true && tier.category === 'evidence_required');
  assert.deepStrictEqual(tier.ruleIds, ['T2-S13-008']);
  assert.ok(/Mik Riazanov/.test(tier.decision) && /2026-10-26/.test(tier.decision));
  assert.strictEqual(checklist.tier2.find(r => r.id === 'T2-S13-008').severity, 'fatal');
});
test('a regulated-network model plans T2-S13-008 out as evidence_required, not not_applicable', () => {
  const p = plan(REG); const e = p.preExcluded.find(x => x.id === 'T2-S13-008');
  assert.ok(e, 'T2-S13-008 not removed'); assert.strictEqual(e.category, 'evidence_required');
});
test('it is listed by name with the work needing source documents in the report summary', () => {
  const p = plan(REG);
  const eng = applyRuleExclusions({ checklist, t1Results: [], t2Results: [], domainFile: INFRA, modelText: REG, originalName: 'patch24-sum', log: quiet, config: exclCfg, preExcluded: p.preExcluded });
  try { fs.unlinkSync(path.join(__dirname, 'data', 'rule-exclusions', 'patch24-sum.json')); } catch (_) {}
  const s = scope.summarizeScopeForReport(eng.record, p, scopeCfg);
  const item = s.evidenceRequired.find(x => x.id === 'T2-S13-008');
  assert.ok(item && /tied to audited model/i.test(item.label), JSON.stringify(s.evidenceRequired.slice(-2)));
  const tierEv = Object.values(exclCfg.profiles.find(x => x.id === 'regulated_network_utility').tiers).filter(t => t && t.enabled && t.category === 'evidence_required').reduce((n, t) => n + t.ruleIds.length, 0);
  assert.strictEqual(s.evidenceRequired.length, scopeCfg.evidenceRequired.ruleIds.length + tierEv);
});
test('an unrelated model keeps T2-S13-008 in scope', () => {
  const p = plan('toll road concession project finance');
  assert.ok(!p.preExcluded.some(x => x.id === 'T2-S13-008'));
});
test('a tier without a category still records not_applicable (existing tiers unchanged)', () => {
  const p = plan(REG); const r9 = p.preExcluded.find(x => x.id === 'T2-S10-362');
  assert.ok(r9 && r9.category === 'not_applicable');
});

console.log('Hold gate');
test('with T2-S13-008 excluded, the run is no longer held for it', () => {
  const p = plan(REG);
  const eng = applyRuleExclusions({ checklist, t1Results: [], t2Results: [{ id: 'T2-S13-008', status: 'uncertain' }, { id: 'T2-S1-002', status: 'uncertain' }],
    domainFile: INFRA, modelText: REG, originalName: 'patch24-test', log: quiet, config: exclCfg, preExcluded: p.preExcluded });
  try { fs.unlinkSync(path.join(__dirname, 'data', 'rule-exclusions', 'patch24-test.json')); } catch (_) {}
  assert.ok(eng.isExcluded('T2-S13-008'));
  const remaining = [{ id: 'T2-S13-008', status: 'uncertain' }, { id: 'T2-S1-002', status: 'uncertain' }].filter(r => !eng.isExcluded(r.id));
  assert.strictEqual(computeHoldStatus(remaining, checklist).held, false);
  assert.strictEqual(computeHoldStatus([{ id: 'T2-S13-008', status: 'uncertain' }], checklist).held, true, 'without the decision it would hold');
});
test('another fatal rule left Uncertain still holds the run', () => {
  const fatal = checklist.tier2.find(r => r.severity === 'fatal' && r.id !== 'T2-S13-008' && !exclCfg.profiles[0].tiers.R_scope_decision_regulated_network.ruleIds.includes(r.id) && !exclCfg.profiles[0].tiers.R4_scope_decision_regulated_network_statutory_gates.ruleIds.includes(r.id));
  assert.ok(fatal, 'need a fatal rule still in scope');
  assert.strictEqual(computeHoldStatus([{ id: fatal.id, status: 'uncertain' }], checklist).held, true);
});
console.log(`\n${passed} passed`);
