#!/usr/bin/env node
// test-patch9.js - follow-ups from the independent review of the Fm-00046 ESO report (Business Report tab):
//   1. Tier 2 prompt: label-first naming, scenario snapshots are deliberate, switch fixes show both branches
//   2. reliance wording follows open blockers (no "reliance-ready" beside an unresolved Critical Query)
//   3. the completion tile says what it measures
//   4. Reasonableness Review tests AICR and RoRE floors for regulated models
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');
const { checkRegulatedReturnParams } = require('./src/utils/reasonableness-checks');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }

console.log('Prompt');
const skill = fs.readFileSync(path.join(__dirname, 'config', 'skill.md'), 'utf8');
test('Step 5c tells the reviewer to quote the row label before naming a constant', () => {
  assert.ok(/quote the row's existing label first/.test(skill));
});
test('Step 5c treats macro-pasted scenario results as deliberate snapshots', () => {
  assert.ok(/are deliberate snapshots/.test(skill) && /Do not recommend replacing them with live links/.test(skill));
});
test('Step 5c requires both switch positions to be shown', () => {
  assert.ok(/with the flag both ways/.test(skill));
});

console.log('Regulated outcomes');
function wbWith(rows) { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('FinancialRatios'); rows.forEach(r => ws.addRow(r)); return wb; }
function farRow(label, vals) { const r = [null, null, null, null, label]; while (r.length < 41) r.push(null); return r.concat(vals); }
test('AICR below 1.0x in any year is flagged, at the lowest year, with its cell', () => {
  const r = checkRegulatedReturnParams(wbWith([farRow('Adjusted Cash Interest Coverage Ratio (AICR)', [0.724, 0.403, 0.588, 0.82, 0.863])]));
  const a = r.results.find(x => /AICR/.test(x.metric));
  assert.ok(a && a.flagged && Math.abs(a.value - 0.403) < 1e-9 && a.unit === 'multiple' && a.high === null);
  assert.ok(/^FinancialRatios!AQ1$/.test(a.location), a.location);
});
test('AICR that stays above 1.0x is in range', () => {
  const r = checkRegulatedReturnParams(wbWith([farRow('AICR ESO Adjusted', [1.4, 1.6, 1.5])]));
  assert.strictEqual(r.results.find(x => /AICR/.test(x.metric)).flagged, false);
});
test('a negative RoRE year is flagged; a positive series is not', () => {
  const bad = checkRegulatedReturnParams(wbWith([farRow('RoRE (based on NPV neutral values)', [-0.0245, -0.0261, -0.0175, 0.01])]));
  assert.strictEqual(bad.results.find(x => /RoRE/.test(x.metric)).flagged, true);
  const ok = checkRegulatedReturnParams(wbWith([farRow('RoRE (based on closing values)', [0.02, 0.03, 0.04])]));
  assert.strictEqual(ok.results.find(x => /RoRE/.test(x.metric)).flagged, false);
});
test('scenario input rows ("RoRE underperf. -100 bps") are not outcomes', () => {
  const r = checkRegulatedReturnParams(wbWith([farRow('RoRE underperf. -100 bps', [-0.01, -0.01]), farRow('RoRE as per allowed return', [0.0757, 0.0757])]));
  assert.strictEqual(r.applicable, false);
});
test('a single value is not a series', () => {
  const r = checkRegulatedReturnParams(wbWith([farRow('AICR', [0.5])]));
  assert.strictEqual(r.applicable, false);
});

console.log('Report');
function build(payload) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch9-'));
  fs.writeFileSync(path.join(tmp, 'd.json'), JSON.stringify(payload));
  const r = spawnSync('python3', [path.join(__dirname, 'src', 'build_report.py'), path.join(tmp, 'd.json'), path.join(tmp, 'o.xlsx')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const chk = spawnSync('python3', ['-c', `
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(path.join(tmp, 'o.xlsx'))}, read_only=True)
def texts(n): return [str(v) for row in wb[n].iter_rows(values_only=True) for v in row if v is not None]
print(json.dumps({'ao': texts('Audit Output'), 'sr': texts('Scope and Reliance'), 'rr': texts('Reasonableness Review')}))
`], { encoding: 'utf8' });
  assert.strictEqual(chk.status, 0, chk.stderr);
  return JSON.parse(chk.stdout);
}
const checklist = require('./config/checklist.json');
const rules = checklist.tier2.slice(0, 40);
const ruleResults = rules.map(r => ({ id: r.id, status: 'pass', confidence: 80, needs_retest: false, reason: null }));
const regBad = checkRegulatedReturnParams(wbWith([farRow('Adjusted Cash Interest Coverage Ratio (AICR)', [0.7, 0.4, 0.6]), farRow('Vanilla WACC', [0.0331, 0.0333])]));
const cq = { id: 'T2-S3-005', record_type: 'Critical Query', severity: 'critical', confidence: 50, sheet: 'S', cell: 'A1', condition: 'x', reason: 'x', category: 'Inputs' };
const base = { modelName: 'smoke', sourceFile: 'smoke.xlsx', ruleResults, findings: [], reasonableness: { waccOverride: { applicable: false }, terminalValue: { applicable: false }, outputs: { applicable: false, results: [], flaggedCount: 0 }, revenuePerUnit: { applicable: false }, terminalValueCrossCheck: { applicable: false }, regulatedReturns: regBad } };
test('with an unresolved Critical Query the status and the reliance decision both say "not ready"', () => {
  const o = build(Object.assign({}, base, { findings: [cq] }));
  const ao = o.ao.join(' | '), sr = o.sr.join(' | ');
  assert.ok(!/Ready for internal review only/.test(ao) || /Not ready for reliance/.test(ao), ao.slice(0, 400));
  assert.ok(!/Reliance-ready — internal review only/.test(sr), 'old wording still on Scope and Reliance');
  assert.ok(/Not (reliance-ready|ready for reliance)/i.test(sr), sr.slice(0, 400));
  assert.ok(/Critical Quer/.test(sr.split('RELIANCE DECISION')[1] || ''), 'the decision text should name the open blocker');
});
test('the completion tile carries its meaning', () => {
  const o = build(base);
  assert.ok(o.ao.some(t => /measures checklist coverage/.test(t) && /not independent verification/.test(t)));
});
test('the Reasonableness tab shows AICR as a multiple with a floor and marks it Review', () => {
  const o = build(base);
  assert.ok(o.rr.includes('REGULATED RETURN PARAMETERS AND OUTCOMES'));
  assert.ok(o.rr.includes('0.40x') && o.rr.includes('at least 1.00x') && o.rr.includes('Review'), o.rr.join(' | ').slice(0, 600));
});

console.log(`\n${passed} check(s) passed`);
