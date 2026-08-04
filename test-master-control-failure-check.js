const ExcelJS = require('exceljs');
const { checkMasterControlFailure } = require('./src/utils/master-control-failure-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: the model's own named master control
// cells (Summary!O12 "Balance sheet control", etc.) show FAIL, but
// this was not consistently reaching P1 severity or the Investment
// Blocker field, since nothing in the pipeline directly surfaces the
// model's own control cells as a dedicated finding.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Summary');
  ws.getCell('N12').value = 'Balance sheet control';
  for (const col of ['O', 'P', 'Q', 'R', 'S']) {
    ws.getCell(col + '12').value = { formula: 'IF(...)', result: 'FAIL' };
  }

  const result = checkMasterControlFailure(wb);
  check('real defect fixed: a labelled master control showing FAIL across 5 period columns is found and aggregated into one finding',
    result.flaggedCount === 1 && result.findings[0].instanceCount === 5 && result.findings[0].label === 'Balance sheet control');
}

// ══════════════════════════════════════════════════════════════════
// Confirms a label found to the RIGHT of the FAIL value is detected
// too, not just labels to the left — confirmed directly necessary on
// the real file, where this model's own labels sit to the right.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DATA MAP');
  ws.getCell('B10').value = { result: 'FAIL' };
  ws.getCell('C10').value = 'Debt roll-forward control';

  const result = checkMasterControlFailure(wb);
  check('a control label sitting to the RIGHT of the FAIL value is detected (not just labels to the left)',
    result.flaggedCount === 1 && result.findings[0].label === 'Debt roll-forward control');
}

// ══════════════════════════════════════════════════════════════════
// Confirms label variants normalize together — the real file has both
// "Balance sheet control" and "Balance-sheet control" for the same
// underlying defect, and they must collapse to one finding.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet('Summary');
  ws1.getCell('N12').value = 'Balance sheet control';
  ws1.getCell('O12').value = { result: 'FAIL' };
  const ws2 = wb.addWorksheet('DATA MAP');
  ws2.getCell('B10').value = { result: 'FAIL' };
  ws2.getCell('C10').value = 'Balance-sheet control';

  const result = checkMasterControlFailure(wb);
  check('label variants ("Balance sheet control" vs "Balance-sheet control") normalize and merge into one finding',
    result.flaggedCount === 1 && result.findings[0].instanceCount === 2);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a genuine PASS is correctly not flagged, and a "FAIL"-
// containing but not-exactly-"FAIL" value (e.g. "FAILSAFE") is not a
// false match either.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Balance sheet control';
  ws.getCell('B1').value = { result: 'PASS' };
  ws.getCell('A2').value = 'Failsafe control mode';
  ws.getCell('B2').value = { result: 'FAILSAFE' };

  const result = checkMasterControlFailure(wb);
  check('a genuine PASS is correctly not flagged, and a non-exact "FAILSAFE" value is not a false match',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a literal "FAIL" value with NO nearby control/gate/check
// label at all is correctly not flagged — this check is deliberately
// scoped to labelled master controls, not any "FAIL" text anywhere.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Some unrelated label';
  ws.getCell('B1').value = { result: 'FAIL' };

  const result = checkMasterControlFailure(wb);
  check('a "FAIL" value with no nearby control/gate/check label is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against all real reference files.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
(async () => {
  const files = [
    ['/mnt/user-data/uploads/The_Bend_FInancial_Model_3_8_2026.xlsx', 5],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', 0],
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', 0],
    ['/mnt/project/Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm', 0],
    ['/mnt/project/Qantas_1.xlsx', 0],
  ];
  for (const [file, expectCount] of files) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const result = checkMasterControlFailure(wb);
    check(`end-to-end: ${file.split('/').pop()} — flaggedCount === ${expectCount}`, result.flaggedCount === expectCount);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
