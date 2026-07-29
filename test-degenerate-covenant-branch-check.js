const ExcelJS = require('exceljs');
const { checkDegenerateCovenantBranch } = require('./src/utils/degenerate-covenant-branch-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes — the review's single most serious
// finding: DEBT!F152 = IF(F$123+F$124=0,TRUE,F$144/(F$123+F$124)>=$B$48).
// When debt service is zero, the covenant test passes rather than
// blocking. Confirmed 121 periods share this exact pattern on the real
// file via shared-formula mechanics.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DEBT');
  for (const col of ['F', 'G', 'H']) {
    ws.getCell(col + '152').value = { formula: `IF(${col}$123+${col}$124=0,TRUE,${col}$144/(${col}$123+${col}$124)>=$B$48)`, result: true };
  }

  const result = checkDegenerateCovenantBranch(wb);
  check('real defect fixed: the IF(x=0,TRUE,...) covenant pattern is detected',
    result.flaggedCount === 1 && result.findings[0].instanceCount === 3);
}

// ══════════════════════════════════════════════════════════════════
// The related OR(x=0,ratio>=threshold) variant, confirmed on the same
// real file's row 154 (DSCR/ICR/yield covenant checks).
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DEBT');
  ws.getCell('F154').value = { formula: 'OR(F131=0,F131>=$B$48)', result: true };
  ws.getCell('G154').value = { formula: 'OR(G131=0,G131>=$B$48)', result: true };

  const result = checkDegenerateCovenantBranch(wb);
  check('the OR(x=0,ratio>=threshold) variant is also detected',
    result.flaggedCount === 1 && result.findings[0].pattern === 'OR(x=0,ratio>=threshold)');
}

// ══════════════════════════════════════════════════════════════════
// Aggregation: many periods sharing the same underlying formula
// pattern on one row must collapse into ONE finding with an instance
// count, not one finding per cell.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DEBT');
  const cols = ['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  cols.forEach(col => {
    ws.getCell(col + '100').value = { formula: `IF(${col}$50=0,TRUE,${col}$60/${col}$50>=$B$10)`, result: true };
  });

  const result = checkDegenerateCovenantBranch(wb);
  check('aggregation: 10 periods sharing the same pattern on one row collapse into a single finding',
    result.flaggedCount === 1 && result.findings[0].instanceCount === 10);
}

// ══════════════════════════════════════════════════════════════════
// Confirms an ordinary, benign IF(x=0,...) formula that does NOT
// gate a ratio comparison (a common, harmless pattern — e.g. blank-
// handling) is not falsely flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = { formula: 'IF(B1=0,"",B1*2)', result: '' };
  ws.getCell('A2').value = { formula: 'IF(SUM(B2:D2)=0,0,AVERAGE(B2:D2))', result: 0 };

  const result = checkDegenerateCovenantBranch(wb);
  check('an ordinary IF(x=0,...) formula not defaulting to TRUE (e.g. blank-handling) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against all four real files.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
(async () => {
  const files = [
    ['/tmp/test_fixed2.xlsm', true, 2],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', false, 0],
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', false, 0],
    ['/mnt/project/Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm', false, 0],
  ];
  for (const [file, expectFound, expectCount] of files) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const result = checkDegenerateCovenantBranch(wb);
    check(`end-to-end: ${file.split('/').pop()} — flaggedCount === ${expectCount}`, result.flaggedCount === expectCount);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
