const ExcelJS = require('exceljs');
const { checkLookupExactMatch } = require('./src/utils/lookup-exact-match-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // RISK CASES: the argument is OMITTED, so Excel silently falls back to approximate matching
  ws.getCell('A1').value = { formula: 'VLOOKUP(B1,C1:D10,2)', result: 5 }; // no 4th arg
  ws.getCell('A2').value = { formula: 'VLOOKUP(B2,C2:D10,2,TRUE)', result: 5 }; // explicit approximate: a deliberate choice, counted but not flagged
  ws.getCell('A3').value = { formula: 'MATCH(B3,C3:C10)', result: 3 }; // no 3rd arg
  ws.getCell('A4').value = { formula: 'MATCH(B4,C4:C10,1)', result: 3 }; // explicit next-smallest: deliberate (rating-band lookups), not flagged

  // CLEAN CASES
  ws.getCell('A5').value = { formula: 'VLOOKUP(B5,C5:D10,2,FALSE)', result: 5 };
  ws.getCell('A6').value = { formula: 'VLOOKUP(B6,C6:D10,2,0)', result: 5 };
  ws.getCell('A7').value = { formula: 'MATCH(B7,C7:C10,0)', result: 3 };
  ws.getCell('A8').value = { formula: 'HLOOKUP(B8,C8:D10,2,FALSE)', result: 5 };
  ws.getCell('A9').value = { formula: 'SUM(B9:C9)', result: 10 }; // no lookup function at all

  const result = checkLookupExactMatch(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, f.function));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['A1', 'A3'].sort();
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : 'FAIL, got ' + JSON.stringify(flaggedCells));
  if (!pass) process.exit(1);
  if (result.deliberateApproximate !== 2) { console.log('FAIL: expected 2 deliberate approximate lookups, got', result.deliberateApproximate); process.exit(1); }
  console.log('ALL TESTS PASSED');
}
main().catch(e => { console.error(e); process.exit(1); });
