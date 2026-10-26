#!/usr/bin/env node
// test-patch26.js - R11 (owner/source evidence) and R12 (domain not applicable) scope decisions, the
// no_impossible_balances skill text, T0-LINK-002 as an Observation, and the Tier 0 SUM-range scan.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const scope = require('./src/utils/rule-scope');
const { computeHoldStatus } = require('./src/utils/compute-hold');
const { applyRuleExclusions } = require('./src/utils/rule-exclusions');
const { scanSumRanges } = require('./src/utils/sum-range-scan');
const { screeningRecordType } = require('./src/utils/record-type-classifier');
const checklist = require('./config/checklist.json');
const exclCfg = require('./config/rule-exclusions.json');
const scopeCfg = require('./config/rule-scope.json');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const quiet = () => {};
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const seed = JSON.parse(read('config/rule-history-seed/infrastructure.json'));
const tiering = JSON.parse(read('config/rule-tiering.json'));
const REG = 'electricity transmission system operator riio price control';
const plan = (modelText) => scope.buildScopePlan({ checklist, domainFile: 'skill-infrastructure.md', modelText, runKey: 't', log: quiet,
  configs: { exclusions: exclCfg, scope: scopeCfg, tiering, history: seed } });
const tiers = exclCfg.profiles.find(p => p.id === 'regulated_network_utility').tiers;

console.log('Scope decisions R11 and R12');
test('R11 records T2-S1-007 and T2-S12-009 as evidence_required, with the decision on record', () => {
  const t = tiers['R11_scope_decision_regulated_network_owner_evidence'];
  assert.ok(t && t.enabled && t.category === 'evidence_required' && t.allowFatal === false);
  assert.deepStrictEqual(t.ruleIds, ['T2-S1-007', 'T2-S12-009']);
  assert.ok(/Mik Riazanov/.test(t.decision) && /2026-10-26/.test(t.decision));
  for (const id of t.ruleIds) assert.strictEqual(checklist.tier2.find(r => r.id === id).severity, 'critical');
});
test('R12 records four medium domain procedures as not applicable; T2-S10-369 stays in scope', () => {
  const t = tiers['R12_scope_decision_regulated_network_domain_not_applicable'];
  assert.deepStrictEqual(t.ruleIds, ['T2-S10-287', 'T2-S10-388', 'T2-S10-554', 'T2-S10-586']);
  for (const id of t.ruleIds) assert.strictEqual(checklist.tier2.find(r => r.id === id).severity, 'medium');
  assert.ok(!t.ruleIds.includes('T2-S10-369'));
});
test('a regulated-network model plans them out with the right categories', () => {
  const p = plan(REG); const by = id => (p.preExcluded.find(x => x.id === id) || {}).category;
  assert.strictEqual(by('T2-S1-007'), 'evidence_required'); assert.strictEqual(by('T2-S12-009'), 'evidence_required');
  for (const id of ['T2-S10-287', 'T2-S10-388', 'T2-S10-554', 'T2-S10-586']) assert.strictEqual(by(id), 'not_applicable', id);
  assert.strictEqual(by('T2-S10-369'), undefined);
});
test('an unrelated model is not touched by R11 or R12', () => {
  const p = plan('toll road concession project finance');
  // (a rule can still be left out for another reason, such as no recorded verdict yet; only the R11/R12 tiers matter here)
  for (const id of ['T2-S1-007', 'T2-S12-009', 'T2-S10-287', 'T2-S10-388', 'T2-S10-554', 'T2-S10-586']) assert.ok(!p.preExcluded.some(x => x.id === id && /^R1[12]_/.test(x.tier || '')), id);
});
test('Fm-00052 outcome: the four critical Uncertains no longer hold the run once R11 applies and T2-S5-006 passes', () => {
  const p = plan(REG);
  const before = ['T2-S1-007', 'T2-S4-007', 'T2-S5-006', 'T2-S12-009'].map(id => ({ id, status: 'uncertain' }));
  assert.strictEqual(computeHoldStatus(before, checklist).held, true, 'the four hold today');
  const eng = applyRuleExclusions({ checklist, t1Results: [], t2Results: before, domainFile: 'skill-infrastructure.md', modelText: REG, originalName: 'patch26-test', log: quiet, config: exclCfg, preExcluded: p.preExcluded });
  try { fs.unlinkSync(path.join(__dirname, 'data', 'rule-exclusions', 'patch26-test.json')); } catch (_) {}
  const left = before.filter(r => !eng.isExcluded(r.id)).map(r => r.id === 'T2-S5-006' ? { id: r.id, status: 'pass' } : r);
  assert.deepStrictEqual(left.map(r => r.id).sort(), ['T2-S4-007', 'T2-S5-006']);
  assert.strictEqual(computeHoldStatus(left, checklist).held, false);
});

console.log('Skill text and record types');
test('no_impossible_balances: missing working-capital lines are not uncertainty', () => {
  const k = read('config/skill.md'); const i = k.indexOf('### test: no_impossible_balances'); const sec = k.slice(i, k.indexOf('### test:', i + 10));
  assert.ok(/none of the balances this test names/.test(sec) && /not uncertainty/.test(sec) && /conclude on those/.test(sec));
});
test('T0-LINK-002 is an Observation; a neighbouring id is not', () => {
  assert.strictEqual(screeningRecordType('T0-LINK-002'), 'Observation');
  assert.strictEqual(screeningRecordType('T0-LINK-001'), null);
});
test('the step 6 text no longer says uploading', () => {
  for (const f of ['server.js', 'index.js']) assert.ok(!/Building report, uploading/.test(read(f)), f);
});

console.log('SUM-range scan');
function wbOf(cells, sheet = 'S') { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(sheet); for (const [a, f] of cells) ws.getCell(a).value = { formula: f, result: 1 }; return wb; }
const row = (r, cols, make) => cols.map(c => [c + r, make(c)]);
const COLS = ['E', 'F', 'G', 'H', 'I', 'J'];
const prev = c => String.fromCharCode(c.charCodeAt(0) - 1);
test('a running total is recognised, even inside a larger formula (the ESO allowance pattern)', () => {
  const r = scanSumRanges(wbOf(row(10, COLS, c => ` - SUM($D8:${prev(c)}8) * ${c}7`)));
  assert.strictEqual(r.kinds.running, 1); assert.strictEqual(r.flaggedCount, 0);
  assert.ok(/\$D8:E8/.test(r.runningRows[0].sample) || /\$D8:/.test(r.runningRows[0].sample), r.runningRows[0].sample);
});
test('fixed, rolling and running rows are told apart', () => {
  const r = scanSumRanges(wbOf([...row(10, COLS, () => 'SUM($B2:$B9)'), ...row(11, COLS, c => `SUM(${c}2:${c}9)`), ...row(12, COLS, c => `SUM($D3:${c}3)`)]));
  assert.deepStrictEqual([r.kinds.fixed, r.kinds.rolling, r.kinds.running], [1, 1, 1]);
});
test('a period that stops a row short is flagged', () => {
  const r = scanSumRanges(wbOf(row(20, COLS, c => c === 'H' ? 'SUM(H2:H8)' : `SUM(${c}2:${c}9)`)));
  assert.strictEqual(r.flaggedCount, 1); assert.strictEqual(r.findings[0].cell, 'H20'); assert.ok(/H2:H8/.test(r.findings[0].different));
});
test('a total pointing at the neighbouring column is flagged', () => {
  const r = scanSumRanges(wbOf(row(20, COLS, c => c === 'I' ? 'SUM(J2:J9)' : `SUM(${c}2:${c}9)`)));
  assert.strictEqual(r.flaggedCount, 1); assert.strictEqual(r.findings[0].cell, 'I20');
});
test('the first two periods of a row are the series boundary and are not flagged', () => {
  const r = scanSumRanges(wbOf(row(20, COLS, c => c === 'E' ? 'SUM(E2:E5)' : `SUM(${c}2:${c}9)`)));
  assert.strictEqual(r.flaggedCount, 0);
});
test('a yearly total (a horizontal sum among vertical ones) is not flagged', () => {
  const r = scanSumRanges(wbOf(row(20, COLS, c => c === 'J' ? 'SUM(E20:I20)' : `SUM(${c}2:${c}9)`)));
  assert.strictEqual(r.flaggedCount, 0);
});
test('SUMPRODUCT, multi-argument SUM, single cells and short rows are skipped', () => {
  const r = scanSumRanges(wbOf([...row(5, COLS, c => `SUMPRODUCT(${c}2:${c}4,${c}6:${c}8)`), ...row(6, COLS, c => `SUM(${c}2:${c}4,${c}9)`), ...row(7, COLS, c => `SUM(${c}2:${c}2)`), ['A1', 'SUM(A2:A9)'], ['B1', 'SUM(B2:B9)']]));
  assert.strictEqual(r.rowsScanned, 0);
});
test('SUMIFS reads its sum range', () => {
  const r = scanSumRanges(wbOf(row(30, COLS, c => `SUMIFS(${c}2:${c}9,$A2:$A9,"x")`)));
  assert.strictEqual(r.kinds.rolling, 1);
});
test('a workbook with no SUM is not applicable', () => assert.strictEqual(scanSumRanges(wbOf([['A1', 'B1+C1']])).applicable, false));
const ESO = ['/mnt/user-data/uploads/Final_Determinations_-_ESO_Licence_Model_FIXED.xlsm'].find(f => fs.existsSync(f));
if (ESO) {
  (async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(ESO);
    const r = scanSumRanges(wb);
    test('real ESO workbook: rows 365 and 375 are listed as running totals and nothing is flagged', () => {
      const rows = r.runningRows.filter(x => x.sheet === 'SystemOperator').map(x => x.row);
      assert.ok(rows.includes(365) && rows.includes(375), rows.join(','));
      assert.strictEqual(r.flaggedCount, 0);
    });
    console.log(`\n${passed} passed`);
  })();
} else { console.log('  (real ESO workbook not available here: real-file test skipped)'); console.log(`\n${passed} passed`); }

console.log('Wiring');
test('server.js and index.js both run the scan and register both ids', () => {
  for (const f of ['server.js', 'index.js']) { const s = read(f); assert.ok(/scanSumRanges\(parsed\._raw\)/.test(s) && /id: 'T0-SUMRANGE-001'/.test(s) && /id: 'T0-SUMRANGE-002'/.test(s), f); }
});
