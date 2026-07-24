const { checkCrossCasting } = require('./src/utils/cross-cast-check.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ── Test 1: the exact worked example from "Spreadsheet Modelling
  // Best Practice" (ICAEW-published, 1999) — a missing "Other revenue"
  // line in the totals row breaks the cross-cast, exactly as the book
  // itself describes. ──
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('Sheet1');
  ws1.getCell('A1').value = 'Category';
  ws1.getCell('B1').value = 'Jan'; ws1.getCell('C1').value = 'Feb'; ws1.getCell('D1').value = 'Mar';
  ws1.getCell('E1').value = 'Apr'; ws1.getCell('F1').value = 'May'; ws1.getCell('G1').value = 'Total';
  ws1.getCell('A2').value = 'Sales revenue';
  ws1.getCell('B2').value = 100; ws1.getCell('C2').value = 120; ws1.getCell('D2').value = 110;
  ws1.getCell('E2').value = 120; ws1.getCell('F2').value = 130; ws1.getCell('G2').value = 580;
  ws1.getCell('A3').value = 'Commission revenue';
  ws1.getCell('B3').value = 20; ws1.getCell('C3').value = 25; ws1.getCell('D3').value = 25;
  ws1.getCell('E3').value = 20; ws1.getCell('F3').value = 15; ws1.getCell('G3').value = 105;
  ws1.getCell('A4').value = 'Other revenue';
  ws1.getCell('B4').value = 0; ws1.getCell('C4').value = 0; ws1.getCell('D4').value = 5;
  ws1.getCell('E4').value = 0; ws1.getCell('F4').value = 0; ws1.getCell('G4').value = 5;
  ws1.getCell('A5').value = 'Total'; // the totals row's own SUM range misses row 4, matching the book's example
  ws1.getCell('B5').value = 120; ws1.getCell('C5').value = 145; ws1.getCell('D5').value = 135;
  ws1.getCell('E5').value = 140; ws1.getCell('F5').value = 145; ws1.getCell('G5').value = 685;
  const r1 = checkCrossCasting(wb1);
  check('the exact book worked example (missing "Other revenue" line) is caught with the correct £5 discrepancy',
    r1.flaggedCount === 1 && Math.abs(r1.findings[0].diff - 5) < 0.01);

  // ── Test 2: a correctly balanced grid — must NOT be flagged ──
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Sheet1');
  ws2.getCell('A1').value = 'Category'; ws2.getCell('B1').value = 'Jan'; ws2.getCell('C1').value = 'Feb'; ws2.getCell('D1').value = 'Total';
  ws2.getCell('A2').value = 'Sales'; ws2.getCell('B2').value = 100; ws2.getCell('C2').value = 120; ws2.getCell('D2').value = 220;
  ws2.getCell('A3').value = 'Costs'; ws2.getCell('B3').value = 50; ws2.getCell('C3').value = 60; ws2.getCell('D3').value = 110;
  ws2.getCell('A4').value = 'Total'; ws2.getCell('B4').value = 150; ws2.getCell('C4').value = 180; ws2.getCell('D4').value = 330;
  const r2 = checkCrossCasting(wb2);
  check('a correctly balanced grid is NOT flagged', r2.flaggedCount === 0);

  // ── Test 3 & 4: multi-letter columns (beyond Z) — confirms the real
  // numToCol bug found and fixed during development (a naive
  // String.fromCharCode conversion only worked for single-letter
  // columns; a financial model with many years of monthly columns
  // commonly extends well past column Z). ──
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('Sheet1');
  ws3.getCell('A1').value = 'Category';
  for (let c = 27; c <= 32; c++) ws3.getRow(1).getCell(c).value = 'M' + (c - 26);
  ws3.getRow(1).getCell(33).value = 'Total';
  ws3.getCell('A2').value = 'Line 1';
  let s1 = 0;
  for (let c = 27; c <= 32; c++) { const v = (c - 26) * 10; ws3.getRow(2).getCell(c).value = v; s1 += v; }
  ws3.getRow(2).getCell(33).value = s1;
  ws3.getCell('A3').value = 'Line 2';
  let s2 = 0;
  for (let c = 27; c <= 32; c++) { const v = (c - 26) * 5; ws3.getRow(3).getCell(c).value = v; s2 += v; }
  ws3.getRow(3).getCell(33).value = s2;
  ws3.getCell('A4').value = 'Total';
  for (let c = 27; c <= 32; c++) ws3.getRow(4).getCell(c).value = ws3.getRow(2).getCell(c).value + ws3.getRow(3).getCell(c).value;
  ws3.getRow(4).getCell(33).value = s1 + s2;
  const r3 = checkCrossCasting(wb3);
  check('a correctly balanced grid using multi-letter columns (AA-AG) is NOT flagged', r3.flaggedCount === 0);

  ws3.getRow(4).getCell(32).value += 999; // corrupt one column total in the Total row
  const r4 = checkCrossCasting(wb3);
  check('a deliberately broken multi-letter-column grid IS flagged, with the correct AG cell reference (confirms the numToCol fix)',
    r4.flaggedCount === 1 && r4.findings[0].cell === 'AG4' && Math.abs(r4.findings[0].diff - 999) < 0.01);

  // ── Test 5: a single-line-item "total" (only 1 data point) must NOT
  // be flagged — the check deliberately requires at least 2 data
  // points on each side to avoid trivial/meaningless comparisons. ──
  const wb5 = new ExcelJS.Workbook();
  const ws5 = wb5.addWorksheet('Sheet1');
  ws5.getCell('A1').value = 'Category'; ws5.getCell('B1').value = 'Jan'; ws5.getCell('C1').value = 'Total';
  ws5.getCell('A2').value = 'Only line'; ws5.getCell('B2').value = 100; ws5.getCell('C2').value = 100;
  ws5.getCell('A3').value = 'Total'; ws5.getCell('B3').value = 999; ws5.getCell('C3').value = 999; // deliberately "wrong" but only 1 data point either side
  const r5 = checkCrossCasting(wb5);
  check('a single-line-item total (fewer than 2 data points) is correctly not flagged, even if the numbers look inconsistent',
    r5.flaggedCount === 0);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
