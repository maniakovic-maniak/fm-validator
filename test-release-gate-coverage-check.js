const ExcelJS = require('exceljs');
const fs = require('fs');
const { checkReleaseGateCoverage } = require('./src/utils/release-gate-coverage-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: DATA MAP!C173's release-gate formula
// tests only C155:C172 for exceptions, but the same sheet has status
// cells (OK/FAIL/NOT TESTED) at rows well outside that range —
// including one explicitly marked "NOT TESTED".
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DATA MAP');
  for (let r = 155; r <= 172; r++) ws.getCell('C' + r).value = 'OK';
  ws.getCell('C173').value = { formula: 'IF(COUNTIF($C$155:$C$172,"EXCEPTION*")>0,"EXCEPTIONS OUTSTANDING","INVESTOR READY")', result: 'INVESTOR READY' };
  ws.getCell('C464').value = 'NOT TESTED — LEGACY AUDIT MODULE REMOVED';
  ws.getCell('C496').value = 'OK — 0 formula errors';

  const result = checkReleaseGateCoverage(wb);
  check('real defect fixed: a release gate testing C155:C172 correctly flags status cells at C464/C496 as uncovered',
    result.flaggedCount === 1 && result.findings[0].uncoveredCount === 2);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a gate whose tested range GENUINELY covers every status
// cell on the sheet is correctly NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DATA MAP');
  for (let r = 10; r <= 20; r++) ws.getCell('C' + r).value = 'OK';
  ws.getCell('C21').value = { formula: 'IF(COUNTIF($C$10:$C$20,"EXCEPTION*")>0,"EXCEPTIONS","READY")', result: 'READY' };

  const result = checkReleaseGateCoverage(wb);
  check('a gate whose tested range genuinely covers every status cell on the sheet is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a sheet with no gate-shaped formula at all is correctly
// NOT flagged (this check requires a genuine gate pattern present,
// not just any status cells sitting around).
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('C10').value = 'OK';
  ws.getCell('C400').value = 'FAIL';

  const result = checkReleaseGateCoverage(wb);
  check('a sheet with status cells but no gate-shaped formula at all is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against all real reference files.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const files = [
    ['/mnt/user-data/uploads/The_Bend_FInancial_Model_3_8_2026.xlsx', 1, 48],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', 0, null],
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', 0, null],
    ['/mnt/project/Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm', 0, null],
    ['/mnt/project/Qantas_1.xlsx', 0, null],
  ];
  for (const [file, expectCount, expectUncovered] of files) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const result = checkReleaseGateCoverage(wb);
    check(`end-to-end: ${file.split('/').pop()} — flaggedCount === ${expectCount}`, result.flaggedCount === expectCount);
    if (expectUncovered !== null) {
      check(`end-to-end: ${file.split('/').pop()} — uncoveredCount === ${expectUncovered}`, result.findings[0].uncoveredCount === expectUncovered);
    }
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
