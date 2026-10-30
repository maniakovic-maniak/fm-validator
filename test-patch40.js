'use strict';
// Patch 40: the evidence-backed run record replaces the reviewer flag; the registry is validated against its own
// definitions and against the workbook; provenance covers every decision-relevant settings file.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const reg = require('./src/utils/output-registry');
const prov = require('./src/utils/run-provenance');
const RR = require('./src/utils/run-record');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p40-'));
const wr = (name, o) => fs.writeFileSync(path.join(tmp, name), typeof o === 'string' ? o : JSON.stringify(o));
const good = [{ sheet: 'Summary', row: 5, label: 'Equity IRR' }, { sheet: 'Summary', cell: 'C9', label: 'Min DSCR' }];

// 1. registry validation
wr('a.json', { status: 'approved', approved_by: 'X', approved_on: '2026-10-30', outputs: [] });
check('an approved file with an empty list is invalid', reg.loadRegistryState('a.xlsx', tmp).status === 'invalid');
wr('b.json', { status: 'approved', approved_by: 'X', approved_on: '2026-10-30', outputs: [{ sheet: 'S' }, { label: 'x', row: 2 }] });
const b = reg.loadRegistryState('b.xlsx', tmp);
check('outputs with no sheet, row/cell or label are invalid and the problems are named', b.status === 'invalid' && b.problems.length >= 3);
wr('c.json', { status: 'approved', approved_by: 'X', approved_on: '2026-10-30', outputs: good });
const c = reg.loadRegistryState('c.xlsx', tmp);
check('a complete list is approved and returns its definitions and file hash', c.status === 'approved' && c.definitions.length === 2 && /^[0-9a-f]{64}$/.test(c.sha256));
wr('d.json', { status: 'approved', approved_by: 'X', approved_on: '2026-10-30', outputs: [good[0], good[0]] });
check('duplicate outputs are invalid', reg.loadRegistryState('d.xlsx', tmp).status === 'invalid');
let threw = false; try { reg.approveRegistry({ outputs: [{ sheet: 'S' }] }, { approvedBy: 'X', approvedOn: '2026-10-30' }); } catch (_) { threw = true; }
check('approving incomplete definitions is refused', threw);

// 2. registry against the workbook
const wb = { worksheets: [{ name: 'Summary' }] };
const found = reg.checkRegistryAgainstWorkbook(c, wb, { 'Summary!B5': 1, 'Summary!C9': 1 });
check('every output found: usable', found.usable === true && found.resolved === 2);
const missing = reg.checkRegistryAgainstWorkbook(c, wb, { 'Summary!B5': 1 });
check('an output not found in this workbook: not usable, and named', missing.usable === false && missing.unresolved.length === 1 && reg.registryCeiling(missing).capsTopTier);
check('a sheet that no longer exists: not usable', reg.checkRegistryAgainstWorkbook(c, { worksheets: [] }, {}).usable === false);

// 3. provenance covers the decision-relevant settings
const files = prov.configHashes().files;
for (const f of ['soul.md', 'finding-class.json', 'rule-tiering.json', 'chunking.json', 'checklist.json', 'rule-scope.json']) check(`provenance covers ${f}`, !!files[f]);
check('provenance covers the rule-history seed', Object.keys(files).some(k => /history|seed|\.json$/.test(k)) && fs.readdirSync('config/rule-history-seed').every(f => !/\.json$/.test(f) || !!files[f]));

// 4. run record
const P = { input_sha256: 'a'.repeat(64), code_commit: 'abc', rule_version: 'rv', config_files: { 'x.json': '1' } };
const okRecalc = { status: 'success', formula_cells_checked: 980, mismatch_count: 0, unresolved_error_count: 0, offset_cells_excluded: 20 };
const base = { originalName: 'M.xlsx', provenance: P, registryState: found, recalcCheckResult: okRecalc, pathChecks: { lookup: { tested: 3 }, average: { tested: 2 }, fallback: { tested: 1 } }, batchFailures: [] };
const r0 = RR.buildRunRecord(base);
check('complete evidence gives no gaps', r0.gaps.length === 0 && r0.issued_by === 'automated review');
check('the fingerprint is stable for the same inputs', RR.buildRunRecord(base).fingerprint === r0.fingerprint);
check('a different workbook changes the fingerprint', RR.buildRunRecord({ ...base, provenance: { ...P, input_sha256: 'b'.repeat(64) } }).fingerprint !== r0.fingerprint);
check('a changed rule file changes the fingerprint', RR.buildRunRecord({ ...base, provenance: { ...P, config_files: { 'x.json': '2' } } }).fingerprint !== r0.fingerprint);
const keys = o => o.gaps.map(g => g.key);
check('no recalculation result is a gap', keys(RR.buildRunRecord({ ...base, recalcCheckResult: null })).includes('recalculation'));
check('a failed recalculation is a gap', keys(RR.buildRunRecord({ ...base, recalcCheckResult: { status: 'error' } })).includes('recalculation'));
check('a recalculation mismatch is a gap', keys(RR.buildRunRecord({ ...base, recalcCheckResult: { ...okRecalc, mismatch_count: 4 } })).includes('recalculation'));
check('low recalculation coverage is a gap', keys(RR.buildRunRecord({ ...base, recalcCheckResult: { ...okRecalc, formula_cells_checked: 100, offset_cells_excluded: 900 } })).includes('recalculation_coverage'));
check('a path check that failed is a gap', keys(RR.buildRunRecord({ ...base, pathChecks: { lookup: { tested: 3, error: 'boom' }, average: {}, fallback: {} } })).includes('path_checks'));
check('no path-check result at all is a gap', keys(RR.buildRunRecord({ ...base, pathChecks: null })).includes('path_checks'));
check('a failed review batch is a gap', keys(RR.buildRunRecord({ ...base, batchFailures: [{ batch: 1 }] })).includes('review_batches'));
check('an unhashed input is a gap', keys(RR.buildRunRecord({ ...base, provenance: {} })).includes('provenance'));
check('an unapproved priority-output list is a gap', keys(RR.buildRunRecord({ ...base, registryState: { status: 'none' } })).includes('priority_outputs'));
const rp = path.join(tmp, 'r.xlsx');
check('the record is written beside the report', RR.writeRunRecord(rp, r0) && fs.existsSync(RR.recordPathFor(rp)));

// 5. report: the top tier follows the evidence
const cl = JSON.parse(fs.readFileSync('config/checklist.json', 'utf8'));
const allPass = [...(cl.tier1 || []), ...(cl.tier2 || [])].map(r => ({ id: r.id, status: 'pass' }));
const approved = { status: 'approved', approved_by: 'Mik', approved_on: '2026-10-30', outputs: 2, file: 'm.json', usable: true };
const build = extra => {
  const d = fs.mkdtempSync(path.join(tmp, 'rep-'));
  const payload = { originalName: 't.xlsx', modelType: 't', modelIndustry: 't', modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['S'] }, tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] }, overallAssessment: 'audit_complete', igReadiness: 97, igCommentary: 't', ruleResults: allPass, errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false }, namedRangeAudit: { applicable: false }, formulaDeepDive: { applicable: false }, reasonableness: {}, duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {}, crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings: [], outputRegistry: approved, ...extra };
  fs.writeFileSync(path.join(d, 'p.json'), JSON.stringify(payload));
  const b = spawnSync('python3', ['src/build_report.py', path.join(d, 'p.json'), path.join(d, 'o.xlsx')], { encoding: 'utf8', timeout: 180000 });
  if (b.status !== 0) return { error: String(b.stderr).slice(-300) };
  const py = 'import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1])\nt=[]\nfor ws in wb:\n  for r in ws.iter_rows():\n    for c in r:\n      if c.value is not None: t.append(str(c.value))\nprint("\\n".join(x.replace("\\n"," ") for x in t))';
  return { text: spawnSync('python3', ['-c', py, path.join(d, 'o.xlsx')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '' };
};
const TOP = /Reliance-ready \u2014 transaction execution/;
const full = build({ runRecord: r0 });
check('complete evidence reaches the top tier and shows the record', !full.error && TOP.test(full.text) && /ASSESSMENT RECORD/.test(full.text) && /automated review/i.test(full.text) && /No manual sign-off/.test(full.text));
const gapRec = RR.buildRunRecord({ ...base, recalcCheckResult: null });
const gapped = build({ runRecord: gapRec });
check('a recalculation gap caps the tier and the reason is printed', !gapped.error && !TOP.test(gapped.text) && /no independent recalculation was completed/.test(gapped.text));
const nullRec = build({ runRecord: null });
check('a record that could not be built caps the tier', !nullRec.error && !TOP.test(nullRec.text) && /could not be built/.test(nullRec.text));
const legacy = build({});
check('a payload without a record behaves as before', !legacy.error && TOP.test(legacy.text));
const unmatched = build({ outputRegistry: { ...approved, usable: false, unresolved: [{ label: 'Equity IRR', reason: 'row 5 on "Summary" holds no formula in this workbook' }] }, runRecord: r0 });
check('an approved list that no longer matches the workbook caps the tier and says why', !unmatched.error && !TOP.test(unmatched.text) && /not found in this workbook/.test(unmatched.text));

console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 40 checks passed');
process.exit(fails ? 1 : 0);
