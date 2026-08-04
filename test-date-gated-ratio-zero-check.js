const ExcelJS = require('exceljs');
const { checkDateGatedRatioZero } = require('./src/utils/date-gated-ratio-zero-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: DEBT!F131 (DSCR), F132 (interest-cover
// ratio), F133 (debt yield) all structurally forced to 0 before a
// named milestone date, via a formula shape found through testing
// against the real, nested formula (a SUM(...) call inside the OR()
// clause broke a naive single-regex approach).
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DEBT');
  ws.getCell('A131').value = 'DSCR';
  for (const col of ['F', 'G', 'H']) {
    ws.getCell(col + '131').value = {
      formula: `IF(OR(${col}$64<$B$35,SUM(${col}$123:${col}$124)=0),0,SUM(${col}$144)/SUM(${col}$123:${col}$124))`,
      result: 0,
    };
  }

  const result = checkDateGatedRatioZero(wb);
  check('real defect fixed: a DSCR row structurally date-gated to zero (with a nested SUM() inside the OR clause) is detected and aggregated',
    result.flaggedCount === 1 && result.findings[0].instanceCount === 3 && result.findings[0].label === 'DSCR');
}

// ══════════════════════════════════════════════════════════════════
// Confirms benign, common date-gating (hiding a future/past period on
// an ordinary, non-ratio row) is correctly NOT flagged — this check
// is deliberately scoped to labelled covenant/ratio rows only.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A10').value = 'Revenue';
  ws.getCell('F10').value = { formula: 'IF(OR(F$5<$B$1),0,F20*F21)', result: 0 };

  const result = checkDateGatedRatioZero(wb);
  check('benign date-gating on an ordinary, non-ratio row is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a genuinely-computed ratio (no date gate at all) on a
// covenant-labelled row is correctly NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DEBT');
  ws.getCell('A50').value = 'DSCR';
  ws.getCell('F50').value = { formula: 'F60/F61', result: 1.5 };

  const result = checkDateGatedRatioZero(wb);
  check('a genuinely-computed DSCR with no date gate at all is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against all four real files.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
(async () => {
  const { getFixtureFiles, getKnownExpectation } = require('./fixtures-helper.js');
  const KNOWN_EXPECTATIONS = {
    'The_Bend_Precinct_Model_Investor_Ready_12.xlsm': 3,
    'CarlsbergFinancialModel_1.xlsm': 0,
    'Financial_Model_The_Bend_13_7_2026_Audited.xlsx': 0,
    'Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm': 0,
  };
  const fixtures = getFixtureFiles();
  if (fixtures.length === 0) {
    console.log('SKIPPED: no reference files found (checked test-fixtures/ and the sandbox fallback)');
  }
  for (const { path: filePath, filename } of fixtures) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const result = checkDateGatedRatioZero(wb);
    const expected = getKnownExpectation(KNOWN_EXPECTATIONS, filename);
    if (expected !== undefined) {
      check(`end-to-end: ${filename} — flaggedCount === ${expected}`, result.flaggedCount === expected);
    } else {
      check(`end-to-end: ${filename} — ran without crashing (no known expected count yet; actual flaggedCount: ${result.flaggedCount} — review and add to KNOWN_EXPECTATIONS once verified)`, true);
    }
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
