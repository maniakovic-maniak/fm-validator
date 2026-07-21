const ExcelJS = require('exceljs');
const { checkBlankCellBoundary } = require('./src/utils/blank-cell-boundary-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Debt');

  // RISK CASE: opening balance references a genuinely blank cell.
  ws.getCell('A10').value = 'Opening Balance';
  ws.getCell('C10').value = { formula: 'B10', result: 0 }; // B10 is genuinely blank -- never set

  // CLEAN CASE: opening balance references an explicit zero.
  ws.getCell('A20').value = 'Opening Balance';
  ws.getCell('B20').value = 0; // explicit zero
  ws.getCell('C20').value = { formula: 'B20', result: 0 };

  // CLEAN CASE: opening balance is a real calculation, not a bare link.
  ws.getCell('A30').value = 'Opening Balance';
  ws.getCell('C30').value = { formula: 'MAX(B30,0)', result: 0 };

  // CLEAN CASE: unrelated label.
  ws.getCell('A40').value = 'Revenue';
  ws.getCell('C40').value = { formula: 'B40', result: 100 }; // B40 also blank, but wrong label -- must not match

  const result = checkBlankCellBoundary(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '->', f.referencedCell));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['C10'];
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);
  if (!pass) process.exit(1);
  console.log('ALL TESTS PASSED');
}
main().catch(e => { console.error(e); process.exit(1); });
