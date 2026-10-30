'use strict';
// Patch 48: decision thresholds are applied by the recalculation, read only from an approved file, and never change the numeric result.
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const { thresholdsPathFor, decisionLogLines } = require('./src/utils/decision-thresholds');
let fails = 0;
const check = (n, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${n}`); if (!ok) fails++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thr-'));
fs.writeFileSync(path.join(dir, 'my-model.proposed.json'), '{}');
check('a .proposed.json file is never picked up', thresholdsPathFor('My_Model_12_7_2026.xlsx', dir) === null);
fs.writeFileSync(path.join(dir, 'my-model.json'), '{}');
check('an approved file is found by the stable model key, whatever the upload date', thresholdsPathFor('My_Model_12_7_2026.xlsx', dir) === path.join(dir, 'my-model.json') && thresholdsPathFor('My_Model_3_8_2026.xlsx', dir) === path.join(dir, 'my-model.json'));
check('no file means no thresholds', thresholdsPathFor('Unrelated.xlsx', dir) === null);
check('the shipped Bend file is a draft and is not read', thresholdsPathFor('Financial_Model_The_Bend_12_7_2026.xlsx') === null);

const ran = { decision_tests: { status: 'ran', results: [
  { id: 'A', operator: '>=', threshold: 1.2, units: 'x', cells_tested: 5, decision_changed: true, cells_not_recalculated: 0 },
  { id: 'B', operator: '>=', threshold: 2, units: 'x', cells_tested: 0, decision_changed: false, cells_not_recalculated: 3, not_recalculated_because: { 'MATCH() inside IFERROR/IFNA': 3 } }] } };
const lines = decisionLogLines(ran);
check('a changed decision is stated plainly', /DECISION DIFFERS/.test(lines[0]));
check('an unconfirmed threshold says not confirmed and why', /not confirmed/.test(lines[1]) && /MATCH\(\)/.test(lines[1]));
check('a rejected file is reported, not silently ignored', /not used/.test(decisionLogLines({ decision_tests: { status: 'not_used', file: 'x.json', problems: ['threshold 1: missing source'] } })[0]));
check('no thresholds means no log lines', decisionLogLines({}).length === 0 && decisionLogLines({ decision_tests: null }).length === 0);

for (const f of ['server.js', 'index.js']) {
  const src = fs.readFileSync(f, 'utf8');
  check(`${f} passes the approved thresholds file to the recalculation and logs the result`, /thresholdsPathFor\(originalName\)/.test(src) && /decisionLogLines\(recalcCheckResult\)/.test(src));
}

// End to end on The Bend when the model is available: thresholds change nothing in the numeric comparison.
const bend = '/mnt/user-data/uploads/Financial_Model_The_Bend_12_7_2026.xlsx';
if (fs.existsSync(bend)) {
  const run = args => { const r = spawnSync('python3', ['src/recalc_check.py', bend, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }); return JSON.parse(r.stdout.trim()); };
  const plain = run([]), withT = run(['config/decision-thresholds/the-bend.proposed.json']);
  check('Bend: without thresholds there is no decision section', plain.decision_tests === null);
  check('Bend: thresholds do not change the numeric comparison', plain.mismatch_count === withT.mismatch_count && plain.formula_cells_compared === withT.formula_cells_compared);
  const byId = Object.fromEntries(withT.decision_tests.results.map(r => [r.id, r]));
  check('Bend: ICR is tested on its formula cells', byId['ICR-min'].cells_tested === 10);
  check('Bend: DSCR is not claimed as confirmed (it depends on a MATCH inside IFERROR the engine cannot evaluate)', byId['DSCR-min'].cells_tested === 0 && byId['DSCR-min'].cells_not_recalculated > 0);
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, JSON.stringify({ thresholds: [{ id: 'X', sheet: 'Cashflow', row: 68, operator: '>=', value: 1.2, units: 'x', source: '' }] }));
  const rb = run([bad]);
  check('Bend: a bad thresholds file is reported and the recalculation still succeeds', rb.status === 'success' && rb.decision_tests.status === 'not_used' && rb.mismatch_count === plain.mismatch_count);
} else console.log('skip: Bend model not on this machine');

console.log(fails ? `${fails} FAILED` : 'All Patch 48 checks passed');
process.exit(fails ? 1 : 0);
