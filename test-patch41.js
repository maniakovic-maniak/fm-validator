'use strict';
// Patch 41: the recalculation gap says what was not recalculated; the sign-off footer no longer asks for a sign-off.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const RR = require('./src/utils/run-record');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };
const eso = { status: 'success', formula_cells_checked: 2960, mismatch_count: 0, unresolved_error_count: 0, offset_cells_excluded: 354, multicell_named_range_cells_excluded: 611, external_reference_cells_excluded: 0, tainted_downstream_cells_excluded: 4278 };
const ev = RR.recalcEvidence(eso);
check('coverage is 36% and the reasons are kept', ev.coverage_pct === 36 && ev.not_recalculated.offset === 354 && ev.not_recalculated.downstream_of_those === 4278);
const P = { input_sha256: 'a'.repeat(64), code_commit: 'c', rule_version: 'r', config_files: {} };
const rec = RR.buildRunRecord({ originalName: 'M.xlsx', provenance: P, registryState: { status: 'approved', usable: true, approved_by: 'X', approved_on: '2026-10-30', outputs: 1 }, recalcCheckResult: eso, pathChecks: { lookup: {}, average: {}, fallback: {} }, batchFailures: [] });
const g = rec.gaps.find(x => x.key === 'recalculation_coverage');
check('the coverage gap names OFFSET, named-range and downstream counts', g && /354 OFFSET/.test(g.text) && /611 cell\(s\) using a bare multi-cell named range/.test(g.text) && /4,278 cell\(s\) downstream/.test(g.text));
check('full coverage has no coverage gap', !RR.buildRunRecord({ originalName: 'M.xlsx', provenance: P, registryState: { status: 'approved', usable: true, outputs: 1 }, recalcCheckResult: { status: 'success', formula_cells_checked: 1000 }, pathChecks: { lookup: {}, average: {}, fallback: {} }, batchFailures: [] }).gaps.some(x => x.key === 'recalculation_coverage'));
check('a gap with no recorded reason says so', /no reason recorded/.test(RR.recalcBreakdown({})));

const cl = JSON.parse(fs.readFileSync('config/checklist.json', 'utf8'));
const allPass = [...(cl.tier1 || []), ...(cl.tier2 || [])].map(r => ({ id: r.id, status: 'pass' }));
const build = extra => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'p41-'));
  const payload = { originalName: 't.xlsx', modelType: 't', modelIndustry: 't', modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['S'] }, tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] }, overallAssessment: 'audit_complete', igReadiness: 97, igCommentary: 't', ruleResults: allPass, errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false }, namedRangeAudit: { applicable: false }, formulaDeepDive: { applicable: false }, reasonableness: {}, duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {}, crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings: [], ...extra };
  fs.writeFileSync(path.join(d, 'p.json'), JSON.stringify(payload));
  const b = spawnSync('python3', ['src/build_report.py', path.join(d, 'p.json'), path.join(d, 'o.xlsx')], { encoding: 'utf8', timeout: 180000 });
  if (b.status !== 0) return { error: String(b.stderr).slice(-300) };
  const py = 'import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1])\nfor ws in wb:\n  for r in ws.iter_rows():\n    for c in r:\n      if c.value is not None: print(str(c.value).replace("\\n"," "))';
  return { text: spawnSync('python3', ['-c', py, path.join(d, 'o.xlsx')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '' };
};
const withRec = build({ runRecord: rec, outputRegistry: { status: 'approved', approved_by: 'X', approved_on: '2026-10-30', outputs: 1, usable: true } });
check('the Scope tab lists what was not recalculated', !withRec.error && /Not recalculated/.test(withRec.text) && /354 OFFSET cell/.test(withRec.text));
check('the footer reports the automated assessment and the record', /Issued by automated review on/.test(withRec.text) && /No manual sign-off is required/.test(withRec.text));
check('the footer no longer says the review is awaiting sign-off', !/Not yet signed off/.test(withRec.text));
const none = build({ runRecord: null });
check('with no record the footer says so and the tier is still capped', !none.error && /No assessment record was built/.test(none.text) && !/Reliance-ready \u2014 transaction execution/.test(none.text));
console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 41 checks passed');
process.exit(fails ? 1 : 0);
