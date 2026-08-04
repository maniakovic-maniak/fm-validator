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
// End-to-end confirmation against every discovered reference file —
// dynamically found via fixtures-helper.js, not a fixed list.
// ══════════════════════════════════════════════════════════════════
const { getFixtureFiles, getKnownExpectation } = require('./fixtures-helper.js');
const KNOWN_EXPECTATIONS = {
  'The_Bend_FInancial_Model_3_8_2026.xlsx': { count: 1, uncovered: 48 },
  'CarlsbergFinancialModel_1.xlsm': { count: 0, uncovered: null },
  'Financial_Model_The_Bend_13_7_2026_Audited.xlsx': { count: 0, uncovered: null },
  'Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm': { count: 0, uncovered: null },
  'Qantas_1.xlsx': { count: 0, uncovered: null },
};
(async () => {
  const fixtures = getFixtureFiles();
  if (fixtures.length === 0) {
    console.log('SKIPPED: no reference files found (checked test-fixtures/ and the sandbox fallback)');
  }
  for (const { path: filePath, filename } of fixtures) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const result = checkReleaseGateCoverage(wb);
    const known = getKnownExpectation(KNOWN_EXPECTATIONS, filename);
    if (known !== undefined) {
      check(`end-to-end: ${filename} — flaggedCount === ${known.count}`, result.flaggedCount === known.count);
      if (known.uncovered !== null) {
        check(`end-to-end: ${filename} — uncoveredCount === ${known.uncovered}`, result.findings[0].uncoveredCount === known.uncovered);
      }
    } else {
      check(`end-to-end: ${filename} — ran without crashing (no known expected count yet; actual flaggedCount: ${result.flaggedCount} — review and add to KNOWN_EXPECTATIONS once verified)`, true);
    }
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
