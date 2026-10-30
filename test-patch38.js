'use strict';
// Patch 38: narrow fixes after an independent review of Patch 37. Each fix has a defect it catches, a valid case it
// keeps, and an incomplete-evidence case it leaves open; the report cases run through the real report builder.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');
const { resolveAnswerableQueries } = require('./src/utils/query-resolver');
const { mergeDuplicateCriticalQueries, assignRecordTypes } = require('./src/utils/record-type-classifier');
const { buildPathCheckFindings, runPathChecks, pathCheckRows } = require('./src/utils/path-checks');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };

async function book() {
  const wb = new ExcelJS.Workbook(); const s = wb.addWorksheet('S');
  s.getCell('B1').value = 0.19; s.getCell('C1').value = 0.25;
  s.getCell('C3').value = { formula: 'C1', result: 0.25 };
  s.getCell('B2').value = { formula: 'C3', result: 0.25 };            // B2 -> C3 -> C1 : not B1
  s.getCell('B4').value = { formula: 'B1', result: 0.19 };            // direct
  s.getCell('B5').value = { formula: 'B4', result: 0.19 };            // two hops, same column as target
  for (const c of ['AP', 'AQ']) { s.getCell(c + '20').value = 0.19; s.getCell(c + '21').value = { formula: c + '20', result: 0.19 }; s.getCell(c + '22').value = { formula: c + '21', result: 0.19 }; }
  s.getCell('AP30').value = { formula: 'AP20', result: 0.19 };       // row 30 has one populated column, row 31 none
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p38-')), 'f.xlsx'); await wb.xlsx.writeFile(f);
  const r = new ExcelJS.Workbook(); await r.xlsx.readFile(f); return r;
}
const Q = (fix, o = {}) => Object.assign({ id: 'T2-Q', record_type: 'Critical Query', sheet: 'S', cell: 'B1', condition: 'These rows carry the same label.', fix_instruction: fix }, o);

(async () => {
  const wb = await book(); const ctx = { workbook: wb, cellScoreIndex: {} };
  const run = f => { resolveAnswerableQueries([f], ctx); return f; };

  // 1. the destination stays fixed for the whole trace
  let f = run(Q('Confirm that S!B2 and S!B4 are formula references to B1.'));
  check('defect caught: B2 -> C3 -> C1 is not a reference to B1, the query stays open', f.record_type === 'Critical Query' && f.query_resolution.status === 'typed_value_found' && f.query_resolution.cells.includes('S!C1'));
  f = run(Q('Confirm that S!B4 and S!B5 are formula references to B1.'));
  check('valid case kept: direct and two-hop references to B1 close the query', f.record_type === 'False Positive' && f.query_resolution.tested === 2);
  f = run(Q('Confirm that S!AP22 and S!AQ22 are formula references to AP20.'));
  check('exact cell asserted: AQ22 leads to AQ20, not AP20, so the query stays open', f.record_type === 'Critical Query' && f.query_resolution.status === 'typed_value_found');
  f = run(Q('Confirm that S!B4 and S!B5 are formula references to B1.', { cell: 'B1' }));

  // 2. period rows: the evidenced period-aligned assertion still works when the cited column is empty
  f = run(Q('Confirm that S!I21 and I22 are formula references to I20.', { cell: 'I20' }));
  check('period-aligned case kept: empty cited column, populated period columns, each leads to its own column of row 20', f.record_type === 'False Positive' && f.query_resolution.widened_to_row === true && f.query_resolution.tested === 4);

  // 3. an empty cited row stays in the population
  f = run(Q('Confirm that S!I31 and I22 are formula references to I20.', { cell: 'I20' }));
  check('incomplete evidence: a cited row with nothing in it keeps the query open', f.record_type === 'Critical Query' && f.query_resolution.status === 'not_answered' && /no populated cell/.test(f.query_resolution.evidence));

  // 4. a second concern in the same finding is not cleared
  f = run(Q('Confirm that S!B4 and S!B5 are formula references to B1. Also reconcile B1 to the licence rate of 17%.'));
  check('a second action in the same finding keeps the record open and says so', f.record_type === 'Critical Query' && f.query_resolution.status === 'part_answered' && /does not answer that part/.test(f.query_resolution.evidence));
  f = run(Q('Confirm that S!B4 and S!B5 are formula references to B1 (or a single named cell), not independently typed values.'));
  check('the usual wording (parenthesis, "not typed values") is still one question and closes', f.record_type === 'False Positive');
  f = run(Q('Confirm that S!B4 and S!B5 are formula references to B1.', { condition: 'The rate in B1 differs from the licence value.' }));
  check('a finding whose own condition raises a different problem is not closed', f.record_type === 'Critical Query' && f.query_resolution.status === 'part_answered');

  // 5. Critical Queries on one cell: grouped for display, none demoted
  const set = [{ id: 'T2-A', record_type: 'Critical Query', sheet: 'S', cell: 'AP42', confidence: 60 }, { id: 'T2-B', record_type: 'Critical Query', sheet: 'S', cell: 'AP42', confidence: 40 }, { id: 'T2-C', record_type: 'Critical Query', sheet: 'S', cell: 'A1', confidence: 40 }];
  const g = mergeDuplicateCriticalQueries(set);
  check('both Critical Queries at one cell still block; the weaker names the stronger', g.length === 1 && set[0].record_type === 'Critical Query' && set[1].record_type === 'Critical Query' && set[1].grouped_with === 'T2-A' && set[0].same_location_group === 'S!AP42');
  check('an A1 fallback is not grouped and running it twice changes nothing', !set[2].same_location_group && mergeDuplicateCriticalQueries(set).length === 0);

  // 6. a non-unique lookup key is a Query, not a confirmed P2
  const pc = { lookup: { records: [{ verdict: 'query', sheet: 'S', cell: 'B9', text: 'key appears twice', keyParts: [] }], counts: {} }, average: { records: [] }, fallback: { records: [] }, independence: { records: [] }, timestamp: { records: [] } };
  const lf = buildPathCheckFindings(pc).filter(x => x.id === 'T0-LOOKUP-002');
  assignRecordTypes(lf);
  check('T0-LOOKUP-002 keeps record type Query through classification', lf.length === 1 && lf[0].record_type === 'Query');

  // 7. a path check that throws is reported as not completed, not as zero tests
  const broken = runPathChecks(null, null, {});
  const rows = pathCheckRows(broken);
  check('a failed check carries its error into the summary', rows.summary.length >= 3 && rows.summary.every(s => s.failed && /./.test(s.failed)));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep38-'));
  const mk = (id, o) => Object.assign({ id, sheet: 'S', cell: 'B2', severity: 'high', status: 'fail', confidence: 90, label: id, condition: 'c', reason: 'c', corrective_action: 'x', fix_instruction: 'x', category: 'Structure', workstream: 'Structure', issue_type: 'x', root_cause: 'rc ' + id, urgency: 'Before next reliance', method: 'automated', needs_retest: false, escalation_flag: false, key_output_impact: 'No', model_risk: 'm', cause: 'c', consequence: 'q', criteria: 'k' }, o);
  const payloadFor = (pathChecks, findings) => ({ originalName: 't.xlsx', modelType: 't', modelIndustry: 't', modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['S'] }, tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] }, overallAssessment: 'audit_complete', igReadiness: 97, igCommentary: 't', ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false }, namedRangeAudit: { applicable: false }, formulaDeepDive: { applicable: false }, reasonableness: {}, duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {}, crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings, pathChecks });
  const build = (name, payload) => {
    fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(payload));
    const b = spawnSync('python3', ['src/build_report.py', path.join(dir, name + '.json'), path.join(dir, name + '.xlsx')], { encoding: 'utf8', timeout: 180000 });
    if (b.status !== 0) return { error: String(b.stderr).slice(-300) };
    const py = 'import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1])\nfor ws in wb:\n  for r in ws.iter_rows():\n    for c in r:\n      if c.value is not None: print(ws.title+"|"+str(c.value).replace("\\n"," "))';
    return { text: spawnSync('python3', ['-c', py, path.join(dir, name + '.xlsx')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || '' };
  };
  const failed = build('failed', payloadFor(rows, []));
  check('report: the Path Checks tab exists and says NOT COMPLETED when every check failed', !failed.error && /Path Checks\|.*NOT COMPLETED/.test(failed.text));
  check('report: Scope tab lists the path checks as not completed, not as a pass', /Scope and Reliance\|Path checks \(Lookup contract/.test(failed.text) && /Not completed/.test(failed.text));
  check('report: an unrelated check failing does not by itself make the verdict worse', !/Not reliance-ready/.test(failed.text) || /Not reliance-ready/.test(build('clean', payloadFor(null, [])).text));

  // 8. report: two Critical Queries at one cell are both counted as blocking, and the location count is shown
  const cq = (id, conf) => mk(id, { record_type: 'Critical Query', cell: 'AP42', confidence: conf, same_location_group: 'S!AP42' });
  const two = build('cq', payloadFor(null, [cq('T2-A-001', 60), cq('T2-A-002', 40)]));
  check('report: two Critical Queries at one location read "2 ... (at 1 location)"', !two.error && /2 unresolved Critical Queries \(at 1 location\)/.test(two.text));
  const none = build('cq0', payloadFor(null, [mk('T2-A-003', { record_type: 'Critical Query', cell: 'AP9', same_location_group: undefined })]));
  check('report: one Critical Query has no location note', /1 unresolved Critical Query(?! \()/.test(none.text));

  console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 38 checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL: ' + e.stack); process.exit(1); });
