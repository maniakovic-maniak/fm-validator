#!/usr/bin/env node
// test-patch22.js - T1-006 reads labels outside column A; tier R9 scopes out five not-applicable procedures;
// T2-S1-001/S1-002 get skill text and the purpose absence is rated as governance (P3).
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { runTier1 } = require('./src/validator-tier1');
const { applyFindingClasses } = require('./src/utils/finding-class');
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const parsedFrom = wb => ({ sheetNames: wb.worksheets.map(w => w.name), sheets: {}, _raw: wb, _type: 'exceljs' });
const t1 = (p, id) => runTier1(p, {}).filter(r => r.id === id || r.id.startsWith(`${id}-`));
const rd = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

(async () => {
  console.log('T1-006 label column');
  await test('label in column E ("Closing RAV") is found and a positive series passes', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('FinancialStatements');
    ws.addRow([null, null, 'Nominal RAV']); ws.addRow([null, null, null, null, 'Opening RAV', null, '£m nominal', 100, 110]);
    ws.addRow([null, null, null, null, 'Closing RAV', null, '£m nominal', 294.3, 329.3]);
    assert.strictEqual(t1(parsedFrom(wb), 'T1-006')[0].status, 'pass');
  });
  await test('a negative Closing RAV in column E is flagged', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('FinancialStatements');
    ws.addRow([null, null, null, null, 'Closing RAV', null, '£m nominal', 294.3, -5]);
    const r = t1(parsedFrom(wb), 'T1-006'); assert.strictEqual(r[0].status, 'fail'); assert.ok(/-5/.test(r[0].reason));
  });
  await test('a number in a column left of the label is not read as a value', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Balance Sheet');
    ws.addRow([-1, 'Property, plant and equipment', 50, 47]);
    assert.strictEqual(t1(parsedFrom(wb), 'T1-006')[0].status, 'pass');
  });
  await test('depreciation rows are still ignored; column A labels still work; no row stays uncertain', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Financial Statements');
    ws.addRow(['Depreciation of PP&E', -3, -3]); ws.addRow(['Fixed assets', 50, 47]);
    assert.strictEqual(t1(parsedFrom(wb), 'T1-006')[0].status, 'pass');
    const wb2 = new ExcelJS.Workbook(); wb2.addWorksheet('Balance Sheet').addRow(['Inventory', 1]);
    assert.strictEqual(t1(parsedFrom(wb2), 'T1-006')[0].status, 'uncertain');
  });

  console.log('Scope tier R9');
  const cfg = JSON.parse(rd('config/rule-exclusions.json'));
  const tiers = cfg.profiles.find(p => p.id === 'regulated_network_utility').tiers;
  const R9 = ['T2-S10-362', 'T2-S10-375', 'T2-S10-452', 'T2-S10-492', 'T2-S10-776'];
  const t = tiers['R9_scope_decision_regulated_network_ppp_economic_not_applicable'];
  await test('R9 exists, is enabled, does not allow fatal, holds exactly the five ids', () => {
    assert.ok(t && t.enabled === true && t.allowFatal === false); assert.deepStrictEqual(t.ruleIds, R9);
  });
  await test('the three undecided procedures stay in scope and no id sits in two tiers', () => {
    const all = Object.entries(tiers).filter(([k]) => k !== 'R9_scope_decision_regulated_network_ppp_economic_not_applicable').flatMap(([, v]) => v.ruleIds || []);
    for (const id of ['T2-S10-336', 'T2-S10-369', 'T2-S10-468', 'T2-S13-008']) assert.ok(!R9.includes(id) && !all.includes(id) || id === 'T2-S13-008', id);
    for (const id of R9) assert.ok(!all.includes(id), `${id} in two tiers`);
  });
  await test('none of the five is fatal', () => {
    const cl = require('./config/checklist.json'); const by = new Map(cl.tier2.map(r => [r.id, r]));
    for (const id of R9) assert.ok(by.has(id) && by.get(id).severity !== 'fatal', id);
  });

  console.log('S1-001 / S1-002');
  await test('a missing purpose statement in the regulated profile is capped to P3 (not a critical)', () => {
    const f = [{ id: 'T2-S1-001', severity: 'critical' }];
    applyFindingClasses(f, { profileId: 'regulated_network_utility' });
    assert.strictEqual(f[0].severity, 'low');
  });
  await test('the same finding in another profile keeps its severity', () => {
    const f = [{ id: 'T2-S1-001', severity: 'critical' }]; applyFindingClasses(f, { profileId: null });
    assert.strictEqual(f[0].severity, 'critical');
  });
  await test('FAST principles is no longer manual-only and the skill tells the reviewer to conclude', () => {
    const rule = require('./config/checklist.json').tier2.find(r => r.id === 'T2-S1-002');
    assert.strictEqual(rule.manual_only, false);
    const s = rd('config/skill.md'); const i = s.indexOf('### test: fast_principles');
    const sec = s.slice(i, s.indexOf('### test:', i + 10));
    assert.ok(/Fail when High or Critical/.test(sec) && !/Return uncertain with confidence 30/.test(sec));
  });
  await test('purpose_documented says a cover with only a title and version is a fail, not uncertain', () => {
    const s = rd('config/skill.md'); const i = s.indexOf('### test: purpose_documented');
    assert.ok(/return fail/.test(s.slice(i, s.indexOf('### test:', i + 10))));
  });
  console.log(`\n${passed} passed`);
})();
