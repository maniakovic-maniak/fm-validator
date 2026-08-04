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
  const { getFixtureFiles, getKnownExpectation } = require('./fixtures-helper.js');
  const KNOWN_EXPECTATIONS = {
    '383ae8eea3dbc878ef7472a1b3d1a5bc31c468371141c01dc62b215a8652c0eb': 2, // The_Bend_Precinct_Model_Investor_Ready_12.xlsm
    '8493d1e338d6978b6be482588aba151550eec9a7efb3f6ee93418f0f3e96c6af': 0, // CarlsbergFinancialModel_1.xlsm
    '60b4f4f44a599b0120c7494d6d537a371e9b142ced0faef72d5620c2793233f5': 0, // Financial_Model_The_Bend_13_7_2026_Audited.xlsx
    'ae49e8710986a491e6b11f1c12bb7ac3a6279e9fc97b84895f8a9e75d54bbd09': 0, // Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm
  };
  const fixtures = getFixtureFiles();
  if (fixtures.length === 0) {
    console.log('SKIPPED: no reference files found (checked test-fixtures/ and the sandbox fallback)');
  }
  for (const { path: filePath, filename, hash } of fixtures) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const result = checkExceptionStatusRows(wb);
    const expected = getKnownExpectation(KNOWN_EXPECTATIONS, hash);
    if (expected !== undefined) {
      check(`end-to-end: ${filename} — flaggedCount === ${expected}`, result.flaggedCount === expected);
    } else {
      check(`end-to-end: ${filename} — ran without crashing (no known expected count yet; actual flaggedCount: ${result.flaggedCount} — review and add to KNOWN_EXPECTATIONS once verified)`, true);
    }
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
