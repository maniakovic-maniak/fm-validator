const ExcelJS = require('exceljs');
const { checkBalanceSheetPlug } = require('./src/utils/balance-sheet-plug-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BS');

  // RISK CASE: labelled as a balancing figure, residual formula shape.
  ws.getCell('A10').value = 'Balancing Figure';
  ws.getCell('B10').value = { formula: 'C10-SUM(D10:F10)', result: 0 };

  // RISK CASE: "plug" label, different residual shape.
  ws.getCell('A20').value = 'Other/Balancing';
  ws.getCell('B20').value = { formula: 'SUM(C20:E20)-D20', result: 0 };

  // CLEAN CASE: same residual formula shape, but NOT plug-labelled.
  ws.getCell('A30').value = 'Net Working Capital';
  ws.getCell('B30').value = { formula: 'C30-SUM(D30:F30)', result: 500 }; // legitimate calc, just happens to subtract a sum

  // CLEAN CASE: plug-labelled, but NOT a residual formula shape.
  ws.getCell('A40').value = 'Balancing Figure';
  ws.getCell('B40').value = { formula: 'C40*1.05', result: 100 }; // not a residual pattern at all

  const result = checkBalanceSheetPlug(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '-', f.labelText));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['B10', 'B20'].sort();
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);
  if (!pass) process.exit(1);
  console.log('ALL TESTS PASSED');
}
main().catch(e => { console.error(e); process.exit(1); });
