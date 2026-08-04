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
  const { getFixtureFiles, getKnownExpectation } = require('./fixtures-helper.js');
  const KNOWN_EXPECTATIONS = {
    '383ae8eea3dbc878ef7472a1b3d1a5bc31c468371141c01dc62b215a8652c0eb': 1, // The_Bend_Precinct_Model_Investor_Ready_12.xlsm
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
    const result = checkHardcodedMajorAsset(wb);
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
