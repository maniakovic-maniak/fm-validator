const ExcelJS = require('exceljs');
const { checkTotalRanges } = require('./src/utils/total-range-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this check catches: a SUM() range that excludes a
// row of real data inserted after the range was set. Basic single-
// instance case, confirming the check itself still works correctly.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('B2').value = 10;
  ws.getCell('B3').value = 20;
  ws.getCell('B4').value = 30; // inserted after the SUM range below was set — excluded
  ws.getCell('B5').value = { formula: 'SUM(B2:B3)', result: 30 };

  const result = checkTotalRanges(wb);
  check('basic case: a SUM range excluding a real adjacent row is still detected',
    result.flaggedCount === 1 && result.findings[0].excludedCount === 1);
}

// ══════════════════════════════════════════════════════════════════
// R-16 aggregation fix: found via an independent review's claim that
// a large share of P2 findings are duplicates. Confirmed directly on
// a real file: 44 instances of this exact check collapsed to 2
// genuine findings — all 44 were the same row (PROJECTS!row11),
// repeated across every period-column via shared-formula mechanics.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  // Same defect shape (excludes one adjacent row) repeated across 6
  // period-columns (B through G) on the same two rows — genuinely one
  // underlying defect, not six.
  for (const col of ['B', 'C', 'D', 'E', 'F', 'G']) {
    ws.getCell(col + '2').value = 10;
    ws.getCell(col + '3').value = 20;
    ws.getCell(col + '4').value = 30; // excluded from every column's SUM range below
    ws.getCell(col + '5').value = { formula: `SUM(${col}2:${col}3)`, result: 30 };
  }

  const result = checkTotalRanges(wb);
  check('R-16 aggregation: 6 period-column instances of the same row-level defect merge into one finding',
    result.flaggedCount === 1 && result.findings[0].instanceCount === 6);
  check('R-16 aggregation: totalInstances correctly reports the full underlying count',
    result.totalInstances === 6);
}

// ══════════════════════════════════════════════════════════════════
// Confirms genuinely different rows with the same defect shape are
// NOT incorrectly merged together — only period-column repetition of
// the SAME row should aggregate.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('B2').value = 10; ws.getCell('B3').value = 20; ws.getCell('B4').value = 30;
  ws.getCell('B5').value = { formula: 'SUM(B2:B3)', result: 30 };
  ws.getCell('B12').value = 40; ws.getCell('B13').value = 50; ws.getCell('B14').value = 60;
  ws.getCell('B15').value = { formula: 'SUM(B12:B13)', result: 90 };

  const result = checkTotalRanges(wb);
  check('two genuinely different rows with the same defect shape remain separate findings',
    result.flaggedCount === 2);
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
