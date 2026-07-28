const { detectNamedRangeIssues } = require('./src/utils/named-range-audit.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// A lightweight mock workbook matching just the interface
// detectNamedRangeIssues actually uses — avoids needing ExcelJS to
// genuinely reproduce its own defined-name mis-parsing behavior,
// while testing the exact confirmed malformed shape precisely.
function makeMockWorkbook({ definedNames = [], sheetNames = ['Data', 'Underwriting'], cellsWithFormulas = [] } = {}) {
  return {
    definedNames: { model: definedNames },
    getWorksheet(name) { return sheetNames.includes(name) ? { name } : undefined; },
    eachSheet(cb) {
      sheetNames.forEach(name => {
        cb({
          name,
          eachRow(opts, rowCb) {
            (cellsWithFormulas[name] || []).forEach((formula, i) => {
              rowCb({ eachCell(opts2, cellCb) { cellCb({ formula }); } }, i + 1);
            });
          },
        });
      });
    },
  };
}

// ══════════════════════════════════════════════════════════════════
// The real, confirmed bug: an OFFSET/COUNTA-based dynamic named range
// — a common, valid pattern for auto-sizing a range to a variable-
// length list — gets mis-parsed by ExcelJS into malformed fragments
// like "'OFFSET(Data'!$B$25", where the function name is folded into
// what looks like a quoted sheet name. Confirmed directly on a real
// file: 8 genuinely valid defined names (Range_Debt, Range_Equity,
// Range_NOI, etc.) were all incorrectly flagged "Broken" this way.
// ══════════════════════════════════════════════════════════════════
{
  const wb = makeMockWorkbook({
    definedNames: [
      { name: 'Range_Debt', ranges: ["'OFFSET(Underwriting'!$L$75"] },
      { name: 'Range_Building_Type', ranges: ["'OFFSET(Data'!$B$25", "'COUNTA(Data'!$B$25:$B$46"] },
    ],
  });
  const result = detectNamedRangeIssues(wb);
  check('real bug fixed: an OFFSET-based dynamic named range is NOT flagged as broken',
    !result.broken.some(b => b.name === 'Range_Debt'));
  check('real bug fixed: a COUNTA-based dynamic named range is NOT flagged as broken',
    !result.broken.some(b => b.name === 'Range_Building_Type'));
}

// ══════════════════════════════════════════════════════════════════
// Regression check: a GENUINELY broken name — pointing at a sheet
// that truly doesn't exist, with a normal (non-function-call) shape —
// must still be caught. The fix must not silence real detections.
// ══════════════════════════════════════════════════════════════════
{
  const wb = makeMockWorkbook({
    definedNames: [
      { name: 'Old_Deleted_Sheet_Range', ranges: ["'Deleted Sheet'!$A$1:$A$10"] },
    ],
  });
  const result = detectNamedRangeIssues(wb);
  check('regression check: a genuinely broken name (points at a real, non-existent sheet) is still correctly flagged',
    result.broken.some(b => b.name === 'Old_Deleted_Sheet_Range'));
}

// ══════════════════════════════════════════════════════════════════
// Regression check: a normal, valid named range (pointing at a sheet
// that genuinely exists) must not be flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = makeMockWorkbook({
    definedNames: [
      { name: 'Normal_Valid_Range', ranges: ["Data!$A$1:$A$10"] },
    ],
  });
  const result = detectNamedRangeIssues(wb);
  check('regression check: a normal, valid named range pointing at a real sheet is not flagged as broken',
    !result.broken.some(b => b.name === 'Normal_Valid_Range'));
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against the real file that motivated this fix.
// ══════════════════════════════════════════════════════════════════
const fsSync = require('fs');
const ExcelJS = require('exceljs');

(async () => {
  const realFile = '/mnt/user-data/uploads/The_Bend_Precinct_Model_26_7_2026_Investor_Ready_v6.xlsm';
  if (fsSync.existsSync(realFile)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(realFile);
    const result = detectNamedRangeIssues(wb);
    check('end-to-end: the real file\'s 8 previously-false-positive OFFSET/COUNTA-based names are no longer flagged broken',
      result.broken.length === 0);
  } else {
    console.log('SKIPPED: end-to-end real-file test (file not present in this environment)');
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
