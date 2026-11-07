// Patch 56: (1) a failed Tier 1 "No ..." check is headed by what it found, not by the rule title (Fm-00060, T1-013);
// (2) an expanding SUM range on a row labelled allowance/depreciation/amortisation is reported as a Query.
const fs = require('fs');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS: ' + n); } else { fail++; console.log('FAIL: ' + n + (extra ? ' -> ' + extra : '')); } };
const py = code => execFileSync('python3', ['-c', code], { cwd: __dirname, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

(async () => {
  // ---- scanner
  const { scanSumRanges } = require('./src/utils/sum-range-scan');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Tax');
  const cols = ['F', 'G', 'H', 'I', 'J', 'K'];
  ws.getCell('A1').value = 'Capital allowances on additions';
  ws.getCell('A2').value = 'Closing balance';
  ws.getCell('A3').value = 'Capital allowance (annual)';       // fixed range, not running
  cols.forEach((c, i) => {
    ws.getCell(c + '1').value = { formula: `SUM($E5:${i ? cols[i - 1] : 'E'}5)` };
    ws.getCell(c + '2').value = { formula: `SUM($E6:${i ? cols[i - 1] : 'E'}6)` };
    ws.getCell(c + '3').value = { formula: 'SUM($E7:$K7)' };
  });
  const scan = scanSumRanges(wb);
  check('two running rows found', scan.runningRows.length === 2, JSON.stringify(scan.runningRows.map(r => r.row)));
  check('only the allowance-labelled running row is listed as allowance', scan.allowanceRows.length === 1 && scan.allowanceRows[0].row === 1 && /allowance/i.test(scan.allowanceRows[0].label), JSON.stringify(scan.allowanceRows));
  check('a fixed-range row labelled allowance is not listed', !scan.allowanceRows.some(r => r.row === 3));

  // ---- both entry points carry the new check
  for (const f of ['server.js', 'index.js']) {
    const src = fs.readFileSync(f, 'utf8');
    check(f + ' raises T0-SUMRANGE-003 as a Query', /id: 'T0-SUMRANGE-003'[\s\S]{0,1800}record_type: 'Query'/.test(src));
    check(f + ' keeps the generic Observation', /id: 'T0-SUMRANGE-001'[\s\S]{0,1800}record_type: 'Observation'/.test(src));
  }

  // ---- headline in the report
  const mk = (id, extra) => Object.assign({ id, severity: 'medium', sheet: 'A', cell: 'A1', category: 'Test', consequence: 'c', corrective_action: 'a', fscore: 1 }, extra);
  const payload = {
    originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
    modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['A'] },
    tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
    overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
    ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
    namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
    duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
    crossRunStats: { isFirstRun: true, newFindingCount: 0 },
    findings: [
      mk('T1-013', { label: 'No hidden rows or columns within calculation areas', condition: '397 hidden row(s)/column(s) contain live content: 1093 formula cell(s) and 543 constant(s) on 15 sheet(s). SystemOperator: columns K-AO (891 formula cells)' }),
      mk('T1-003', { label: 'Model Issues tab contains unresolved items', condition: 'Sheet "Model Issues" has content.' }),
      mk('T1-007', { label: 'No uncontrolled external workbook links' }),
    ],
  };
  fs.writeFileSync('/tmp/test-p56-payload.json', JSON.stringify(payload));
  execFileSync('python3', ['src/build_report.py', '/tmp/test-p56-payload.json', '/tmp/test-p56-out.xlsx'], { cwd: __dirname });
  const r = JSON.parse(py(`
import openpyxl, json
wb = openpyxl.load_workbook('/tmp/test-p56-out.xlsx'); il = wb['Issue Log']
for r in range(1, 12):
    vals = [il.cell(r, c).value for c in range(1, 40)]
    if 'ID' in vals and 'Priority' in vals: hdr = r; names = {v: i + 1 for i, v in enumerate(vals) if v}; break
out = {}; r = hdr + 1
while il.cell(r, names['ID']).value:
    out[il.cell(r, names['ID']).value] = il.cell(r, names['Finding']).value; r += 1
print(json.dumps(out))
`));
  check('T1-013 is headed by what it found', /^397 hidden row\(s\)\/column\(s\) contain live content/.test(r['T1-013']), r['T1-013']);
  check('T1-013 headline no longer says "No hidden rows"', !/^No hidden/.test(r['T1-013']));
  check('a Tier 1 title that already states the problem is kept', r['T1-003'] === 'Model Issues tab contains unresolved items', r['T1-003']);
  check('a "No ..." Tier 1 title with no detail is kept', r['T1-007'] === 'No uncontrolled external workbook links', r['T1-007']);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
