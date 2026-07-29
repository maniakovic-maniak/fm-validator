const ExcelJS = require('exceljs');
const { checkEquityComponentBackwardSolved } = require('./src/utils/equity-component-backward-solved-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: Financial Statements!G42 ("Contributed
// Equity") = MAX(0,G35-G39-G43-G44) — Total Assets less Total
// Liabilities less Accumulated Profit less Distributions. Confirmed
// directly on the real file.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Financial Statements');
  ws.getCell('B35').value = 'TOTAL ASSETS';
  ws.getCell('G35').value = 87034792;
  ws.getCell('B39').value = 'TOTAL LIABILITIES';
  ws.getCell('G39').value = 0;
  ws.getCell('B42').value = 'Contributed Equity';
  ws.getCell('G42').value = { formula: 'MAX(0,G35-G39-G43-G44)', result: 87034792 };
  ws.getCell('B43').value = 'Cumulative Accumulated Profit';
  ws.getCell('G43').value = 0;
  ws.getCell('B44').value = 'Cumulative Distributions';
  ws.getCell('G44').value = 0;

  const result = checkEquityComponentBackwardSolved(wb);
  check('real defect fixed: "Contributed Equity" derived from Total Assets/Liabilities is flagged',
    result.flaggedCount === 1 && result.findings[0].label === 'Contributed Equity');
}

// ══════════════════════════════════════════════════════════════════
// Confirms a legitimate residual line ("Total Equity") is NOT
// flagged — the accounting equation itself defines this as Assets
// minus Liabilities, and computing it that way is correct, not a defect.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Financial Statements');
  ws.getCell('B10').value = 'TOTAL ASSETS';
  ws.getCell('G10').value = 1000;
  ws.getCell('B11').value = 'TOTAL LIABILITIES';
  ws.getCell('G11').value = 400;
  ws.getCell('B12').value = 'Total Equity';
  ws.getCell('G12').value = { formula: 'G10-G11', result: 600 };

  const result = checkEquityComponentBackwardSolved(wb);
  check('a legitimate residual line ("Total Equity") is correctly NOT flagged — the accounting equation itself defines it this way',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a genuine, independent contributed-equity figure (a
// typed constant or a roll-forward from actual contribution events,
// not derived from Assets/Liabilities) is not flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Financial Statements');
  ws.getCell('B10').value = 'TOTAL ASSETS';
  ws.getCell('G10').value = 1000;
  ws.getCell('B11').value = 'TOTAL LIABILITIES';
  ws.getCell('G11').value = 400;
  ws.getCell('B20').value = 'Contributed Equity';
  ws.getCell('G20').value = { formula: 'SUM(G30:G35)', result: 600 }; // rolled up from actual contribution events, not from row 10/11

  const result = checkEquityComponentBackwardSolved(wb);
  check('a genuine, independent contributed-equity figure (not derived from Total Assets/Liabilities) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against all four real files.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
(async () => {
  const files = [
    ['/tmp/test_fixed2.xlsm', 1],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', 0],
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', 0],
    ['/mnt/project/Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm', 0],
  ];
  for (const [file, expectCount] of files) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const result = checkEquityComponentBackwardSolved(wb);
    check(`end-to-end: ${file.split('/').pop()} — flaggedCount === ${expectCount}`, result.flaggedCount === expectCount);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
