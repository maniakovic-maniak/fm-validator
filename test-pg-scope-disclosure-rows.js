const fs = require('fs');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

(async () => {
  const payloadPath = '/tmp/test-pg-rows-payload.json';
  const outputPath = '/tmp/test-pg-rows-output.xlsx';
  const payload = {
    originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
    modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['Sheet1'] },
    tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
    overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
    ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
    namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
    duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
    crossRunStats: { isFirstRun: true, newFindingCount: 0 },
    findings: [],
  };
  fs.writeFileSync(payloadPath, JSON.stringify(payload));

  await execFileAsync('python3', ['src/build_report.py', payloadPath, outputPath]);

  const py = `
import openpyxl
wb = openpyxl.load_workbook("${outputPath}", data_only=True)
ws = wb["Scope and Reliance"]
out = []
for r in range(1, ws.max_row+1):
    for c in range(1, ws.max_column+1):
        v = ws.cell(r,c).value
        if v is not None:
            out.append(str(v))
print("|||".join(out))
`;
  fs.writeFileSync('/tmp/_read_pg_rows.py', py);
  const { stdout: text } = await execFileAsync('python3', ['/tmp/_read_pg_rows.py']);

  check('PG-007: "Commercial benchmark verification" row appears, distinguished from the internal-threshold reasonableness row',
    text.includes('Commercial benchmark verification') && text.includes('live external market data'));
  check('PG-008: "Specialist tax, GST and accounting sign-off" row appears',
    text.includes('Specialist tax, GST and accounting sign-off') && text.includes('tax specialist'));
  check('PG-009: "Full lender-style credit underwriting" row appears',
    text.includes('Full lender-style credit underwriting') && text.includes('credit committee'));
  check('all three new rows are correctly marked "Not performed" (a genuine, complete limitation)',
    (text.match(/Not performed/g) || []).length >= 4); // 3 new + the pre-existing Source document review row

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
