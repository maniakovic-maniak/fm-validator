const ExcelJS = require('exceljs');
const { checkValuationMethodDivergence, checkDebtYieldNegative } = require('./src/utils/reasonableness-checks.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// checkValuationMethodDivergence — the real defect: Completed
// property value ($679.6m) vs Property DCF value ($242.6m), a 2.8x /
// 64% gap between two valuation methods for the same asset.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('VALUATIONS');
  ws.getCell('J8').value = 'Completed property value (base, untrended)';
  ws.getCell('K8').value = 679.6;
  ws.getCell('J12').value = 'Property DCF value';
  ws.getCell('K12').value = 242.6;

  const result = checkValuationMethodDivergence(wb);
  check('real defect fixed: a 64% divergence between property value and DCF value is found',
    result.found === true && result.divergencePct > 60 && result.divergencePct < 70);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a modest, expected difference between methods (well under
// the conservative 50% threshold) is correctly NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('VALUATIONS');
  ws.getCell('J1').value = 'Property value';
  ws.getCell('K1').value = 100;
  ws.getCell('J2').value = 'DCF value';
  ws.getCell('K2').value = 92;

  const result = checkValuationMethodDivergence(wb);
  check('a modest, ordinary divergence (8%) between valuation methods is correctly NOT flagged',
    result.found === false);
}

// ══════════════════════════════════════════════════════════════════
// checkDebtYieldNegative — the real defect: a periodic "Debt yield"
// row showing -7.6% in one period, with a unit label ("%") sitting
// immediately to the right of the metric label before the real
// numeric series begins further along the row.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DEBT');
  ws.getCell('A133').value = 'Debt yield';
  ws.getCell('B133').value = '%';
  ws.getCell('C133').value = 'Annualised NOI / total debt';
  ws.getCell('F133').value = 0.02;
  ws.getCell('G133').value = 0.005;
  ws.getCell('H133').value = 0.02;
  ws.getCell('I133').value = 0.005;
  ws.getCell('J133').value = 0.003;
  ws.getCell('K133').value = 0.002;
  ws.getCell('L133').value = -0.076;
  ws.getCell('M133').value = 0.3;

  const result = checkDebtYieldNegative(wb);
  check('real defect fixed: a negative periodic debt-yield value is found despite a unit label sitting between the metric label and the real series',
    result.found === true && result.flagged[0].negativeCells[0].includes('-7.6%'));
}

// ══════════════════════════════════════════════════════════════════
// Confirms an all-positive debt yield series is correctly NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DEBT');
  ws.getCell('A50').value = 'Debt yield';
  ws.getCell('B50').value = '%';
  ws.getCell('F50').value = 0.08;
  ws.getCell('G50').value = 0.09;
  ws.getCell('H50').value = 0.10;

  const result = checkDebtYieldNegative(wb);
  check('an all-positive periodic debt-yield series is correctly NOT flagged',
    result.found === false);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against all four real files.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
(async () => {
  const files = [
    ['/mnt/user-data/uploads/The_Bend_Precinct_Model_26_7_2026_Investor_Ready_v6.xlsm', true, true],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', false, false],
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', false, false],
    ['/mnt/project/Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm', false, false],
  ];
  for (const [file, expectValGap, expectYieldNeg] of files) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const valResult = checkValuationMethodDivergence(wb);
    const yieldResult = checkDebtYieldNegative(wb);
    check(`end-to-end valuation divergence: ${file.split('/').pop()} — found === ${expectValGap}`, valResult.found === expectValGap);
    check(`end-to-end debt yield negative: ${file.split('/').pop()} — found === ${expectYieldNeg}`, yieldResult.found === expectYieldNeg);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
