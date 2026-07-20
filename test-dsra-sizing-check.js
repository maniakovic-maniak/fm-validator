const ExcelJS = require('exceljs');
const { checkDsraSizing } = require('./src/utils/dsra-sizing-check');

async function main() {
  console.log('=== Case 1: under-funded DSRA (risk case) ===');
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('Debt');
  ws1.getCell('A10').value = 'DSRA Target';
  ws1.getCell('B10').value = { formula: 'C10*3', result: 300000 }; // only 3 months' worth
  ws1.getCell('A11').value = 'Monthly Debt Service';
  ws1.getCell('B11').value = { formula: 'C11+D11', result: 100000 };
  let r1 = checkDsraSizing(wb1);
  console.log('applicable:', r1.applicable, '| flaggedCount:', r1.flaggedCount);
  r1.findings.forEach(f => console.log('  ', f.note));

  console.log('\n=== Case 2: adequately-funded DSRA (clean case) ===');
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Debt');
  ws2.getCell('A10').value = 'DSRA Target';
  ws2.getCell('B10').value = { formula: 'C10*6.5', result: 650000 }; // 6.5 months' worth
  ws2.getCell('A11').value = 'Monthly Debt Service';
  ws2.getCell('B11').value = { formula: 'C11+D11', result: 100000 };
  let r2 = checkDsraSizing(wb2);
  console.log('applicable:', r2.applicable, '| flaggedCount:', r2.flaggedCount);

  console.log('\n=== Case 3: no monthly debt service label found — must be not-applicable, not a guess ===');
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('Debt');
  ws3.getCell('A10').value = 'DSRA Target';
  ws3.getCell('B10').value = { formula: 'C10*3', result: 300000 };
  ws3.getCell('A11').value = 'Annual Debt Service'; // NOT monthly-labelled — must not be used
  ws3.getCell('B11').value = { formula: 'C11+D11', result: 1200000 };
  let r3 = checkDsraSizing(wb3);
  console.log('applicable:', r3.applicable, '| flaggedCount:', r3.flaggedCount, '| note:', r3.note);

  console.log('\n=== Case 4: over-funded DSRA — must NOT be flagged (one-sided check) ===');
  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet('Debt');
  ws4.getCell('A10').value = 'DSRA Target';
  ws4.getCell('B10').value = { formula: 'C10*12', result: 1200000 }; // 12 months, well above the floor
  ws4.getCell('A11').value = 'Monthly Debt Service';
  ws4.getCell('B11').value = { formula: 'C11+D11', result: 100000 };
  let r4 = checkDsraSizing(wb4);
  console.log('applicable:', r4.applicable, '| flaggedCount:', r4.flaggedCount);

  const pass = r1.applicable && r1.flaggedCount === 1
    && r2.applicable && r2.flaggedCount === 0
    && r3.applicable === false
    && r4.applicable && r4.flaggedCount === 0;
  console.log('\n' + (pass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!pass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
