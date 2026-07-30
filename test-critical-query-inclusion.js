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
  const scriptPath = '/tmp/_read_cells.py';
  fs.writeFileSync(scriptPath, py);
  return execSync(`python3 ${scriptPath}`, { encoding: 'utf-8' }).split('|||');
}

// ══════════════════════════════════════════════════════════════════
// The real bug this fixes (build_report.py findings #3 and #4 from a
// full-repo bug scan): the Remediation tab and Top 5 Blockers table
// both excluded open Critical Queries, even though this file's own
// verdict/reason/key-takeaway logic treats an unresolved Critical
// Query as equally reliance-blocking as a P1. Tests the exact
// scenario the report described: zero P1s, one Critical Query — the
// old code would have produced an empty/irrelevant table despite the
// banner screaming about a blocking Critical Query.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/user-data/uploads/The_Bend_David_Gifford.xlsx');

  const allFlagged = [
    {
      id: 'T2-CQ-001', record_type: 'Critical Query', status: 'fail',
      label: 'Cannot confirm whether the terminal value uses a consistent growth rate',
      title: 'Cannot confirm whether the terminal value uses a consistent growth rate',
      severity: 'high', sheet: 'Sheet1', cell: 'A1',
      condition: 'x', reason: 'x', corrective_action: 'Confirm the terminal growth rate assumption directly with the model owner.',
      fix_instruction: 'Confirm the terminal growth rate assumption directly with the model owner.',
      workstream: 'Valuation', issue_type: 'Query', model_risk: 'Cannot confirm terminal value methodology.',
      key_output_impact: 'Yes', method: 'llm', needs_retest: true, root_cause: 'x',
    },
  ];

  const outPath = '/tmp/test-critical-query-inclusion.xlsx';
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

  // Check 1: Top 5 Blockers table (on Audit Output) now includes the
  // Critical Query's own text, not an empty/irrelevant table.
  const auditOutputCells = readCells(outPath, 'Audit Output', 40, 10);
  const auditOutputText = auditOutputCells.join(' ');
  check('Top 5 Blockers table includes the Critical Query finding text (not empty/irrelevant despite zero P1s)',
    auditOutputText.includes('terminal value uses a consistent growth rate'));

  // Check 2: Remediation tab now includes a tracking row for it.
  const remCells = readCells(outPath, 'Remediation', 15, 20);
  const remText = remCells.join(' ');
  check('Remediation tab includes a tracking row for the Critical Query (not silently excluded)',
    remText.includes('Critical Query') && remText.includes('terminal growth rate assumption'));

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
