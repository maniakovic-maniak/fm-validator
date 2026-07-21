const ExcelJS = require('exceljs');
const { checkTaxEffectiveRate } = require('./src/utils/tax-effective-rate-check');

async function main() {
  console.log('=== Case 1: broken tax calc (risk case), rate as whole number (30) ===');
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('P&L');
  ws1.getCell('A5').value = 'Statutory Tax Rate';
  ws1.getCell('B5').value = 30; // whole-number percentage form
  ws1.getCell('A10').value = 'Pre-Tax Income';
  ws1.getCell('B10').value = { formula: 'C10*1', result: 1000000 };
  ws1.getCell('C10').value = { formula: 'D10*1', result: 1200000 };
  ws1.getCell('A11').value = 'Tax Expense';
  ws1.getCell('B11').value = { formula: 'C11*1', result: 300000 };  // 30% -- correct
  ws1.getCell('C11').value = { formula: 'D11*1', result: 60000 };   // 5% -- broken

  const r1 = checkTaxEffectiveRate(wb1);
  console.log('applicable:', r1.applicable, '| flaggedCount:', r1.flaggedCount);
  r1.findings.forEach(f => console.log('  ', f.sheet+'!'+f.taxCell, 'effRate='+f.effectiveRate, 'statRate='+f.statutoryRate));

  console.log('\n=== Case 2: consistent tax calc (clean case), rate as fraction (0.25) ===');
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('P&L');
  ws2.getCell('A5').value = 'Corporate Tax Rate';
  ws2.getCell('B5').value = 0.25;
  ws2.getCell('A10').value = 'Profit Before Tax';
  ws2.getCell('B10').value = { formula: 'C10*1', result: 1000000 };
  ws2.getCell('A11').value = 'Income Tax Expense';
  ws2.getCell('B11').value = { formula: 'C11*1', result: 250000 }; // exactly 25%
  const r2 = checkTaxEffectiveRate(wb2);
  console.log('applicable:', r2.applicable, '| flaggedCount:', r2.flaggedCount);

  console.log('\n=== Case 3: loss period -- must be skipped, not flagged ===');
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('P&L');
  ws3.getCell('A5').value = 'Tax Rate';
  ws3.getCell('B5').value = 0.3;
  ws3.getCell('A10').value = 'EBT';
  ws3.getCell('B10').value = { formula: 'C10*1', result: -500000 }; // loss period
  ws3.getCell('A11').value = 'Tax Expense';
  ws3.getCell('B11').value = { formula: 'C11*1', result: 10000 }; // small tax benefit, would ratio wildly if not skipped
  const r3 = checkTaxEffectiveRate(wb3);
  console.log('applicable:', r3.applicable, '| flaggedCount:', r3.flaggedCount);

  console.log('\n=== Case 4: missing statutory rate label -- not applicable, not a guess ===');
  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet('P&L');
  ws4.getCell('A10').value = 'Pre-Tax Income';
  ws4.getCell('B10').value = 1000000;
  ws4.getCell('A11').value = 'Tax Expense';
  ws4.getCell('B11').value = 60000;
  const r4 = checkTaxEffectiveRate(wb4);
  console.log('applicable:', r4.applicable, '| note:', r4.note);

  console.log('\n=== Case 5: tax-adjacent-but-different labels (the real false positive class found on Carlsberg) -- must be not-applicable, not guessed ===');
  const wb5 = new ExcelJS.Workbook();
  const ws5 = wb5.addWorksheet('Valuation');
  ws5.getCell('A5').value = 'Corporate Tax Rate';
  ws5.getCell('B5').value = 0.25;
  ws5.getCell('A20').value = 'Change in Deferred Tax/Capital Expenditure';
  ws5.getCell('B20').value = 10;
  ws5.getCell('A45').value = 'Stable taxes';
  ws5.getCell('B45').value = 1656;
  ws5.getCell('A10').value = 'Profit Before Tax';
  ws5.getCell('B10').value = 38132;
  const r5 = checkTaxEffectiveRate(wb5);
  console.log('applicable:', r5.applicable, '| note:', r5.note);

  const pass = r1.applicable && r1.flaggedCount === 1
    && r2.applicable && r2.flaggedCount === 0
    && r3.applicable && r3.flaggedCount === 0
    && r4.applicable === false
    && r5.applicable === false;
  console.log('\n' + (pass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!pass) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
