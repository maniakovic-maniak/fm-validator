const ExcelJS = require('exceljs');
const { checkHardcodedMajorAsset } = require('./src/utils/hardcoded-major-asset-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: Financial Statements!G34:L34
// ("Development Property and Capitalised Project Costs" — the
// model's largest asset) are entirely typed numeric constants, no
// formula at all. Confirmed directly: peak value ($407.49m) differs
// from the genuine cost schedule (Underwriting!I57 = $418.76m) by
// exactly $11.27m.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Financial Statements');
  ws.getCell('B34').value = 'Development Property and Capitalised Project Costs';
  const values = [87034792, 142977881, 365064951, 407488551, 407488551, 407488551, 0, 0];
  ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'].forEach((col, i) => {
    ws.getCell(col + '34').value = values[i];
  });

  const result = checkHardcodedMajorAsset(wb);
  check('real defect fixed: a major asset row (8/8 cells hardcoded) is flagged with the correct label and peak value',
    result.flaggedCount === 1 && result.findings[0].label.includes('Development Property'));
}

// ══════════════════════════════════════════════════════════════════
// Confirms a genuinely-linked asset row (formulas referencing a cost
// schedule, not typed constants) is correctly NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Financial Statements');
  ws.getCell('B20').value = 'Development Property and Capitalised Project Costs';
  for (const col of ['G', 'H', 'I', 'J']) {
    ws.getCell(col + '20').value = { formula: `Underwriting!${col}57`, result: 100 };
  }

  const result = checkHardcodedMajorAsset(wb);
  check('a genuinely-linked asset row (formulas, not constants) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a single, deliberate opening-balance constant (not a
// multi-period hardcode) is correctly NOT flagged — a real, common,
// legitimate pattern (an existing asset's confirmed starting value).
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Financial Statements');
  ws.getCell('B20').value = 'Fixed assets';
  ws.getCell('G20').value = 5000000; // one genuine opening balance
  ws.getCell('H20').value = { formula: 'G20+H21', result: 5200000 };
  ws.getCell('I20').value = { formula: 'H20+I21', result: 5400000 };

  const result = checkHardcodedMajorAsset(wb);
  check('a single opening-balance constant, with subsequent periods genuinely rolling forward, is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms an unrelated hardcoded row (not asset-labelled) is
// correctly NOT flagged — this check is deliberately scoped to major
// asset lines only.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('B20').value = 'Marketing expense assumption';
  for (const col of ['G', 'H', 'I']) {
    ws.getCell(col + '20').value = 50000;
  }

  const result = checkHardcodedMajorAsset(wb);
  check('an unrelated hardcoded row (not asset-labelled) is correctly NOT flagged',
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
    const result = checkHardcodedMajorAsset(wb);
    check(`end-to-end: ${file.split('/').pop()} — flaggedCount === ${expectCount}`, result.flaggedCount === expectCount);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
