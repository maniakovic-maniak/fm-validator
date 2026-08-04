const ExcelJS = require('exceljs');
const fs = require('fs');
const { checkNonexistentSheetReferences } = require('./src/utils/nonexistent-sheet-reference-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: MODEL GUIDE repeatedly contains
// whole-cell text like "PROJECT INPUTS!H36" and "MODEL AUDIT!M271",
// referencing sheets that don't exist in the actual workbook.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('MODEL GUIDE');
  ws.getCell('C6').value = 'PROJECT INPUTS!H36';
  ws.getCell('C7').value = 'PROJECT INPUTS!B8';
  ws.getCell('C9').value = 'MODEL AUDIT!M271';
  ws.getCell('C11').value = 'MODEL AUDIT!B8';

  const result = checkNonexistentSheetReferences(wb);
  check('real defect fixed: whole-cell references to non-existent sheets on the guide sheet are correctly found',
    result.flaggedCount === 2);
  const projectInputs = result.findings.find(f => f.referencedSheet === 'PROJECT INPUTS');
  check('the same non-existent sheet referenced twice aggregates into one finding with instanceCount 2',
    projectInputs && projectInputs.instanceCount === 2);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a reference to a sheet that GENUINELY exists is correctly
// NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('DEBT');
  const ws = wb.addWorksheet('MODEL GUIDE');
  ws.getCell('C6').value = 'DEBT!F96';
  ws.getCell('C7').value = 'DEBT!F98';

  const result = checkNonexistentSheetReferences(wb);
  check('a reference to a sheet that genuinely exists is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms the substring-match false positive is fixed — ordinary
// prose containing a "!cell"-looking fragment mid-sentence must not
// be captured as if it were a standalone sheet reference. Found via
// direct testing: an earlier design matched "and INVESTOR REPORT" out
// of a longer sentence, capturing preceding prose words as part of
// the "sheet name".
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('MODEL GUIDE');
  ws.getCell('C6').value = 'Explicit Actual / Forecast classification is shown at Underwriting!L4:EN4.';
  ws.getCell('C7').value = 'Explicit Actual / Forecast classification is shown at Underwriting!L5:EN5.';

  const result = checkNonexistentSheetReferences(wb);
  check('ordinary prose containing a "!cell"-looking fragment mid-sentence is correctly NOT captured as a standalone sheet reference',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms the any-sheet-scope false positive is fixed — a whole-cell
// reference on an ordinary DATA/INPUT sheet (very likely a legitimate
// source-file-tracking annotation, not a claim that sheet should
// exist in this workbook) must not be flagged, only guide/navigational
// sheets.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('URWLD COMPANY INPUTS');
  ws.getCell('N37').value = 'MODEL DESIGN!D4';
  ws.getCell('N38').value = 'MODEL DESIGN!D5';

  const result = checkNonexistentSheetReferences(wb);
  check('a whole-cell reference on an ordinary data/input sheet (likely a legitimate source-tracking annotation) is correctly NOT flagged — only guide/navigational sheets are scanned',
    result.flaggedCount === 0);
}

// A single, isolated occurrence (not repeated) is correctly not
// flagged — the check requires at least 2 occurrences, since a single
// stray match is more likely incidental than a genuine, repeated
// belief that the sheet exists.
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('MODEL GUIDE');
  ws.getCell('C6').value = 'SOME RANDOM TEXT!A1';

  const result = checkNonexistentSheetReferences(wb);
  check('a single, isolated occurrence (not repeated) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against every discovered reference file —
// dynamically found via fixtures-helper.js, not a fixed list.
// ══════════════════════════════════════════════════════════════════
const { getFixtureFiles, getKnownExpectation } = require('./fixtures-helper.js');
const KNOWN_EXPECTATIONS = {
  'f6faab1ac4cee3fe56abb4a8a05c7c41463c72d5dc7203f2ba30732064c7e122': 2, // The_Bend_FInancial_Model_3_8_2026.xlsx
  '8493d1e338d6978b6be482588aba151550eec9a7efb3f6ee93418f0f3e96c6af': 0, // CarlsbergFinancialModel_1.xlsm
  '60b4f4f44a599b0120c7494d6d537a371e9b142ced0faef72d5620c2793233f5': 0, // Financial_Model_The_Bend_13_7_2026_Audited.xlsx
  'ae49e8710986a491e6b11f1c12bb7ac3a6279e9fc97b84895f8a9e75d54bbd09': 0, // Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm
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
    const result = checkNonexistentSheetReferences(wb);
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
