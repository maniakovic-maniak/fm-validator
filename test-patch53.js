// Patch 53: D0 status/ID contract and D1 evidence gate (from the 4 Nov 2026 independent review, R1-R4, R8).
const fs = require('fs');
const { execFileSync } = require('child_process');
const { evidenceGaps, recalcEvidence, buildRunRecord } = require('./src/utils/run-record');
const { ruleStatus, computeCompletion } = require('./src/utils/rule-scope');
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS: ' + n); } else { fail++; console.log('FAIL: ' + n + (extra ? ' -> ' + extra : '')); } };
const py = code => execFileSync('python3', ['-c', code], { cwd: __dirname, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

// ---- D1: recalculation evidence ----
const rc = o => recalcEvidence(Object.assign({ status: 'success', formula_cells_checked: 1000, mismatch_count: 0, unresolved_error_count: 0 }, o));
const ev = (recalc, path) => ({ registry: { usable: true }, recalculation: recalc, path_checks: path || { criteria: [], failed: [] }, batches: { failed: 0 }, provenance: { input_sha256: 'abc' } });
const keys = g => g.map(x => x.key);

check('R1: 900 unresolved of 1,000 attempted holds back the top tier', keys(evidenceGaps(ev(rc({ unresolved_error_count: 900 })))).includes('recalculation_unresolved'));
check('clean recalculation: no gaps', evidenceGaps(ev(rc())).length === 0);
check('unresolved at 9% of cells (91% verified) passes', evidenceGaps(ev(rc({ unresolved_error_count: 90 }))).length === 0);
check('unresolved at 10.1% of cells (89.9% verified) is a gap', keys(evidenceGaps(ev(rc({ unresolved_error_count: 101 })))).includes('recalculation_unresolved'));
check('unrounded: 89.6% attempted is a gap although it displays as 90%', (() => {
  const r = rc({ formula_cells_checked: 896, external_reference_cells_excluded: 104 });
  return r.coverage_pct === 90 && keys(evidenceGaps(ev(r))).includes('recalculation_coverage');
})());
check('exactly 90% attempted is not a gap', evidenceGaps(ev(rc({ formula_cells_checked: 900, external_reference_cells_excluded: 100 }))).length === 0);
check('attempted shortfall mentions the errored cells and gives one coverage gap, not two', (() => {
  const g = evidenceGaps(ev(rc({ formula_cells_checked: 500, external_reference_cells_excluded: 500, unresolved_error_count: 300 })));
  return keys(g).filter(k => k.startsWith('recalculation')).length === 1 && /engine error/.test(g[0].text);
})());
check('zero population gives no ratio and no false gap from the new fields', (() => { const r = rc({ formula_cells_checked: 0 }); return r.verified_ratio === null && r.attempted_ratio === null; })());

// ---- D1: path checks ----
const pcEv = summary => buildRunRecord({ provenance: { input_sha256: 'x' }, registryState: { status: 'approved', outputs: 1 }, recalcCheckResult: { status: 'success', formula_cells_checked: 10 }, pathChecks: summary }).evidence.path_checks;
const pcRaw = (c) => ({ lookup: Object.assign({ tested: 5, records: [] }, c), average: { tested: 1, records: [] }, fallback: { tested: 1, records: [] } });
check('R4: a criterion that tested nothing and did not complete is a failure', pcEv(pcRaw({ tested: 0, notCompleted: 100, notCompletedReasons: { unsupported: 100 } })).failed.some(x => /Lookup contract.*nothing tested/.test(x)));
check('a scan stopped at a limit is a failure', pcEv(pcRaw({ tested: 20, notCompleted: 80, stopped: 'cell limit' })).failed.some(x => /stopped at a limit/.test(x)));
check('partial non-completion without a stop is disclosed but does not hold back the tier', pcEv(pcRaw({ tested: 20, notCompleted: 5 })).failed.length === 0 && pcEv(pcRaw({ tested: 20, notCompleted: 5 })).criteria[0].not_completed === 5);
check('genuinely nothing to test (zero eligible, nothing incomplete) is not a failure', pcEv(pcRaw({ tested: 0, notCompleted: 0 })).failed.length === 0);
check('a real path error still fails', pcEv(pcRaw({ error: 'boom' })).failed.length === 1);

// ---- D0: status contract (JS) ----
const R = (id, status) => ({ id, status });
check('JS: unknown / null / error / not_run are not concluded', ['error', 'not_run', null, 'banana'].every(s => ruleStatus('T1-001', [R('T1-001', s)]) === 'Not Performed'));
check('JS: fail stays Raised Issue, pass stays Pass, uncertain stays Uncertain', ruleStatus('T1-001', [R('T1-001', 'fail')]) === 'Raised Issue' && ruleStatus('T1-001', [R('T1-001', 'pass')]) === 'Pass' && ruleStatus('T1-001', [R('T1-001', 'uncertain')]) === 'Uncertain');
check('JS: a fail beside an unknown stays Raised Issue; uncertain beside unknown stays Uncertain', ruleStatus('T1-001', [R('T1-001', 'fail'), R('T1-001', 'error')]) === 'Raised Issue' && ruleStatus('T1-001', [R('T1-001', 'uncertain'), R('T1-001', 'error')]) === 'Uncertain');
check('JS: pass beside an unknown is NOT a pass', ruleStatus('T1-001', [R('T1-001', 'pass'), R('T1-001', 'error')]) === 'Not Performed');
check('R3: invalid status no longer counts as 100% concluded', computeCompletion([{ id: 'T1-001', severity: 'high' }], [R('T1-001', 'error')]).counts.concludedPct === 0);
check('supported suffix id still resolves to its rule', ruleStatus('T1-001', [R('T1-001-instance-1', 'pass')]) === 'Pass');

// ---- D0: Python twin + builder views ----
const t = JSON.parse(py(`
import sys, json; sys.path.insert(0, 'src')
import completion as c
rs = lambda s: c.rule_status('T1-001', [{'id': 'T1-001', 'status': s}])
print(json.dumps({'stat': {str(s): rs(s) for s in ['pass','fail','uncertain','error','not_run',None,'banana']},
 'fail_unknown': c.rule_status('T1-001', [{'id':'T1-001','status':'fail'},{'id':'T1-001','status':'x'}]),
 'pass_unknown': c.rule_status('T1-001', [{'id':'T1-001','status':'pass'},{'id':'T1-001','status':'x'}]),
 'pct': c.compute_completion([{'id':'T1-001','severity':'high'}], [{'id':'T1-001','status':'error'}])['counts']['concludedPct']}))
`));
check('PY: unknown statuses are Not Performed, supported ones unchanged', ['error', 'not_run', 'None', 'banana'].every(k => t.stat[k] === 'Not Performed') && t.stat.pass === 'Pass' && t.stat.fail === 'Raised Issue' && t.stat.uncertain === 'Uncertain', JSON.stringify(t.stat));
check('PY twin agrees with JS on mixed results and on completion', t.fail_unknown === 'Raised Issue' && t.pass_unknown === 'Not Performed' && t.pct === 0);

// builder: R8 suffix id, R2 omitted run record, invalid status in matrix
const base = () => ({
  originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
  modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['Sheet1'] },
  tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
  overallAssessment: 'fit_for_purpose', igReadiness: 100, igCommentary: 'test',
  ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
  namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
  duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
  crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings: [],
});
const chk = JSON.parse(fs.readFileSync('config/checklist.json', 'utf8'));
const isBase = r => !(typeof r.source_id === 'string' && r.source_id.startsWith('skill-') && r.source_id.endsWith('.md'));
const rules = [...(chk.tier1 || []), ...(chk.tier2 || [])].filter(isBase);   // same filter the builder applies for a generic model
const mand = rules.filter(r => r.severity === 'fatal' || String(r.source_section || '').toLowerCase().includes('fatal gate')).map(r => r.id);
const build = (name, mut) => {   // returns { txt: whole-workbook text, reason: the Audit Output Reason line }
  const p = base(); mut(p);
  fs.writeFileSync(`/tmp/p53-${name}.json`, JSON.stringify(p));
  execFileSync('python3', ['src/build_report.py', `/tmp/p53-${name}.json`, `/tmp/p53-${name}.xlsx`], { cwd: __dirname });
  return JSON.parse(py(`
import openpyxl, json
wb = openpyxl.load_workbook('/tmp/p53-${name}.xlsx')
txt = ' | '.join(str(c.value) for ws in wb.worksheets for row in ws.iter_rows() for c in row if c.value)
ao = wb['Audit Output']
reason = ' '.join(str(c.value) for row in ao.iter_rows(min_row=1, max_row=20) for c in row if c.value and str(c.value).startswith('Reason:'))
print(json.dumps({'txt': txt, 'reason': reason}))`));
};
const allPass = () => rules.map(r => R(r.id, 'pass'));
const alter = (fn) => allPass().map(r => r.id === mand[0] ? fn(r) : r);
const goodRR = { gaps: [], fingerprint: 'f', created_at: '2026-11-07', evidence: {} };
const withReady = p => { p.ruleResults = allPass(); p.runRecord = goodRR; p.outputRegistry = { status: 'approved', usable: true }; };
const ok = build('ok', withReady);
check('control: all mandatory pass + good record has no mandatory/record gap text', !/mandatory critical procedure/.test(ok.reason) && !/assessment record/.test(ok.txt), ok.reason);
const omitted = build('omitted', p => { withReady(p); delete p.runRecord; });
check('R2: an omitted run record is no longer complete evidence', /no automated assessment record was supplied/.test(omitted.txt) && !/no automated assessment record was supplied/.test(ok.txt));
const suffix = build('suffix', p => { withReady(p); p.ruleResults = alter(r => R(r.id + '-instance-1', 'pass')); });
check('R8: a supported suffixed id for a mandatory rule is not reported as missing', !/mandatory critical procedure/.test(suffix.reason), suffix.reason);
const badStatus = build('bad', p => { withReady(p); p.ruleResults = alter(r => R(r.id, 'error')); });
check('R3: an errored mandatory procedure is "not concluded", not "with a raised issue"', /1 mandatory critical procedure\(s\) not concluded/.test(badStatus.reason) && !/with a raised issue/.test(badStatus.reason), badStatus.reason);
const failed = build('fail', p => { withReady(p); p.ruleResults = alter(r => R(r.id, 'fail')); });
check('a failed mandatory procedure is still reported as a raised issue', /1 mandatory critical procedure\(s\) with a raised issue/.test(failed.reason), failed.reason);

// Path Checks tab appears when only non-completion exists
const pcOnly = (() => {
  const p = base(); withReady(p);
  p.pathChecks = { rows: [], summary: [{ criterion: 'Lookup contract', tested: 0, counts: {}, notCompleted: 100, reasons: { unsupported: 100 }, stopped: 'cell limit', failed: null }] };
  fs.writeFileSync('/tmp/p53-pc.json', JSON.stringify(p));
  execFileSync('python3', ['src/build_report.py', '/tmp/p53-pc.json', '/tmp/p53-pc.xlsx'], { cwd: __dirname });
  return JSON.parse(py(`import openpyxl, json; print(json.dumps('Path Checks' in openpyxl.load_workbook('/tmp/p53-pc.xlsx').sheetnames))`));
})();
check('R4: Path Checks tab is created when scans did not complete, even with no detail rows', pcOnly === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
