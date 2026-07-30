const ExcelJS = require('exceljs');
const { checkExceptionStatusRows } = require('./src/utils/exception-status-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: check/reconciliation rows literally
// evaluating to "EXCEPTION" across many periods, with no visible gate
// preventing the report's summary from being generated regardless.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Financial Statements');
  ws.getCell('B53').value = 'BALANCE SHEET STATUS';
  for (const col of ['H', 'I', 'J', 'K', 'L', 'M', 'N']) {
    ws.getCell(col + '53').value = { formula: 'IF(G50=0,"OK","EXCEPTION")', result: 'EXCEPTION' };
  }

  const result = checkExceptionStatusRows(wb);
  check('real defect fixed: a row of 7 periods all showing "EXCEPTION" is found and aggregated into one finding with the correct label',
    result.flaggedCount === 1 && result.findings[0].instanceCount === 7 && result.findings[0].label === 'BALANCE SHEET STATUS');
}

// ══════════════════════════════════════════════════════════════════
// Confirms a check row that genuinely passes ("OK") is correctly NOT
// flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('B10').value = 'Balance check';
  for (const col of ['H', 'I', 'J']) {
    ws.getCell(col + '10').value = { formula: 'IF(G5=0,"OK","EXCEPTION")', result: 'OK' };
  }

  const result = checkExceptionStatusRows(wb);
  check('a genuinely passing check row ("OK") is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms an unrelated cell containing the word "exception" as part
// of a longer sentence (not the exact literal status value) is not
// falsely flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'This is an exception to the general rule.';

  const result = checkExceptionStatusRows(wb);
  check('a sentence merely containing the word "exception" (not an exact literal status match) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against all four real files.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
(async () => {
  const files = [
    ['/tmp/test_fixed2.xlsm', 2],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', 0],
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', 0],
    ['/mnt/project/Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm', 0],
  ];
  for (const [file, expectCount] of files) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const result = checkExceptionStatusRows(wb);
    check(`end-to-end: ${file.split('/').pop()} — flaggedCount === ${expectCount}`, result.flaggedCount === expectCount);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
