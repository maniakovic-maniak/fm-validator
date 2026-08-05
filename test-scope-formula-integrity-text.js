const ExcelJS = require('exceljs');
const fs = require('fs');
const { execSync } = require('child_process');
const { buildReportFile } = require('./src/report-tab');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

function readAuditOutputLines(outputPath) {
  const py = `
import openpyxl
wb = openpyxl.load_workbook("${outputPath}", data_only=True)
ws = wb["Audit Output"]
out = []
for r in range(1, 60):
    for c in range(1, 10):
        v = ws.cell(r,c).value
        if v is not None:
            out.append(str(v))
print("|||".join(out))
`;
  const scriptPath = '/tmp/_read_ao_i13.py';
  fs.writeFileSync(scriptPath, py);
  return execSync(`python3 ${scriptPath}`, { encoding: 'utf-8' }).split('|||');
}

const baseMeta = {
  originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
  modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['Sheet1'] },
  overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
  ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
  namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
  duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
  crossRunStats: { isFirstRun: true, newFindingCount: 0 },
};

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/user-data/uploads/The_Bend_David_Gifford.xlsx');

  // ══════════════════════════════════════════════════════════════
  // The exact real bug: confirmed directly on a real report that
  // "Formula integrity" showed "formula errors or external links
  // detected" — with no "No" prefix at all — even though zero
  // external links and zero #REF! errors genuinely existed, directly
  // contradicting the Error Matrix and Validation Matrix elsewhere in
  // the same report.
  // ══════════════════════════════════════════════════════════════
  {
    const outPath = '/tmp/test-i13-clean.xlsx';
    await buildReportFile(outPath, [], [], {
      ...baseMeta,
      tier0: { stats: { totalExternalLinks: 0, totalRefInFormula: 0, fscoreDist: { High: 0 } }, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
    });
    const lines = readAuditOutputLines(outPath);
    const text = lines.join(' ');
    check('real bug fixed: with zero external links/errors, the text correctly says "No formula errors or external links detected"',
      text.includes('No formula errors or external links detected'));
    check('the old, contradictory static text ("formula errors or external links detected" with no "No") no longer appears at all',
      !text.includes('formula errors or external links detected —') && !/(?<!No )formula errors or external links detected\b/.test(text.replace('No formula errors or external links detected', '')));
    check('with zero high-complexity formulas, the text correctly says "No high-complexity formulas found"',
      text.includes('No high-complexity formulas found'));
  }

  // ══════════════════════════════════════════════════════════════
  // Confirms the "issues genuinely exist" case still shows the
  // correct, informative — and now quantified — problem text, not
  // just flipped to always-clean.
  // ══════════════════════════════════════════════════════════════
  {
    const outPath = '/tmp/test-i13-issues.xlsx';
    await buildReportFile(outPath, [], [], {
      ...baseMeta,
      tier0: { stats: { totalExternalLinks: 2, totalRefInFormula: 1, fscoreDist: { High: 5 } }, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
    });
    const lines = readAuditOutputLines(outPath);
    const text = lines.join(' ');
    check('with genuine external links/errors, the text correctly shows them (now quantified, not just a static phrase)',
      text.includes('Formula errors or external links detected') && text.includes('2 external link(s)') && text.includes('1 #REF! occurrence(s)'));
    check('with genuine high-complexity formulas, the text correctly shows the count',
      text.includes('5 high-complexity formula(s) found'));
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
