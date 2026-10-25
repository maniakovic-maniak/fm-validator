#!/usr/bin/env node
// test-patch13.js - an "uncertain" Tier 2 answer that still has an Issue Log entry is labelled as not concluded in both views.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }

function build(payload) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch13-'));
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
const all = o => Object.values(o).flat().join(' | ');
const finding = id => ({ id, priority: 'P2', severity: 'critical', confidence: 50, sheet: 'FS', cell: 'B2', category: 'Accounting', condition: 'Equity movement could not be tied to the cash flow', reason: 'x', record_type: 'Query' });
const base = (results, findings) => ({ modelName: 's', sourceFile: 's.xlsx', ruleResults: results, findings });

console.log('Uncertain with an Issue Log entry');
const unc = build(base([{ id: 'T2-S5-004', status: 'uncertain', confidence: 50 }], [finding('T2-S5-004')]));
test('the Issue Log entry says the procedure was not concluded', () => {
  assert.ok(/\[Procedure not concluded: the reviewer was uncertain/.test(all(unc)));
  assert.ok((unc['Issue Log'] || []).join(' | ').includes('Procedure not concluded'));
});
test('the Validation Matrix says it is not counted as completed and names the Issue Log entry', () => {
  const m = (unc['Validation Matrix'] || []).join(' | ');
  assert.ok(/recorded an open question in the Issue Log \(T2-S5-004\)\. It is not counted as completed/.test(m));
  assert.ok(/1 Uncertain procedure\(s\) also have an open question in the Issue Log/.test(m));
});
test('the completion figure is unchanged: the rule still counts as Uncertain, not as concluded', () => {
  const { computeCompletion } = require('./src/utils/rule-scope');
  const c = computeCompletion([{ id: 'T2-S5-004', severity: 'critical' }], [{ id: 'T2-S5-004', status: 'uncertain' }]).counts;
  assert.strictEqual(c.uncertain, 1); assert.strictEqual(c.issue, 0); assert.strictEqual(c.concludedPct, 0);
});

console.log('Raised issue is untouched');
const raised = build(base([{ id: 'T2-S5-004', status: 'P2', confidence: 80 }], [Object.assign(finding('T2-S5-004'), { confidence: 80, record_type: 'Confirmed Finding' })]));
test('a rule that raised an issue gets no "not concluded" label anywhere', () => {
  assert.ok(!/Procedure not concluded/.test(all(raised)));
  assert.ok(!/not counted as completed/.test(all(raised)));
});
test('a rule with an uncertain and a raised result (two problems) is treated as raised', () => {
  const mix = build(base([{ id: 'T2-S5-004', status: 'uncertain', confidence: 50 }, { id: 'T2-S5-004', status: 'P2', confidence: 80 }], [finding('T2-S5-004')]));
  assert.ok(!/Procedure not concluded/.test(all(mix)));
});

console.log(`\n${passed} check(s) passed`);
