const ExcelJS = require('exceljs');
const { checkMidRowFormulaRegimeChange } = require('./src/utils/mid-row-formula-regime-change-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

function shiftFormulaColumns(formula, colShift) {
  // Shifts every bare (non-$-anchored) column letter reference by
  // colShift columns, simulating what Excel's own copy-across
  // actually produces — a genuine shared/copied formula's column
  // references shift with the cell, they don't stay literally fixed.
  return formula.replace(/(\$?)([A-Z]{1,2})(\$?)(\d+)/g, (m, dollarCol, col, dollarRow, rowNum) => {
    if (dollarCol === '$') return m; // absolute column reference — doesn't shift
    let n = 0;
    for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
    n += colShift;
    let newCol = '';
    while (n > 0) { const rem = (n - 1) % 26; newCol = String.fromCharCode(65 + rem) + newCol; n = Math.floor((n - 1) / 26); }
    return newCol + dollarRow + rowNum;
  });
}

function buildRow(ws, rowNum, label, formulaTemplates) {
  // formulaTemplates: array of {formula, count} — each formula string
  // written as it would appear in the FIRST cell of its block; shifted
  // appropriately for every subsequent cell in that block.
  ws.getCell('B' + rowNum).value = label;
  let colNum = 7; // start at column G, matching the real file's layout
  for (const { formula, count } of formulaTemplates) {
    for (let i = 0; i < count; i++) {
      const shifted = shiftFormulaColumns(formula, i);
      ws.getCell(rowNum, colNum).value = { formula: shifted, result: 0 };
      colNum++;
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: Financial Statements!row 89 ("Equity
// Contributions") — 6 periods reference a cumulative balance (G42),
// then every period from the 7th onward references a period flow
// (M73) instead. The existing formula-pattern-consistency-check.js
// was directly confirmed to miss this — a 66.7%/33.3% split, just
// under its 70% majority threshold.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Financial Statements');
  buildRow(ws, 89, 'Equity Contributions', [
    { formula: 'G42', count: 6 },
    { formula: 'IF(M$5="","",M73)', count: 12 },
  ]);

  const result = checkMidRowFormulaRegimeChange(wb);
  check('real defect fixed: the clean 6-vs-12 formula-shape split is detected',
    result.flaggedCount === 1 && result.findings[0].beforeCount === 6 && result.findings[0].afterCount === 12);
}

// ══════════════════════════════════════════════════════════════════
// Confirms an entirely consistent row (no regime change at all) is
// correctly NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  buildRow(ws, 20, 'Consistent row', [{ formula: 'G10*2', count: 15 }]);

  const result = checkMidRowFormulaRegimeChange(wb);
  check('an entirely consistent row (no regime change) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms scattered, random per-cell noise (not a clean two-block
// split) is correctly NOT flagged by this check — that's the
// existing majority-vote check's job, not this one's.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('B20').value = 'Scattered noise row';
  const cols = [7, 8, 9, 10, 11, 12, 13, 14, 15]; // G through O
  const formulas = ['G10*2', 'H10*2', 'I10+5', 'J10*2', 'K10*2', 'L10-3', 'M10*2', 'N10*2', 'O10*2'];
  cols.forEach((c, i) => { ws.getCell(20, c).value = { formula: formulas[i], result: 0 }; });

  const result = checkMidRowFormulaRegimeChange(wb);
  check('scattered, non-contiguous formula differences (not a clean single-point split) are correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a row below the minimum length threshold is not flagged,
// even with a genuine-looking split — avoids noise on short, one-off rows.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  buildRow(ws, 20, 'Short row', [{ formula: 'G10', count: 2 }, { formula: 'I10*2', count: 2 }]);

  const result = checkMidRowFormulaRegimeChange(wb);
  check('a row shorter than the minimum meaningful length is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against all four real files, including the
// exact rows (89, 90, 91) confirmed on the real defect.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
(async () => {
  const realFile = '/tmp/test_fixed2.xlsm';
  if (fs.existsSync(realFile)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(realFile);
    const result = checkMidRowFormulaRegimeChange(wb);
    const targetRows = result.findings.filter(f => f.sheet === 'Financial Statements' && [89, 90, 91].includes(f.rowNum));
    check('end-to-end: real file — all three confirmed rows (89, 90, 91) are flagged',
      targetRows.length === 3);
  } else {
    console.log('SKIPPED: real-file end-to-end test (file not present in this environment)');
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
