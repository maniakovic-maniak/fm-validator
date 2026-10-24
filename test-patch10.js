#!/usr/bin/env node
// test-patch10.js - truthfulness fixes from the developer refinement report:
//   1. an unrecognised recalculation status never reads as a clean recalculation
//   2. a finding that is absent from a run is reported as "not found in this run", not closed
//   3. a failed chunk batch stays on the record as partial coverage when another chunk answered the rule
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }

function build(extra) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patch10-'));
  const payload = Object.assign({ modelName: 'smoke', sourceFile: 'smoke.xlsx', findings: [], ruleResults: [] }, extra);
  fs.writeFileSync(path.join(tmp, 'd.json'), JSON.stringify(payload));
  const r = spawnSync('python3', [path.join(__dirname, 'src', 'build_report.py'), path.join(tmp, 'd.json'), path.join(tmp, 'o.xlsx')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const chk = spawnSync('python3', ['-c', `
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(path.join(tmp, 'o.xlsx'))}, read_only=True)
out = {}
for ws in wb.worksheets:
    out[ws.title] = [str(v) for row in ws.iter_rows(values_only=True) for v in row if v is not None]
print(json.dumps(out))
`], { encoding: 'utf8' });
  assert.strictEqual(chk.status, 0, chk.stderr);
  return JSON.parse(chk.stdout);
}
const all = o => Object.values(o).flat().join(' | ');

console.log('Recalculation status');
for (const st of ['batch_evaluation_failed', 'error', 'some_new_status']) {
  test(`status "${st}" is shown as not performed, never as a clean recalculation`, () => {
    const t = all(build({ recalcCheckResult: { status: st, error: 'boom' } }));
    assert.ok(!/found zero cells where the displayed result differs/.test(t), 'printed a clean result');
    assert.ok(new RegExp(`did not complete for this workbook \\(status: ${st}\\)`).test(t));
  });
}
test('a status of "success" with no mismatches still reads as a performed recalculation', () => {
  const t = all(build({ recalcCheckResult: { status: 'success', mismatch_count: 0, formula_cells_checked: 100, genuine_circular_groups: 0 } }));
  assert.ok(/found zero cells where the displayed result differs/.test(t));
});

console.log('Since last run');
const crs = { closed: [], new: [], regressed: [], stillOpen: [], isFirstRun: false, closedFindingCount: 3, closedDeterministicCount: 1, closedLlmCount: 2, newFindingCount: 0, stillOpenFindingCount: 4, regressedFindingCount: 0 };
test('absent findings are called "not found in this run", with a note that this is not evidence of a fix', () => {
  const t = all(build({ crossRunStats: crs }));
  assert.ok(/not found in this run/.test(t));
  assert.ok(/NOT FOUND THIS RUN/.test(t));
  assert.ok(/not evidence that it was fixed/.test(t));
  assert.ok(!/\b\d+ closed ·/.test(t) && !/'CLOSED'|\bCLOSED\b/.test(t), 'old "closed" wording still present');
});

console.log('Partial coverage');
test('a failed chunk batch whose rules another chunk answered is kept as partial coverage', () => {
  const t = all(build({ partialCoverage: [{ label: 'Batch 2 [data 2/3]', error: 'timeout', ruleIds: ['T2-S5-001', 'T2-S5-002'] }] }));
  assert.ok(/partial coverage, this run only/.test(t) && /Partially performed/.test(t));
  assert.ok(/2 rule\(s\) it covered were answered from the other data chunk/.test(t));
});
test('validator-tier2 records the gap instead of clearing it', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src', 'validator-tier2.js'), 'utf8');
  assert.ok(/partialCoverage\.push\(/.test(src) && /_partialCoverage/.test(src));
  assert.ok(/partialCoverage:\s+t2Results\._partialCoverage/.test(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')));
});

console.log(`\n${passed} check(s) passed`);
