#!/usr/bin/env node
// test-patch11.js - two different problems under one rule must both survive the chunk merge and the report.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { reconcileDataSplitResults } = require('./src/utils/reconcile-sub-batch-results');
const { computeCompletion } = require('./src/utils/rule-scope');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const R = (id, status, sheet, cell, extra) => Object.assign({ id, status, sheet, cell, confidence: 80, reason: `${id} ${status} ${sheet}!${cell}` }, extra || {});

console.log('Merge');
test('two different errors under one rule, one per chunk, both survive with their locations', () => {
  const out = reconcileDataSplitResults([[R('T2-S5-001', 'P2', 'IS', 'D10')], [R('T2-S5-001', 'P2', 'BS', 'F44')]]);
  assert.deepStrictEqual(out.map(r => `${r.sheet}!${r.cell}`).sort(), ['BS!F44', 'IS!D10']);
});
test('the same problem found by two chunks is kept once', () => {
  const out = reconcileDataSplitResults([[R('T2-S5-001', 'P2', 'IS', 'D10')], [R('T2-S5-001', 'P1', 'IS', 'd10')]]);
  assert.strictEqual(out.length, 1);
});
test('an issue in one chunk beats a pass and an uncertain elsewhere, which are dropped', () => {
  const out = reconcileDataSplitResults([[R('T2-S5-001', 'uncertain', 'A', 'A1')], [R('T2-S5-001', 'pass', 'A', 'A1')], [R('T2-S5-001', 'P3', 'IS', 'D10')]]);
  assert.strictEqual(out.length, 1); assert.strictEqual(out[0].status, 'P3');
});
test('pass beats uncertain; a rule with no issue keeps exactly one result', () => {
  const out = reconcileDataSplitResults([[R('T2-S5-002', 'uncertain', 'A', 'A1')], [R('T2-S5-002', 'pass', 'A', 'A1')]]);
  assert.strictEqual(out.length, 1); assert.strictEqual(out[0].status, 'pass');
});
test('two different absences (no real cell) under one rule are both kept; the same absence is not doubled', () => {
  const a = R('T2-S9-001', 'P2', 'N/A', 'A1', { condition: 'Not present in the workbook: no scenario selector' });
  const b = R('T2-S9-001', 'P2', 'N/A', 'A1', { condition: 'Not present in the workbook: no sensitivity table' });
  assert.strictEqual(reconcileDataSplitResults([[a], [b]]).length, 2);
  assert.strictEqual(reconcileDataSplitResults([[a], [Object.assign({}, a)]]).length, 1);
});
test('a rule seen in only one chunk comes back unchanged; other rules are unaffected', () => {
  const x = R('T2-S1-001', 'pass', 'A', 'A1');
  const out = reconcileDataSplitResults([[x, R('T2-S1-002', 'P2', 'S', 'B2')], [R('T2-S1-002', 'P2', 'S', 'B2')]]);
  assert.strictEqual(out.find(r => r.id === 'T2-S1-001'), x);
  assert.strictEqual(out.filter(r => r.id === 'T2-S1-002').length, 1);
});

console.log('Completion and matrix');
test('completion counts a rule once however many problems it raised', () => {
  const planned = [{ id: 'T2-S5-001', severity: 'high' }, { id: 'T2-S5-002', severity: 'high' }];
  const one = computeCompletion(planned, [R('T2-S5-001', 'P2', 'IS', 'D10'), R('T2-S5-002', 'pass', 'A', 'A1')]).counts;
  const two = computeCompletion(planned, [R('T2-S5-001', 'P2', 'IS', 'D10'), R('T2-S5-001', 'P2', 'BS', 'F44'), R('T2-S5-002', 'pass', 'A', 'A1')]).counts;
  assert.deepStrictEqual(two, one);
  assert.strictEqual(two.issue, 1);
});

console.log('Report');
function build(payload) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch11-'));
  fs.writeFileSync(path.join(tmp, 'd.json'), JSON.stringify(payload));
  const r = spawnSync('python3', [path.join(__dirname, 'src', 'build_report.py'), path.join(tmp, 'd.json'), path.join(tmp, 'o.xlsx')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const chk = spawnSync('python3', ['-c', `
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(path.join(tmp, 'o.xlsx'))}, read_only=True)
print(json.dumps({ws.title: [str(v) for row in ws.iter_rows(values_only=True) for v in row if v is not None] for ws in wb.worksheets}))
`], { encoding: 'utf8' });
  assert.strictEqual(chk.status, 0, chk.stderr);
  return JSON.parse(chk.stdout);
}
const checklist = require('./config/checklist.json');
const fatal = checklist.tier2.find(r => r.severity === 'fatal');
test('a fatal rule with one pass and one issue is still an incomplete mandatory procedure (the later pass must not hide it)', () => {
  const mand = [...checklist.tier1, ...checklist.tier2].filter(r => r.severity === 'fatal' || /fatal gate/i.test(String(r.source_section || '')));
  const allPass = mand.map(r => ({ id: r.id, status: 'pass', confidence: 80 }));
  const mk = list => Object.values(build({ modelName: 's', sourceFile: 's.xlsx', findings: [], ruleResults: list })).flat().join(' | ');
  assert.ok(!/incomplete mandatory critical procedure/.test(mk(allPass)), 'baseline should have no mandatory gap');
  const target = mand[0].id;
  const mixed = allPass.filter(r => r.id !== target).concat([{ id: target, status: 'P1', confidence: 80, sheet: 'IS', cell: 'D10' }, { id: target, status: 'pass', confidence: 80 }]);
  assert.ok(/1 incomplete mandatory critical procedure/.test(mk(mixed)));
});

console.log(`\n${passed} check(s) passed`);
