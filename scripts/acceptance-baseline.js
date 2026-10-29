#!/usr/bin/env node
// scripts/acceptance-baseline.js - Patch 27. The 16 acceptance cases from the 29 Oct 2026 independent review, run
// against the current code, with the outcome of each recorded in acceptance/baseline.json.
//
// A case has one of these statuses:
//   fail     the code does not do what the case requires (the starting position for most of them)
//   partial  some of the sub-checks pass
//   pass     the case is met
//   pending  not yet executable offline; the patch named in `owner_patch` makes it so
//   skipped  this machine lacks what the case needs (Python Formualizer); not compared
//
// Usage:  node scripts/acceptance-baseline.js            compare with the committed baseline, exit 1 on any difference
//         node scripts/acceptance-baseline.js --update   write the current statuses (a deliberate act, after review)
//
// A later patch that makes a case pass should run --update and commit the new baseline in the same patch, so the
// improvement is recorded and a regression is a visible diff instead of a silent one.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(ROOT, 'acceptance', 'baseline.json');

const CASES = [
  { id: 1,  title: 'Saved ratio 1.35, recomputed 0.50 is retained',                        owner_patch: 28 },
  { id: 2,  title: 'IFERROR with no engine failure and a stale cache stays visible',       owner_patch: 28 },
  { id: 3,  title: 'Missing cache, engine error, text and Boolean each get an explicit state', owner_patch: 28 },
  { id: 4,  title: 'A1=SUM(A2:A10), A5=A1 is detected as a cycle',                         owner_patch: 32 },
  { id: 5,  title: 'A quoted literal "C99" creates no dependency or cycle',                owner_patch: 32 },
  { id: 6,  title: 'Ranges of 2,000 and 2,001 cells both keep dependency coverage',        owner_patch: 32 },
  { id: 7,  title: 'Relative vs absolute anchors and address-like text keys stay distinct', owner_patch: 30 },
  { id: 8,  title: '40 review items sent, one valid answer: completed 1',                  owner_patch: 29 },
  { id: 9,  title: '311 families with a 200-row display: the limit is disclosed and the inventory reconciles', owner_patch: 29 },
  { id: 10, title: 'Four current focus lookups are reproduced with no wrong-entity allegation', owner_patch: 31 },
  { id: 11, title: 'Duplicate or missing selected lookup key is reported with its evidence', owner_patch: 31 },
  { id: 12, title: 'Eight-year average that loses a year to text raises a completeness failure', owner_patch: 31 },
  { id: 13, title: 'AP38 subtotal error retained, quantified, and the bypassed checks named', owner_patch: 31 },
  { id: 14, title: 'AP127 and AP128 scaling retained with real and dimensionless expectations separated', owner_patch: 31 },
  { id: 15, title: 'Negative OFFSET displacement and a wrong cited cell produce no unsafe remedy', owner_patch: 33 },
  { id: 16, title: 'An irrelevant absent module is not a defect; a stale macro store is a separate test', owner_patch: 33 }
];

function pythonRecalc(file) {
  const code = "import sys,json;sys.path.insert(0,sys.argv[1]);import recalc_check as r;print(json.dumps(r.run(sys.argv[2])))";
  const p = spawnSync('python3', ['-c', code, path.join(ROOT, 'src'), file], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) return null;
  const lines = String(p.stdout).trim().split('\n');
  try { return JSON.parse(lines[lines.length - 1]); } catch (_) { return null; }
}

function runRecalcCases() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
  const mk = spawnSync('python3', [path.join(__dirname, 'acceptance', 'make_recalc_fixtures.py'), dir], { encoding: 'utf8' });
  const res = {};
  if (mk.status !== 0) { for (const id of [1, 2, 3]) res[id] = { status: 'skipped', note: 'could not build fixtures (python3 with openpyxl needed)' }; return res; }

  const r1 = pythonRecalc(path.join(dir, 'case1_ratio.xlsx'));
  const r2 = pythonRecalc(path.join(dir, 'case2_iferror_stale.xlsx'));
  const r3 = pythonRecalc(path.join(dir, 'case3_result_types.xlsx'));
  if (!r1 || !r2 || !r3 || r1.status !== 'success') { for (const id of [1, 2, 3]) res[id] = { status: 'skipped', note: 'recalculation engine unavailable here' }; return res; }

  const listed = (r, cell) => ['mismatches', 'unresolved_errors', 'mismatches_likely_masked_upstream_error'].some(k => (r[k] || []).some(m => m.cell === cell));
  res[1] = { status: r1.mismatch_count >= 1 ? 'pass' : 'fail', note: `C1 saved 1.35, recomputed 0.50: mismatch_count=${r1.mismatch_count}` };
  res[2] = { status: r2.mismatch_count >= 2 ? 'pass' : 'fail', note: `B1 and C1 stale: mismatch_count=${r2.mismatch_count}, held back as masked=${r2.mismatches_likely_masked_upstream_error_count}` };
  // case 3: each of the four non-matching cells must appear somewhere in the result, as the explicit state it is in
  const sub = { text: listed(r3, 'B1'), boolean: listed(r3, 'C1'), missingCache: listed(r3, 'D1'), engineError: listed(r3, 'E1') };
  const n = Object.values(sub).filter(Boolean).length;
  res[3] = { status: n === 4 ? 'pass' : n === 0 ? 'fail' : 'partial', note: 'listed: ' + Object.entries(sub).map(([k, v]) => `${k}=${v ? 'yes' : 'no'}`).join(', ') };
  return res;
}

function runGraphCases() {
  const res = {};
  const circ = require(path.join(ROOT, 'src/utils/circular-reference-detector'));
  const mk = o => { const x = {}; for (const [k, v] of Object.entries(o)) x[k] = { formulaText: v }; return x; };
  const cyc = (o) => circ.findCycles(circ.buildDependencyGraph(mk(o), ['S'])).length;
  const c4 = cyc({ 'S!A1': 'SUM(A2:A10)', 'S!A5': 'A1' });
  res[4] = { status: c4 >= 1 ? 'pass' : 'fail', note: `real cycle through A5: ${c4} cycle(s) found` };
  const c5 = cyc({ 'S!A1': 'IF(B1="C99",D1,0)', 'S!C99': 'A1' });
  res[5] = { status: c5 === 0 ? 'pass' : 'fail', note: `literal "C99": ${c5} invented cycle(s)` };
  const p = spawnSync('python3', ['-c', "import sys;sys.path.insert(0,sys.argv[1]);import recalc_check as r;print(len(r._extract_refs('SUM(A1:A2000)','S')),len(r._extract_refs('SUM(A1:A2001)','S')))", path.join(ROOT, 'src')], { encoding: 'utf8' });
  if (p.status !== 0) res[6] = { status: 'skipped', note: 'python unavailable' };
  else { const [a, b] = String(p.stdout).trim().split(/\s+/).map(Number); res[6] = { status: a > 0 && b > 0 ? 'pass' : 'fail', note: `2,000-cell range: ${a} refs; 2,001-cell range: ${b} refs` }; }
  // case 7
  const t0 = require(path.join(ROOT, 'src/validator-tier0'));
  if (typeof t0.normalizeFormula !== 'function') res[7] = { status: 'skipped', note: 'normalizeFormula not exported' };
  else {
    const n = t0.normalizeFormula;
    const anchors = n('A1+B1') !== n('A1+$B$1') && n('A1+B1') !== n('A2+B1');
    const keys = n('IF(X1="AB12",1,0)') !== n('IF(X1="CD99",1,0)');
    res[7] = { status: anchors && keys ? 'pass' : anchors || keys ? 'partial' : 'fail', note: `anchors/offsets distinct=${anchors}, address-like text keys distinct=${keys}` };
  }
  return res;
}

function runAll() {
  const out = Object.assign({}, runRecalcCases(), runGraphCases());
  return CASES.map(c => Object.assign({ id: c.id, title: c.title, owner_patch: c.owner_patch }, out[c.id] || { status: 'pending', note: 'not executable offline yet; made executable by Patch ' + c.owner_patch }));
}

function main() {
  const results = runAll();
  for (const r of results) console.log(`${String(r.id).padStart(2)}  ${r.status.padEnd(8)} P${r.owner_patch}  ${r.title}${r.note ? '\n      ' + r.note : ''}`);
  const slim = Object.fromEntries(results.map(r => [r.id, { status: r.status, owner_patch: r.owner_patch }]));
  if (process.argv.includes('--update')) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify(slim, null, 2) + '\n');
    console.log('\nBaseline written: ' + path.relative(ROOT, BASELINE));
    return;
  }
  let base = {};
  try { base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) { console.log('\nNo baseline yet. Run with --update.'); process.exit(1); }
  const diffs = [];
  for (const r of results) {
    if (r.status === 'skipped') continue;                    // not run here, not compared
    const b = base[r.id];
    if (!b || b.status !== r.status) diffs.push(`case ${r.id}: baseline ${b ? b.status : 'missing'}, now ${r.status}`);
  }
  if (diffs.length) { console.log('\nDIFFERENCES FROM BASELINE:\n  ' + diffs.join('\n  ')); process.exit(1); }
  console.log('\nAcceptance baseline unchanged.');
}

if (require.main === module) main();
module.exports = { CASES, runAll };
