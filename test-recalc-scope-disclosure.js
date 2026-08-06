const fs = require('fs');
const { execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

async function buildAndReadScopeTab(recalcCheckResult) {
  const payloadPath = '/tmp/test-recalc-payload.json';
  const outputPath = '/tmp/test-recalc-output.xlsx';
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
  if (recalcCheckResult !== undefined) payload.recalcCheckResult = recalcCheckResult;
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
  fs.writeFileSync('/tmp/_read_recalc_scope.py', py);
  const { stdout } = await execFileAsync('python3', ['/tmp/_read_recalc_scope.py']);
  return stdout;
}

(async () => {
  // ══════════════════════════════════════════════════════════════
  // The real defect this fixes: a clean, zero-mismatch recalculation
  // (the common, expected case) previously produced NO report entry
  // at all — the reader had no way to know a genuine, independent
  // recalculation even happened. This is the most important case.
  // ══════════════════════════════════════════════════════════════
  {
    const text = await buildAndReadScopeTab({
      status: 'success', mismatch_count: 0, formula_cells_checked: 15690,
      genuine_circular_groups: 3, sanitized_defined_names_count: 0,
    });
    check('real defect fixed: a clean, zero-mismatch recalculation now explicitly appears in the report (was previously entirely invisible)',
      text.includes('Independent formula recalculation') && text.includes('15,690') && text.includes('found zero cells'));
  }

  // Confirms a genuine mismatch case still reports correctly, now with
  // full methodology context alongside the existing Issue Log finding.
  {
    const text = await buildAndReadScopeTab({
      status: 'success', mismatch_count: 3, formula_cells_checked: 15690,
      genuine_circular_groups: 3, sanitized_defined_names_count: 7,
    });
    check('a genuine mismatch case reports the count and methodology, including the sanitized-defined-names caveat',
      text.includes('found 3 cell(s)') && text.includes('7 defined name(s)'));
  }

  // Confirms the "unavailable" (never ran at all) case is correctly
  // disclosed as "Not performed", not silently omitted.
  {
    const text = await buildAndReadScopeTab({ status: 'unavailable', reason: 'formualizer not installed' });
    check('the "unavailable" case (recalculation engine not installed) is disclosed as Not performed with the real reason',
      text.includes('Not performed') && text.includes('formualizer not installed'));
  }

  // Confirms the "skipped_too_large" case is correctly disclosed.
  {
    const text = await buildAndReadScopeTab({ status: 'skipped_too_large', formula_cells: 2000000, threshold: 1500000 });
    check('the "skipped_too_large" case is disclosed with the actual cell count and threshold',
      text.includes('2,000,000') && text.includes('1,500,000'));
  }

  // Confirms backward compatibility — a payload with no
  // recalcCheckResult field at all (an older caller) still renders
  // without crashing, falling back to "unavailable".
  {
    const text = await buildAndReadScopeTab(undefined);
    check('backward compatible: a payload with no recalcCheckResult field at all does not crash, falling back to Not performed',
      text.includes('Independent formula recalculation') && text.includes('Not performed'));
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
