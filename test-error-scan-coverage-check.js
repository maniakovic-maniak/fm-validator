const ExcelJS = require('exceljs');
const fs = require('fs');
const { checkErrorScanCoverage } = require('./src/utils/error-scan-coverage-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: confirmed directly against a real model
// that DATA MAP!C170's "No Excel errors in target workbook" control
// covers 12 of 14 sheets, with 3 of those 12 ranges narrower than the
// sheet's genuine used range, and 2 entire sheets (including DATA MAP
// itself, where the control lives) missing from the scan entirely.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Summary');
  s1.getCell('A1').value = 1;
  s1.getCell('B5').value = { formula: 'A1+1' };
  const s2 = wb.addWorksheet('Underwriting');
  s2.getCell('A1').value = 1;
  s2.getCell('C10').value = { formula: 'A1+1' }; // genuine content extends to row 10, col C
  const s3 = wb.addWorksheet('Debt');
  s3.getCell('A1').value = 1;
  s3.getCell('B3').value = { formula: 'A1+1' };
  const s4 = wb.addWorksheet('DATA MAP'); // will hold the control itself, and is NOT referenced by it — should be flagged
  s4.getCell('A1').value = { formula: "IF(SUMPRODUCT(--ISERROR(Summary!$A$1:$S$86))+SUMPRODUCT(--ISERROR(Underwriting!$A$1:$B$5))+SUMPRODUCT(--ISERROR(Debt!$A$1:$B$3))=0,\"OK\",\"EXCEPTION\")" };

  const result = checkErrorScanCoverage(wb);
  check('real-pattern defect fixed: a control whose covered range (Underwriting B5) is narrower than the actual used range (extends to C10) is flagged',
    result.flaggedCount === 1 && result.findings[0].insufficientRanges.some(r => r.sheet === 'Underwriting'));
  check('a sheet with genuine formula content (DATA MAP) that is entirely missing from the scan is flagged',
    result.findings[0].missingSheets.includes('DATA MAP'));
  check('a sheet whose covered range genuinely matches its actual used range (Debt) is correctly NOT flagged as insufficient',
    !result.findings[0].insufficientRanges.some(r => r.sheet === 'Debt'));
}

// ══════════════════════════════════════════════════════════════════
// Confirms a genuinely complete scan (every sheet covered, every
// range sufficient) is correctly NOT flagged at all.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Summary');
  s1.getCell('A1').value = 1;
  s1.getCell('B2').value = { formula: 'A1+1' };
  const s2 = wb.addWorksheet('Debt');
  s2.getCell('A1').value = 1;
  s2.getCell('B2').value = { formula: 'A1+1' };
  const s3 = wb.addWorksheet('Data');
  s3.getCell('A1').value = 1;
  s3.getCell('B2').value = { formula: 'A1+1' };
  s3.getCell('C1').value = { formula: "IF(SUMPRODUCT(--ISERROR(Summary!$A$1:$B$10))+SUMPRODUCT(--ISERROR(Debt!$A$1:$B$10))+SUMPRODUCT(--ISERROR(Data!$A$1:$D$10))=0,\"OK\",\"EXCEPTION\")" };

  const result = checkErrorScanCoverage(wb);
  check('a genuinely complete whole-workbook error scan (every sheet covered, every range sufficient) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a sheet with zero formula content missing from the scan is
// correctly NOT flagged — it cannot possibly produce a formula-level
// error, so its absence genuinely doesn't matter.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Summary');
  s1.getCell('A1').value = 1;
  s1.getCell('B2').value = { formula: 'A1+1' };
  const s2 = wb.addWorksheet('Debt');
  s2.getCell('A1').value = 1;
  s2.getCell('B2').value = { formula: 'A1+1' };
  const s3 = wb.addWorksheet('Data');
  s3.getCell('A1').value = 1;
  s3.getCell('B2').value = { formula: 'A1+1' };
  wb.addWorksheet('Legend').getCell('A1').value = 'Text only, no formulas at all';
  s3.getCell('C1').value = { formula: "IF(SUMPRODUCT(--ISERROR(Summary!$A$1:$B$10))+SUMPRODUCT(--ISERROR(Debt!$A$1:$B$10))+SUMPRODUCT(--ISERROR(Data!$A$1:$D$10))=0,\"OK\",\"EXCEPTION\")" };

  const result = checkErrorScanCoverage(wb);
  check('a sheet with zero formula content (a pure text/Legend sheet) missing from the scan is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms an ordinary, narrowly-scoped ISERROR formula (checking
// only 1-2 sheets) is NOT mistaken for a whole-workbook scan pattern.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet('Summary');
  s1.getCell('A1').value = 1;
  s1.getCell('B2').value = { formula: "IF(ISERROR(Debt!$A$1),\"ERR\",\"OK\")" };
  wb.addWorksheet('Debt').getCell('A1').value = 1;

  const result = checkErrorScanCoverage(wb);
  check('an ordinary, narrowly-scoped ISERROR formula (checking only 1 other sheet) is correctly NOT treated as a whole-workbook scan pattern',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against real reference files.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const files = [
    ['/mnt/user-data/uploads/The_Bend_FInancial_Model_3_8_2026.xlsx', 1],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', 0],
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', 0],
    ['/mnt/project/Qantas_1.xlsx', 0],
    ['/mnt/project/The_Bend_Precinct_Model_Investor_Ready_12.xlsm', 1],
  ];
  for (const [file, expectCount] of files) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const result = checkErrorScanCoverage(wb);
    check(`end-to-end: ${file.split('/').pop()} — flaggedCount === ${expectCount}`, result.flaggedCount === expectCount);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
