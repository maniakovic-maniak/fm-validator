const ExcelJS = require('exceljs');
const { checkDisplayRoundsToZero } = require('./src/utils/display-rounds-to-zero-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // RISK CASES
  const a1 = ws.getCell('A1'); a1.value = 0.003; a1.numFmt = '0%'; // displays "0%"
  const a2 = ws.getCell('A2'); a2.value = -0.002; a2.numFmt = '#,##0%'; // displays "0%" (negative, small)
  const a3 = ws.getCell('A3'); a3.value = { formula: 'B3/C3', result: 0.001 }; a3.numFmt = '0%'; // formula-derived

  // CLEAN CASES
  const b1 = ws.getCell('B1'); b1.value = 0; b1.numFmt = '0%'; // genuine zero, correctly displays as 0%
  const b2 = ws.getCell('B2'); b2.value = 0.15; b2.numFmt = '0%'; // 15%, displays correctly, not near zero
  const b3 = ws.getCell('B3'); b3.value = 0.003; b3.numFmt = '0.0%'; // HAS a decimal place, displays "0.3%" correctly
  const b4 = ws.getCell('B4'); b4.value = 0.003; b4.numFmt = 'General'; // not a percent format at all
  const b5 = ws.getCell('B5'); b5.value = 0.006; b5.numFmt = '0%'; // 0.6%, rounds to "1%", not misleading

  const result = checkDisplayRoundsToZero(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '=', f.actualValue, f.numFmt));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['A1', 'A2', 'A3'].sort();
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);
  if (!pass) process.exit(1);
  console.log('ALL TESTS PASSED');
}
main().catch(e => { console.error(e); process.exit(1); });
