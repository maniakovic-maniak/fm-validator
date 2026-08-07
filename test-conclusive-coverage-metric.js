const fs = require('fs');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

async function buildAndReadAuditOutput(ruleResults) {
  const payloadPath = '/tmp/test-conclusive-coverage-payload.json';
  const outputPath = '/tmp/test-conclusive-coverage-output.xlsx';
  const payload = {
    originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
    modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['Sheet1'] },
    tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
    overallAssessment: 'not_fit_for_purpose', igReadiness: 55, igCommentary: 'test',
    ruleResults,
    errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
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
ws = wb["Audit Output"]
out = []
for r in range(1, 25):
    for c in range(1, 10):
        v = ws.cell(r,c).value
        if v is not None:
            out.append(str(v))
print("|||".join(out))
`;
  fs.writeFileSync('/tmp/_read_cov.py', py);
  const { stdout } = await execFileAsync('python3', ['/tmp/_read_cov.py']);
  return stdout;
}

(async () => {
  // ══════════════════════════════════════════════════════════════
  // Matches the review's own cited numbers exactly: 165 planned, 56
  // passed, 35 raised issue, 73 uncertain, 1 not run (the real
  // checklist.json has exactly 165 rules: 18 Tier 1 + 147 Tier 2).
  // (56+35)/165 = 55.15% — confirms the new metric computes this
  // deterministically, independent of any self-reported figure.
  // ══════════════════════════════════════════════════════════════
  const cl = JSON.parse(fs.readFileSync('config/checklist.json'));
  const allIds = [...cl.tier1.map(r => r.id), ...cl.tier2.map(r => r.id)];
  check('sanity: the real checklist.json has exactly 165 rules, matching the review\'s own cited "165 planned"',
    allIds.length === 165);

  const ruleResults = [];
  let idx = 0;
  for (let i = 0; i < 56; i++) ruleResults.push({ id: allIds[idx++], status: 'pass' });
  for (let i = 0; i < 35; i++) ruleResults.push({ id: allIds[idx++], status: 'fail' });
  for (let i = 0; i < 73; i++) ruleResults.push({ id: allIds[idx++], status: 'uncertain' });
  // The 165th rule (idx now at 164, one remaining) is deliberately
  // left with no matching result at all — genuinely "not run".

  const text = await buildAndReadAuditOutput(ruleResults);
  check('real-numbers defect check: the new metric shows 55% concluded, matching (56+35)/165, computed independently of igReadiness itself',
    text.includes('(55% concluded)'));

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
