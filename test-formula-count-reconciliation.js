const ExcelJS = require('exceljs');
const fs = require('fs');
const { parseWorkbook } = require('./src/parser.js');
const { runTier0 } = require('./src/validator-tier0.js');
const { checkFormulaCountReconciliation } = require('./src/utils/formula-count-reconciliation-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes (part 1): Tier 0's formula-cell count
// silently undercounted relative to the raw OOXML <c><f> count.
// Traced 4 of a confirmed 5-cell gap precisely to Excel Data Table
// (What-If Analysis) cells — genuine formula-driven cells that
// ExcelJS exposes only via cell.value.shareType, not cell.formula.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const parsed = await parseWorkbook('/mnt/user-data/uploads/The_Bend_FInancial_Model_3_8_2026.xlsx');
  const tier0 = await runTier0(parsed);
  check('real defect fixed: Tier 0 now separately counts and reports Data Table cells, closing the confirmed 4-of-5-cell undercount',
    tier0.stats.totalDataTableCells === 4 && tier0.stats.formulaCellsIncludingDataTables === tier0.stats.totalFormulaCells + 4);
  check('the reconciled total (65,265) is within 1 cell of the raw OOXML count (65,266) confirmed via direct XML parsing — the one remaining cell is a distinct, unrelated ExcelJS quirk',
    tier0.stats.formulaCellsIncludingDataTables === 65265);

  // ══════════════════════════════════════════════════════════════
  // The real defect this fixes (part 2): the model's own self-
  // reported formula count (63,392, embedded on VALUATION & RETURNS,
  // repeated across 21 period columns) differs materially from this
  // audit's own count, with no reconciliation surfaced anywhere.
  // ══════════════════════════════════════════════════════════════
  const result = checkFormulaCountReconciliation(parsed._raw, tier0.stats);
  check('real defect fixed: the model\'s own self-reported count (63,392) is found and flagged as a material discrepancy',
    result.flaggedCount === 1 && result.findings[0].selfReportedCount === 63392);
  check('the same self-reported figure repeated across 21 period columns aggregates into ONE finding, not 21',
    result.findings[0].instanceCount === 21);

  // Confirms a small, local per-component formula count (using the
  // same "N formulas" phrasing but nowhere near the workbook's scale)
  // is correctly NOT treated as a workbook-wide self-report.
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.getCell('A1').value = '369 formulas';
    const fakeStats = { totalFormulaCells: 65265, formulaCellsIncludingDataTables: 65265 };
    const localResult = checkFormulaCountReconciliation(wb, fakeStats);
    check('a small, local per-component formula count (nowhere near the workbook\'s scale) is correctly NOT treated as a workbook-wide self-report',
      localResult.flaggedCount === 0);
  }

  // Confirms a self-reported count within tolerance (the genuine
  // 65,246 case, now within 0.03% of the improved Tier 0 count) is
  // correctly NOT flagged as material.
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.getCell('A1').value = 'All 14 worksheets | 252,348 used cells | 65,246 formulas';
    const fakeStats = { totalFormulaCells: 65261, formulaCellsIncludingDataTables: 65265 };
    const closeResult = checkFormulaCountReconciliation(wb, fakeStats);
    check('a self-reported count within the expected tolerance (0.03% here) is correctly NOT flagged as material',
      closeResult.flaggedCount === 0);
  }

  // ══════════════════════════════════════════════════════════════
  // End-to-end confirmation against every discovered reference file —
  // dynamically found via fixtures-helper.js, not a fixed list.
  // ══════════════════════════════════════════════════════════════
  const { getFixtureFiles, getKnownExpectation } = require('./fixtures-helper.js');
  const KNOWN_EXPECTATIONS = {
    'The_Bend_FInancial_Model_3_8_2026.xlsx': 1,
    'CarlsbergFinancialModel_1.xlsm': 0,
    'Financial_Model_The_Bend_13_7_2026_Audited.xlsx': 0,
    'Qantas_1.xlsx': 0,
  };
  const fixtures = getFixtureFiles();
  if (fixtures.length === 0) {
    console.log('SKIPPED: no reference files found (checked test-fixtures/ and the sandbox fallback)');
  }
  for (const { path: filePath, filename } of fixtures) {
    const p = await parseWorkbook(filePath);
    const t0 = await runTier0(p);
    const r = checkFormulaCountReconciliation(p._raw, t0.stats);
    const expected = getKnownExpectation(KNOWN_EXPECTATIONS, filename);
    if (expected !== undefined) {
      check(`end-to-end: ${filename} — flaggedCount === ${expected}`, r.flaggedCount === expected);
    } else {
      check(`end-to-end: ${filename} — ran without crashing (no known expected count yet; actual flaggedCount: ${r.flaggedCount} — review and add to KNOWN_EXPECTATIONS once verified)`, true);
    }
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
