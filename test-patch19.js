#!/usr/bin/env node
// test-patch19.js - master findings: one per root cause, with occurrences; rows are never dropped.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { annotateMasterFindings, countMasters } = require('./src/utils/master-findings');
const { linkRelatedFindings } = require('./src/utils/related-findings');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const F = (id, priority, extra) => Object.assign({ id, priority, sheet: 'S', cell: 'A1', condition: '' }, extra);

console.log('Master findings');
test('findings in one group share a master id, the best priority and a combined occurrence count', () => {
  const fs_ = [
    F('T2-S1-003', 'P2', { related_group_id: 'RC-T2-S1-003', affected_cells: ['SystemOperator!AP254', 'NGESO!AN185'] }),
    F('T2-S3-002', 'P2', { related_group_id: 'RC-T2-S1-003', affected_cells: ['SystemOperator!AP254', 'SystemOperator!AP61'] }),
    F('T2-S3-005', 'P3', { related_group_id: 'RC-T2-S1-003', affected_cells: ['NGESO!AN185'] }),
    F('T2-S2-005', 'P2'),
  ];
  annotateMasterFindings(fs_);
  assert.ok(fs_.slice(0, 3).every(f => f.master_finding_id === 'RC-T2-S1-003' && f.master_priority === 'P2' && f.linked_findings === 3));
  assert.strictEqual(fs_[0].master_occurrences, 3);   // AP254, AN185, AP61
  assert.strictEqual(fs_[3].master_finding_id, 'T2-S2-005'); assert.strictEqual(fs_[3].linked_findings, 1);
});
test('a group counts once, at its highest priority', () => {
  const fs_ = [F('A', 'P2', { related_group_id: 'G' }), F('B', 'P3', { related_group_id: 'G' }), F('C', 'P2'), F('D', 'P3')];
  annotateMasterFindings(fs_);
  assert.deepStrictEqual(countMasters(fs_), { P1: 0, P2: 2, P3: 1 });
});
test('25 P2 rows of which 4 are look-alikes of one root cause is 22 master findings', () => {
  const fs_ = [];
  for (let i = 0; i < 25; i++) fs_.push(F('X' + i, 'P2'));
  fs_.push(F('X0b', 'P2', { related_group_id: 'RC-1' }), F('X1b', 'P2', { related_group_id: 'RC-1' }), F('X2b', 'P2', { related_group_id: 'RC-1' }), F('X3b', 'P2', { related_group_id: 'RC-1' }));
  const rows = fs_.slice(4);       // 21 single rows + a group of 4 look-alikes = 25 rows, 22 root causes
  annotateMasterFindings(rows);
  assert.strictEqual(rows.length, 25); assert.strictEqual(countMasters(rows).P2, 22);
});
test('nothing is dropped or merged', () => {
  const fs_ = [F('A', 'P2', { related_group_id: 'G' }), F('B', 'P2', { related_group_id: 'G' })];
  annotateMasterFindings(fs_); assert.strictEqual(fs_.length, 2); assert.notStrictEqual(fs_[0].id, fs_[1].id);
});
test('works on findings linked by shared cells (related-findings output)', () => {
  const fs_ = [
    F('T0-ERRLITERAL-001', 'P2', { affected_cells: ['FinancialRatios!AP138', 'FinancialRatios!AQ138'] }),
    F('T2-S4-006', 'P2', { condition: 'FinancialRatios!AP138 is IFERROR(...#REF!...); the same pattern repeats across AQ138.' , cell: 'AP138', sheet: 'FinancialRatios'}),
  ];
  linkRelatedFindings(fs_); annotateMasterFindings(fs_);
  assert.strictEqual(fs_[0].master_finding_id, fs_[1].master_finding_id); assert.strictEqual(countMasters(fs_).P2, 1);
});

console.log('Report');
function build(findings) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch19-'));
  fs.writeFileSync(path.join(tmp, 'd.json'), JSON.stringify({ modelName: 's', sourceFile: 's.xlsx', findings, ruleResults: [] }));
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
const mk = (id, extra) => Object.assign({ id, priority: 'P2', record_type: 'Confirmed Finding', severity: 'high', confidence: 80, sheet: 'SystemOperator', cell: 'AP254', condition: 'Literal 14.4495 embedded in ' + id, category: 'Formula', corrective_action: 'Move to an input.' }, extra);
test('the priority line shows the root-cause count and the Issue Log has Master Finding and Occurrences columns', () => {
  const g = { related_group_id: 'RC-A', master_finding_id: 'RC-A', master_priority: 'P2', linked_findings: 3, master_occurrences: 4 };
  const t = build([mk('T2-S1-003', g), mk('T2-S3-002', g), mk('T2-S3-005', g), mk('T2-S2-005', { cell: 'AP76' })]);
  const all = Object.values(t).flat().join(' | ');
  assert.ok(/4 P2 \(2 root causes\)/.test(all.replace(/\s+/g, ' ')), 'priority line: ' + (all.match(/Findings by priority[^|]*/) || ['none'])[0]);
  const il = t['Issue Log'].join(' | ');
  assert.ok(/Master\s*Finding/.test(il) && /Occur-/.test(il) && /RC-A/.test(il));
});
test('with no linked findings the line is unchanged', () => {
  const t = build([mk('T2-S2-005', { cell: 'AP76' }), mk('T2-S2-006', { cell: 'AP77' })]);
  const line = (Object.values(t).flat().join(' | ').match(/Findings by priority[^|]*\|[^|]*/) || [''])[0];
  assert.ok(!/root cause/.test(line), line);
});
console.log(`\n${passed} passed`);
