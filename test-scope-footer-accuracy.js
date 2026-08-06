const fs = require('fs');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

async function readAuditOutputText(outputPath) {
  const py = `
import openpyxl
wb = openpyxl.load_workbook("${outputPath}", data_only=True)
ws = wb["Audit Output"]
out = []
for r in range(1, 65):
    for c in range(1, 10):
        v = ws.cell(r,c).value
        if v is not None:
            out.append(str(v))
print("|||".join(out))
`;
  const scriptPath = '/tmp/_read_scope_footer.py';
  fs.writeFileSync(scriptPath, py);
  const { stdout } = await execFileAsync('python3', [scriptPath]);
  return stdout;
}

(async () => {
  const payloadPath = '/tmp/test-scope-footer-payload.json';
  const outputPath = '/tmp/test-scope-footer-output.xlsx';
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

  try {
    await execFileAsync('python3', ['src/build_report.py', payloadPath, outputPath]);
  } catch (e) {
    console.error('Report build failed:', e.message);
    process.exit(1);
  }

  const text = await readAuditOutputText(outputPath);

  check('the old, self-contradicting claim ("named-range audit... were not included") is gone entirely',
    !text.includes('named-range audit') || !text.includes('were not included'));
  check('the old, inaccurate "VBA review... were not included" claim is gone entirely',
    !text.includes('VBA review'));
  check('the corrected footer correctly still lists the genuine, remaining limitation (source document testing)',
    text.includes('source document testing'));
  check('the corrected footer mentions formula-text inspection is now partial ("comprehensive"), not flatly absent',
    text.includes('comprehensive formula-text inspection'));

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
