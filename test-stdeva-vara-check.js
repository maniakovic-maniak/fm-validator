const ExcelJS = require('exceljs');
const { checkStdevaVaraUsage } = require('./src/utils/stdeva-vara-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  ws.getCell('A1').value = { formula: 'STDEVA(B1:B10)', result: 5 };
  ws.getCell('A2').value = { formula: 'VARA(B2:B10)', result: 25 };
  ws.getCell('A3').value = { formula: 'STDEV(B3:B10)', result: 5 }; // clean, no A suffix
  ws.getCell('A4').value = { formula: 'VAR(B4:B10)', result: 25 }; // clean
  ws.getCell('A5').value = { formula: 'AVERAGE(B5:B10)', result: 10 }; // unrelated

  const result = checkStdevaVaraUsage(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, f.functionUsed));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['A1', 'A2'].sort();
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);
  if (!pass) process.exit(1);
  console.log('ALL TESTS PASSED');
}
main().catch(e => { console.error(e); process.exit(1); });
