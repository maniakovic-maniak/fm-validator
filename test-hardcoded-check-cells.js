const ExcelJS = require('exceljs');
const fs = require('fs');
const { checkHardcodedCheckCells } = require('./src/utils/hardcoded-check-cells.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real bug this fixes: found via an independent review confirming
// several hardcoded QA-status cells weren't caught (DATA MAP!C490,
// C496, C497 — literal strings like "OK — 0 formula/name links" in
// rows labelled "External workbook formula links"). Traced the value
// regex requiring an exact bare match and the label-detection logic
// only ever checking the leftmost cell (an ID code here, not the
// genuine label). While fixing that, found a MORE SIGNIFICANT
// pre-existing bug: the result-scanning loop's own comment said "the
// FIRST non-empty candidate result cell" but never actually stopped
// after finding one — pushing a separate finding for every qualifying
// cell in a row, causing serious over-matching on multi-column
// metadata/control-register rows.
// ══════════════════════════════════════════════════════════════════

// The core over-matching fix: a "check"-labeled row with SEVERAL
// non-formula metadata cells to its right (Formula/Source/Method-
// style columns, not a single result) must produce exactly ONE
// finding — the first qualifying cell — not one per metadata column.
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DATA MAP');
  ws.getCell('B10').value = 'Live model control';
  ws.getCell('C10').value = 'Formula';
  ws.getCell('D10').value = 'Inputs';
  ws.getCell('E10').value = "'PROJECT INPUTS'!E195:H195";
  ws.getCell('F10').value = 'No';

  const result = checkHardcodedCheckCells(wb);
  check('the core fix: a multi-column metadata row produces exactly ONE finding (the first cell), not one per column',
    result.flaggedCount === 1 && result.findings[0].cell === 'C10');
}

// ══════════════════════════════════════════════════════════════════
// The real target cells: found via an independent review, confirmed
// directly against the real file.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DATA MAP');
  ws.getCell('B490').value = 'External workbook formula links';
  ws.getCell('C490').value = 'OK — 0 formula/name links';

  const result = checkHardcodedCheckCells(wb);
  check('real defect fixed: "External workbook formula links" / "OK — 0 formula/name links" is now caught (broadened value + label matching)',
    result.flaggedCount === 1 && result.findings[0].cell === 'C490' && result.findings[0].confidence === 'high');
}

// A genuine, live formula-driven check (recalculates) must still NOT
// be flagged — the entire point of this check is the ABSENCE of a
// formula, not what value the cell currently shows.
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('B10').value = 'Balance sheet check';
  ws.getCell('C10').value = { formula: 'IF(A1=B1,"OK","ERROR")', result: 'OK' };

  const result = checkHardcodedCheckCells(wb);
  check('a genuine, live formula-driven check (recalculates) is correctly NOT flagged, regardless of its current displayed value',
    result.flaggedCount === 0);
}

// A long, descriptive prose row that merely mentions "check" in
// passing must not be treated as a genuine check-row label.
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('B10').value = 'Please check the README for full details on how this workbook is structured and maintained';
  ws.getCell('C10').value = 'See notes';

  const result = checkHardcodedCheckCells(wb);
  check('long descriptive prose mentioning "check" in passing (not a genuine check-row label) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against every discovered reference file —
// dynamically found via fixtures-helper.js, not a fixed list. The
// fix must reduce or hold steady the count everywhere, never increase
// it due to the multi-column over-matching this fix specifically
// closes. Confirmed directly: Bend 13-7 Audited went from 29 (pre-fix)
// to 16 (post-fix); Hidden Gem from 18 to 17.
// ══════════════════════════════════════════════════════════════════
const { getFixtureFiles, getKnownExpectation } = require('./fixtures-helper.js');
const KNOWN_EXPECTATIONS = {
  'f6faab1ac4cee3fe56abb4a8a05c7c41463c72d5dc7203f2ba30732064c7e122': 42, // The_Bend_FInancial_Model_3_8_2026.xlsx
  '8493d1e338d6978b6be482588aba151550eec9a7efb3f6ee93418f0f3e96c6af': 0, // CarlsbergFinancialModel_1.xlsm
  '60b4f4f44a599b0120c7494d6d537a371e9b142ced0faef72d5620c2793233f5': 16, // Financial_Model_The_Bend_13_7_2026_Audited.xlsx
  'ae49e8710986a491e6b11f1c12bb7ac3a6279e9fc97b84895f8a9e75d54bbd09': 17, // Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm
  '25b1897007a1bee37d3927fd0ac24398b5d7857933a291649e9cbd89916bafe5': 0, // Qantas_1.xlsx
};
(async () => {
  const fixtures = getFixtureFiles();
  if (fixtures.length === 0) {
    console.log('SKIPPED: no reference files found (checked test-fixtures/ and the sandbox fallback)');
  }
  for (const { path: filePath, filename, hash } of fixtures) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const result = checkHardcodedCheckCells(wb);
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
