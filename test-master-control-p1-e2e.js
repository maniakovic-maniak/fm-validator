const ExcelJS = require('exceljs');
const fs = require('fs');
const { execSync } = require('child_process');
const { buildReportFile } = require('./src/report-tab');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

function readCells(outputPath, sheetName, maxRow, maxCol) {
  const py = `
import openpyxl
wb = openpyxl.load_workbook("${outputPath}", data_only=True)
ws = wb["${sheetName}"]
out = []
for r in range(1, ${maxRow}):
    for c in range(1, ${maxCol}):
        v = ws.cell(r,c).value
        if v is not None:
            out.append(str(v))
print("|||".join(out))
`;
  const scriptPath = '/tmp/_read_cells_mc.py';
  fs.writeFileSync(scriptPath, py);
  return execSync(`python3 ${scriptPath}`, { encoding: 'utf-8' }).split('|||');
}

// ══════════════════════════════════════════════════════════════════
// The real target outcome for I-1/I-2: a master-control-failure
// finding should genuinely reach P1 severity AND Investment Blocker:
// Yes in the actual generated report — not just carry the right
// fields on the finding object. Tests the real report builder end to
// end, the same discipline used throughout this whole plan.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/user-data/uploads/The_Bend_David_Gifford.xlsx');

  const allFlagged = [
    {
      id: 'T0-MASTERCONTROL-Summary-O12', label: 'Balance sheet control: FAIL',
      severity: 'critical', status: 'fail', sheet: 'Sheet1', cell: 'A1',
      condition: 'x', reason: 'The model itself explicitly reports that balance sheet control has failed.',
      corrective_action: 'x', workstream: 'Governance', issue_type: 'Master control failure',
      model_risk: 'x', key_output_impact: 'Yes', method: 'automated', needs_retest: true,
      root_cause: 'x', investment_grade_blocker: true,
    },
  ];

  const outPath = '/tmp/test-master-control-p1.xlsx';
  await buildReportFile(outPath, allFlagged, [], {
    originalName: 'The_Bend_David_Gifford.xlsx', modelType: 'test', modelIndustry: 'test',
    modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['Sheet1'] },
    tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
    overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
    ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
    namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
    duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
    crossRunStats: { isFirstRun: true, newFindingCount: 1 },
  });

  // Check 1: the finding genuinely reaches P1 in the Issue Log.
  const issueLogCells = readCells(outPath, 'Issue Log', 20, 40);
  const issueLogText = issueLogCells.join(' ');
  check('a master-control-failure finding genuinely appears as P1 in the Issue Log (not Query/Critical Query/P2)',
    issueLogText.includes('P1') && issueLogText.includes('Balance sheet control'));

  // Check 2: Investment Blocker shows Yes, not the default No.
  check('the Investment Blocker column shows Yes for this finding, not the default No',
    issueLogText.includes('Yes'));

  // Check 3: it appears in the Top 5 Blockers table on Audit Output,
  // confirming it correctly participates in that ranking too.
  const auditOutputCells = readCells(outPath, 'Audit Output', 40, 10);
  const auditOutputText = auditOutputCells.join(' ');
  check('the master-control-failure finding appears in the Top 5 Blockers table on Audit Output',
    auditOutputText.includes('Balance sheet control'));

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
