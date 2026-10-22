#!/usr/bin/env node
// test-patch7.js - follow-ups from the Fm-00045 ESO run:
//   1. a medium/low severity disclosure absence at low confidence is a Query, not a Critical Query
//   2. seven "not applicable to this model type" procedures are scoped out for a regulated network model
//   3. the Reasonableness Review tab tests regulated return parameters (vanilla WACC, cost of equity, notional gearing)
//      and explains N/A
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');
const { classifyRecordType } = require('./src/utils/record-type-classifier');
const { checkRegulatedReturnParams } = require('./src/utils/reasonableness-checks');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }

console.log('Classifier');
const absence = o => Object.assign({
  id: 'T2-S5-008', severity: 'medium', confidence: 45, cell: 'A1', sheet: 'FinancialStatements', category: 'Tax', root_cause: 'Deferred tax not presented',
  condition: 'Not present in the workbook: no deferred tax asset/liability line appears on the balance sheet.'
}, o);
test('medium severity absence at 45% confidence touching tax is a Query, not a Critical Query', () => {
  assert.strictEqual(classifyRecordType(absence({})), 'Query');
});
test('low severity absence is a Query too', () => {
  assert.strictEqual(classifyRecordType(absence({ severity: 'low' })), 'Query');
});
test('fatal, critical and high severity absences keep the Critical Query escalation', () => {
  for (const sev of ['fatal', 'critical', 'high']) assert.strictEqual(classifyRecordType(absence({ severity: sev })), 'Critical Query', sev);
});
test('a medium severity finding that points at a real cell is still escalated when it touches a key output area', () => {
  const f = absence({ cell: 'AP94', condition: 'FinancialRatios!AP94 deferred tax balance is hardcoded.' });
  assert.strictEqual(classifyRecordType(f), 'Critical Query');
});
test('an absence the reviewer anchored to a nearby cell (Fm-00046: SystemOperator!AP658) is a Query too', () => {
  assert.strictEqual(classifyRecordType(absence({ cell: 'AP658', sheet: 'SystemOperator' })), 'Query');
});
test('a non-absence medium finding below 60% that touches a key output area stays a Critical Query', () => {
  assert.strictEqual(classifyRecordType(absence({ cell: 'AP573', condition: 'AP561-573 models a notional equity issuance triggered by a gearing threshold.' })), 'Critical Query');
});
test('an absence at 60%+ confidence is unchanged (Confirmed Finding)', () => {
  assert.strictEqual(classifyRecordType(absence({ confidence: 70 })), 'Confirmed Finding');
});
test('below 40% it is still an Observation', () => {
  assert.strictEqual(classifyRecordType(absence({ confidence: 30 })), 'Observation');
});

console.log('Scope');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'rule-exclusions.json'), 'utf8'));
const tiers = cfg.profiles.find(p => p.id === 'regulated_network_utility').tiers;
const NA7 = ['T2-S10-354', 'T2-S10-381', 'T2-S10-429', 'T2-S10-453', 'T2-S10-461', 'T2-S10-503', 'T2-S10-720'];
test('the seven not-applicable procedures are in one new tier, enabled, not fatal-gate', () => {
  const t = tiers.R6_scope_decision_regulated_network_not_applicable;
  assert.ok(t && t.enabled === true && t.allowFatal === false);
  assert.deepStrictEqual(t.ruleIds.slice().sort(), NA7.slice().sort());
});
test('no rule id appears in two tiers', () => {
  const seen = new Map();
  for (const [name, t] of Object.entries(tiers)) for (const id of t.ruleIds || []) {
    assert.ok(!seen.has(id), `${id} in ${seen.get(id)} and ${name}`); seen.set(id, name);
  }
});
test('every id exists in checklist.json and none is fatal or critical', () => {
  const text = fs.readFileSync(path.join(__dirname, 'config', 'checklist.json'), 'utf8');
  const all = JSON.parse(text);
  const byId = {};
  (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.id) byId[o.id] = o; Object.values(o).forEach(walk); } })(all);
  for (const id of NA7) { assert.ok(byId[id], id); assert.ok(!['fatal', 'critical'].includes(byId[id].severity), id); }
});

const NA6 = ['T2-S7-005', 'T2-S10-353', 'T2-S10-425', 'T2-S10-451', 'T2-S10-493', 'T2-S10-709'];
test('the six no-such-structure procedures are in tier R7, enabled, not fatal-gate, none fatal or critical', () => {
  const t = tiers.R7_scope_decision_regulated_network_no_such_structure;
  assert.ok(t && t.enabled === true && t.allowFatal === false);
  assert.deepStrictEqual(t.ruleIds.slice().sort(), NA6.slice().sort());
  const byId = {};
  (function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.id) byId[o.id] = o; Object.values(o).forEach(walk); } })(JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'checklist.json'), 'utf8')));
  for (const id of NA6) assert.ok(byId[id] && !['fatal', 'critical'].includes(byId[id].severity), id);
});

console.log('Regulated return parameters');
function wbWith(rows) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Outputs');
  for (const r of rows) ws.addRow(r);
  return wb;
}
// values sit far to the right of the label, as in a licence model (label in E, series from AP)
function farRow(label, vals) { const r = [null, null, null, null, label]; while (r.length < 41) r.push(null); return r.concat(vals); }
test('finds labelled rows whose values are far to the right and reports in-range values as OK', () => {
  const r = checkRegulatedReturnParams(wbWith([
    farRow('Vanilla WACC', [0.0331, 0.0333]), farRow('Cost of equity', [0.0757]), farRow('Notional gearing', [0.55]),
  ]));
  assert.strictEqual(r.applicable, true);
  assert.strictEqual(r.results.length, 3);
  assert.strictEqual(r.flaggedCount, 0);
  assert.ok(Math.abs(r.results[0].value - 0.0331) < 1e-9);
});
test('a percentage entered as a whole number is read as a percentage, not 331%', () => {
  const r = checkRegulatedReturnParams(wbWith([farRow('Vanilla WACC', [3.31])]));
  assert.ok(Math.abs(r.results[0].value - 0.0331) < 1e-9);
  assert.strictEqual(r.flaggedCount, 0);
});
test('out-of-range values are flagged, with their location', () => {
  const r = checkRegulatedReturnParams(wbWith([farRow('Vanilla WACC', [0.0004]), farRow('Notional gearing', [0.95])]));
  assert.strictEqual(r.flaggedCount, 2);
  assert.ok(/^Outputs!/.test(r.results[0].location));
});
test('a repeated label across scenario blocks resolves to the most common first value', () => {
  const r = checkRegulatedReturnParams(wbWith([
    farRow('Vanilla WACC', [0.0331]), farRow('Vanilla WACC', [0.0331]), farRow('Vanilla WACC', [0.0331]), farRow('Vanilla WACC', [0.09]),
  ]));
  assert.strictEqual(r.results.length, 1);
  assert.ok(Math.abs(r.results[0].value - 0.0331) < 1e-9);
  assert.strictEqual(r.results[0].candidateCount, 4);
});
test('formula cells use their cached result', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Outputs');
  const row = farRow('Cost of equity', []); ws.addRow(row); ws.getCell(1, 42).value = { formula: 'B1*2', result: 0.0757 };
  const r = checkRegulatedReturnParams(wb);
  assert.ok(Math.abs(r.results[0].value - 0.0757) < 1e-9);
});
test('a workbook with none of these rows is not applicable', () => {
  const r = checkRegulatedReturnParams(wbWith([['Revenue', 1, 2, 3]]));
  assert.strictEqual(r.applicable, false);
  assert.deepStrictEqual(r.results, []);
});
test('backup sheets are skipped', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Outputs (backup)'); ws.addRow(farRow('Vanilla WACC', [0.0331]));
  assert.strictEqual(checkRegulatedReturnParams(wb).applicable, false);
});

console.log('Report');
test('the tab shows the regulated table and the N/A explanation; the summary names the regulated parameters', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch7-'));
  const reg = checkRegulatedReturnParams(wbWith([farRow('Vanilla WACC', [0.0331]), farRow('Notional gearing', [0.95])]));
  const payload = { modelName: 'smoke', sourceFile: 'smoke.xlsx', findings: [], ruleResults: [], reasonableness: { waccOverride: { applicable: false }, terminalValue: { applicable: false }, outputs: { applicable: false, results: [], flaggedCount: 0 }, revenuePerUnit: { applicable: false }, terminalValueCrossCheck: { applicable: false }, regulatedReturns: reg } };
  fs.writeFileSync(path.join(tmp, 'd.json'), JSON.stringify(payload));
  const r = spawnSync('python3', [path.join(__dirname, 'src', 'build_report.py'), path.join(tmp, 'd.json'), path.join(tmp, 'o.xlsx')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const chk = spawnSync('python3', ['-c', `
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(path.join(tmp, 'o.xlsx'))}, read_only=True)
t = [str(v) for row in wb['Reasonableness Review'].iter_rows(values_only=True) for v in row if v is not None]
a = [str(v) for row in wb['Audit Output'].iter_rows(values_only=True) for v in row if v is not None]
print(json.dumps({'sec': 'REGULATED RETURN PARAMETERS AND OUTCOMES' in t, 'vw': 'Vanilla WACC' in t, 'review': 'Review' in t, 'legend': any('It is not a pass' in x for x in t),
                  'summary': any('regulated return parameter' in x for x in a)}))
`], { encoding: 'utf8' });
  assert.strictEqual(chk.status, 0, chk.stderr);
  const o = JSON.parse(chk.stdout);
  assert.ok(o.sec && o.vw && o.review && o.legend && o.summary, JSON.stringify(o));
});

console.log(`\n${passed} check(s) passed`);
