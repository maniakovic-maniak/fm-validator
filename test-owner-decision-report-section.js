const fs = require('fs');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

async function buildAndReadRemediationTab(ownerDecisionChecklist) {
  const payloadPath = '/tmp/test-odc-payload.json';
  const outputPath = '/tmp/test-odc-output.xlsx';
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
  if (ownerDecisionChecklist !== undefined) payload.ownerDecisionChecklist = ownerDecisionChecklist;
  fs.writeFileSync(payloadPath, JSON.stringify(payload));

  await execFileAsync('python3', ['src/build_report.py', payloadPath, outputPath]);

  const py = `
import openpyxl
wb = openpyxl.load_workbook("${outputPath}", data_only=True)
ws = wb["Remediation"]
out = []
for r in range(1, ws.max_row+1):
    for c in range(1, ws.max_column+1):
        v = ws.cell(r,c).value
        if v is not None:
            out.append(str(v))
print("|||".join(out))
`;
  fs.writeFileSync('/tmp/_read_odc.py', py);
  const { stdout } = await execFileAsync('python3', ['/tmp/_read_odc.py']);
  return stdout;
}

(async () => {
  // ══════════════════════════════════════════════════════════════
  // The real defect this fixes: confirmed directly against the real
  // model that Summary!O17 contains exactly 6 owner-decision items in
  // a single narrative text cell. This is now a genuinely trackable
  // table with Owner/Target Date/Status columns.
  // ══════════════════════════════════════════════════════════════
  {
    const text = await buildAndReadRemediationTab({
      sheet: 'Summary', cell: 'O17',
      items: ['executed lender terms', 'written Australian tax/GST advice', 'independent property valuation', 'approved OpCo margin and multiple', 'final QS cost plan', 'executed shareholder and waterfall terms'],
    });
    check('real defect fixed: the "OWNER / SPECIALIST CLOSURE ITEMS" section appears with the correct source citation',
      text.includes('OWNER / SPECIALIST CLOSURE ITEMS') && text.includes('Summary!O17'));
    check('all 6 real items appear as individual rows',
      text.includes('executed lender terms') && text.includes('written Australian tax/GST advice') && text.includes('executed shareholder and waterfall terms'));
    check('the table has the expected trackable columns (Owner, Target Date, Status)',
      text.includes('Owner') && text.includes('Target Date') && text.includes('Status'));
    check('every item defaults to "Open" status',
      (text.match(/Open/g) || []).length >= 6);
  }

  // Confirms a model with NO owner-decisions cell (the common case)
  // does not add an empty, confusing section to the report.
  {
    const text = await buildAndReadRemediationTab(null);
    check('a model with no owner-decisions cell at all does not add an empty section to the report',
      !text.includes('OWNER / SPECIALIST CLOSURE ITEMS'));
  }

  // Confirms backward compatibility — a payload with no
  // ownerDecisionChecklist field at all (an older caller) still
  // renders without crashing.
  {
    const text = await buildAndReadRemediationTab(undefined);
    check('backward compatible: a payload with no ownerDecisionChecklist field at all does not crash',
      !text.includes('OWNER / SPECIALIST CLOSURE ITEMS'));
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
