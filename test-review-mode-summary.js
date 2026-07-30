const ExcelJS = require('exceljs');
const openpyxl_check = require('child_process');
const { buildReportFile } = require('./src/report-tab');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

const fs = require('fs');

function findAuditOutputLine(outputPath, needle) {
  const py = `
import openpyxl
wb = openpyxl.load_workbook("${outputPath}", data_only=True)
ws = wb["Audit Output"]
found = None
for r in range(1, 30):
    for c in range(1, 10):
        v = ws.cell(r,c).value
        if v and isinstance(v, str) and "${needle}" in v:
            found = v
            break
    if found: break
print(found or "")
`;
  const scriptPath = '/tmp/_find_audit_output_line.py';
  fs.writeFileSync(scriptPath, py);
  const result = openpyxl_check.execSync(`python3 ${scriptPath}`, { encoding: 'utf-8' });
  return result.trim();
}

const baseMeta = {
  originalName: 'The_Bend_David_Gifford.xlsx', modelType: 'test', modelIndustry: 'test',
  modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['Sheet1'] },
  tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
  overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
  ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
  namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
  duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
  crossRunStats: { isFirstRun: true, newFindingCount: 1 },
};

function makeFinding(id, reviewMode) {
  const f = {
    id, label: 'Test', severity: 'medium', status: 'fail', sheet: 'Sheet1', cell: 'A1',
    condition: 'x', reason: 'x', corrective_action: 'x', workstream: 'Accounting', issue_type: 'Test',
    model_risk: 'x', key_output_impact: 'No', method: 'llm', needs_retest: true, root_cause: 'x',
  };
  if (reviewMode !== undefined) f.review_mode = reviewMode;
  return f;
}

// ══════════════════════════════════════════════════════════════════
// The real feature this tests: the Tier 2 review-depth summary added
// to Audit Output — a one-glance, ongoing check that formula-text
// grounding (Mode A+) is genuinely being used, confirmed via a real
// production run where a schema fix (soul.md) was needed before any
// findings showed this at all.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/user-data/uploads/The_Bend_David_Gifford.xlsx');

  // Case 1: mixed modes — 1 of 3 formula-grounded (33%).
  {
    const allFlagged = [
      makeFinding('T2-S5-001', 'llm_with_partial_formulas'),
      makeFinding('T2-S5-002', 'llm_only'),
      makeFinding('T2-S5-003', undefined), // missing entirely — must default to llm_only
    ];
    const outPath = '/tmp/test-rms-mixed.xlsx';
    await buildReportFile(outPath, allFlagged, [], baseMeta);
    const line = findAuditOutputLine(outPath, 'Tier 2 review depth');
    check('mixed-mode case: shows "1 of 3... (33%)" and correctly defaults a missing review_mode to llm_only',
      line.includes('1 of 3 Tier 2 finding(s) (33%)'));
  }

  // Case 2: all llm_only — the "zero formula-grounded" message variant.
  {
    const allFlagged = [makeFinding('T2-S5-001', 'llm_only')];
    const outPath = '/tmp/test-rms-zero.xlsx';
    await buildReportFile(outPath, allFlagged, [], baseMeta);
    const line = findAuditOutputLine(outPath, 'Tier 2 review depth');
    check('all-llm_only case: shows the "no formula-text-grounded findings" message, not a false "0 of 1 (0%)"',
      line.includes('based on values and labels alone (no formula-text-grounded findings)'));
  }

  // Case 3: no T2-* findings at all (e.g. a run with only T0/T1
  // findings) — must not crash, and should produce no line at all
  // rather than a misleading "0 of 0" summary.
  {
    const allFlagged = [
      { id: 'T0-COVENANT-Sheet1-152', label: 'Test T0', severity: 'high', status: 'fail',
        sheet: 'Sheet1', cell: 'A1', condition: 'x', reason: 'x', corrective_action: 'x',
        workstream: 'Debt', issue_type: 'Test', model_risk: 'x', key_output_impact: 'Yes',
        method: 'automated', needs_retest: true },
    ];
    const outPath = '/tmp/test-rms-no-t2.xlsx';
    let threw = false;
    try { await buildReportFile(outPath, allFlagged, [], baseMeta); } catch (e) { threw = true; console.error(e); }
    check('a run with no T2-* findings at all does not crash the report build', !threw);
    if (!threw) {
      const line = findAuditOutputLine(outPath, 'Tier 2 review depth');
      check('a run with no T2-* findings at all produces no misleading "0 of 0" summary line',
        line === '');
    }
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
