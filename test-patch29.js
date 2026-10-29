'use strict';
// Patch 29 checks: review completion and report truth.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const { reconcileDeepDive, describeReconciliation } = require('./src/utils/deepdive-reconcile');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };
const items = Array.from({ length: 40 }, (_, i) => ({ ufi: 'UF' + (i + 1) }));

let r = reconcileDeepDive(items, [{ ufi: 'UF1', status: 'pass' }]);
check('40 sent, 1 valid answer: completed 1, 39 not completed', r.requested === 40 && r.completed === 1 && r.notCompleted.length === 39);
r = reconcileDeepDive(items, [{ ufi: 'UF1', status: 'pass' }, { ufi: 'UF1', status: 'fail' }]);
check('a second answer for the same formula is a duplicate, first kept', r.completed === 1 && r.duplicates.length === 1 && r.passed === 1);
r = reconcileDeepDive(items, [{ ufi: 'UF999', status: 'pass' }]);
check('an answer for a formula never sent is unknown, not counted', r.completed === 0 && r.unknown.length === 1);
r = reconcileDeepDive(items, [{ status: 'pass' }, { ufi: 'UF2', status: 'maybe' }, null]);
check('no ufi, bad status and non-objects are malformed, not counted', r.completed === 0 && r.malformed.length === 3);
r = reconcileDeepDive(items, [{ ufi: 'UF3', status: 'FAIL', id: 'F1' }, { ufi: 'UF4', status: 'uncertain' }]);
check('fail and uncertain become findings; status is case-insensitive', r.findings.length === 2 && r.completed === 2);
r = reconcileDeepDive(items, [], { stopReason: 'max_tokens' });
check('a reply cut at the output limit is flagged truncated', r.truncated === true && r.completed === 0);
check('describeReconciliation says completed of requested', /0 of 40/.test(describeReconciliation(r)));
r = reconcileDeepDive([], []);
check('empty request reconciles without error', r.requested === 0 && r.completed === 0);

const dd = fs.readFileSync('src/validator-formula-deepdive.js', 'utf8');
check('deep dive module uses reconcileDeepDive and returns reviewLedger', dd.includes('reconcileDeepDive(') && dd.includes('reviewLedger'));
check('deep dive no longer reports reviewed = items.length', !/reviewed:\s*items\.length/.test(dd));
check('skill prompt tells the reviewer to echo ufi', /ufi/.test(fs.readFileSync('config/skill-formula-deepdive.md', 'utf8')));

const rs = require('./src/utils/risk-scoring');
const sc = rs.scoreDecisionConsequence || (rs.default && rs.default.scoreDecisionConsequence);
if (typeof sc === 'function') {
  const base = sc({}), un = sc({ key_output_impact: 'Unknown' }), no = sc({ key_output_impact: 'No' }), yes = sc({ key_output_impact: 'Yes' }), named = sc({ key_output_impact: 'Equity IRR' });
  check('key_output_impact Unknown or No adds no consequence', un === base && no === base);
  check('key_output_impact Yes or a named impact adds consequence', yes > base && named > base);
} else console.log('SKIP: scoreDecisionConsequence not exported');

// report
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p29-'));
function build(ufs, dd2, name) {
  const payload = {
    originalName: 't.xlsx', modelType: 't', modelIndustry: 't', modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['S'] },
    tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: ufs, edgeList: [] }, overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 't',
    ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false }, namedRangeAudit: { applicable: false },
    formulaDeepDive: dd2, reasonableness: {}, duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
    crossRunStats: { isFirstRun: true, newFindingCount: 0 },
    findings: [{ id: 'T2-S1-001', status: 'fail', severity: 'high', review_mode: 'llm_with_partial_formulas', finding: 'x', priority: 'P2' }]
  };
  const pp = path.join(tmp, name + '.json'), out = path.join(tmp, name + '.xlsx');
  fs.writeFileSync(pp, JSON.stringify(payload));
  const b = spawnSync('python3', ['src/build_report.py', pp, out], { encoding: 'utf8' });
  if (b.status !== 0) { console.log(b.stderr.slice(-500)); return null; }
  const py = 'import openpyxl,sys,json\nwb=openpyxl.load_workbook(sys.argv[1])\nd={n:" | ".join(str(c.value) for r in wb[n].iter_rows() for c in r if c.value is not None) for n in wb.sheetnames}\nws=wb["Formula Risk Review"]\nrows=[[c.value for c in r] for r in ws.iter_rows(min_row=7)]\nprint(json.dumps({"text":d,"names":wb.sheetnames,"rows":rows,"maxrow":ws.max_row}))';
  return JSON.parse(spawnSync('python3', ['-c', py, out], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout);
}
const mk = n => Array.from({ length: n }, (_, i) => ({ ufi: 'UF' + (i + 1), sheet: 'S', cell: 'A' + (i + 1), fscore: n - i, band: 'Moderate', formulaClass: 'x', formulaText: '=A1+' + i }));
const led = [{ ufi: 'UF5', outcome: 'pass' }, { ufi: 'UF6', outcome: 'fail', id: 'T0-FDD-001', reason: 'wrong range' }, { ufi: 'UF7', outcome: 'not_completed' }];
const a = build(mk(50), { applicable: true, requested: 3, completed: 2, notCompleted: ['UF7'], findings: [], reviewLedger: led }, 'a');
if (!a) check('report builds', false); else {
  const frr = a.text['Formula Risk Review'];
  check('Formula Risk Review has Review Result and Review Detail columns', frr.includes('Review Result') && frr.includes('Review Detail'));
  check('review states appear', frr.includes('Reviewed - no issue') && frr.includes('Reviewed - finding') && frr.includes('Not completed') && frr.includes('Not selected'));
  check('finding id and reason appear in the detail', frr.includes('T0-FDD-001 wrong range'));
  check('reviewed formulas are listed first', a.rows[0][1] === 'UF5' || a.rows.slice(0, 3).some(x => x[1] === 'UF5'));
  check('no inventory tab when nothing is cut', !a.names.includes('Formula Inventory'));
  const all = Object.values(a.text).join(' ');
  check('grounded sentence no longer claims direct inspection', !all.includes('grounded in direct formula-text inspection'));
  check('new wording says what was supplied, not checked', all.includes('formula text supplied to the reviewer') && all.includes('not validated against the workbook'));
  check('coverage wording reports completed of requested', all.includes('2 of 3 came back with a usable result'));
}
const b = build(mk(1200), { applicable: false, findings: [] }, 'b');
if (!b) check('large report builds', false); else {
  check('over the limit: Formula Inventory tab is added', b.names.includes('Formula Inventory'));
  check('over the limit: the cut is disclosed exactly', b.text['Formula Risk Review'].includes('Showing 1,000 of 1,200 unique formulas'));
}
const c = build([], { applicable: false, findings: [] }, 'c');
check('no formulas: the report still builds', !!c);

// regression: earlier patch suites
for (const t of ['test-patch27.js', 'test-patch28.js', 'test-risk-scoring.js']) {
  let ok = true; try { execFileSync('node', [t], { stdio: 'pipe', timeout: 300000 }); } catch (e) { ok = false; }
  check(t + ' still passes', ok);
}
let accOk = true; try { execFileSync('node', ['scripts/acceptance-baseline.js'], { stdio: 'pipe', timeout: 300000 }); } catch (e) { accOk = false; }
check('acceptance baseline matches (cases 8 and 9 now pass)', accOk && JSON.parse(fs.readFileSync('acceptance/baseline.json', 'utf8'))['8'].status === 'pass');
if (fails) { console.log(`\n${fails} check(s) FAILED`); process.exit(1); }
console.log('\nAll Patch 29 checks pass.');
