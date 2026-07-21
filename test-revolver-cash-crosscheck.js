const ExcelJS = require('exceljs');
const { checkRevolverCashCrosscheck } = require('./src/utils/revolver-cash-crosscheck');

async function main() {
  console.log('=== Case 1: undrawn revolver + negative cash (risk case) ===');
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('Debt');
  ws1.getCell('A5').value = 'Revolver Balance';
  ws1.getCell('B5').value = 0;
  ws1.getCell('C5').value = 0;
  ws1.getCell('A10').value = 'Cash Balance';
  ws1.getCell('B10').value = 5000;
  ws1.getCell('C10').value = -2000; // shortfall, revolver should have drawn
  const r1 = checkRevolverCashCrosscheck(wb1);
  console.log('applicable:', r1.applicable, '| flaggedCount:', r1.flaggedCount);
  r1.findings.forEach(f => console.log('  ', f.pattern, f.revolverCell, 'rev='+f.revolverValue, 'cash='+f.cashValue));

  console.log('\n=== Case 2: drawn revolver + ample cash (risk case) ===');
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Debt');
  ws2.getCell('A5').value = 'Revolver Balance';
  ws2.getCell('B5').value = 50000; // meaningfully drawn
  ws2.getCell('A10').value = 'Cash Balance';
  ws2.getCell('B10').value = 100000; // also ample -- why drawn?
  const r2 = checkRevolverCashCrosscheck(wb2);
  console.log('applicable:', r2.applicable, '| flaggedCount:', r2.flaggedCount);
  r2.findings.forEach(f => console.log('  ', f.pattern));

  console.log('\n=== Case 3: healthy pattern (clean case) ===');
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('Debt');
  ws3.getCell('A5').value = 'Revolver Balance';
  ws3.getCell('B5').value = 0; ws3.getCell('C5').value = 50000; ws3.getCell('D5').value = 0;
  ws3.getCell('A10').value = 'Cash Balance';
  ws3.getCell('B10').value = 5000; ws3.getCell('C10').value = 0; ws3.getCell('D10').value = 10000;
  const r3 = checkRevolverCashCrosscheck(wb3);
  console.log('applicable:', r3.applicable, '| flaggedCount:', r3.flaggedCount);

  console.log('\n=== Case 4: small/rounding-level values -- must NOT be flagged ===');
  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet('Debt');
  ws4.getCell('A5').value = 'Revolver Balance';
  ws4.getCell('B5').value = 50; // below meaningful floor
  ws4.getCell('A10').value = 'Cash Balance';
  ws4.getCell('B10').value = 100; // below meaningful floor
  const r4 = checkRevolverCashCrosscheck(wb4);
  console.log('applicable:', r4.applicable, '| flaggedCount:', r4.flaggedCount);

  const pass = r1.applicable && r1.flaggedCount === 1 && r1.findings[0].pattern === 'undrawn-revolver-nonpositive-cash'
    && r2.applicable && r2.flaggedCount === 1 && r2.findings[0].pattern === 'drawn-revolver-ample-cash'
    && r3.applicable && r3.flaggedCount === 0
    && r4.applicable && r4.flaggedCount === 0;
  console.log('\n' + (pass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!pass) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
