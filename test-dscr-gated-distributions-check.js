const ExcelJS = require('exceljs');
const { checkDscrGatedDistributions } = require('./src/utils/dscr-gated-distributions-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // Distributions row: periods B-F. A distribution paid in D (risk case,
  // low DSCR that period) and F (clean case, healthy DSCR that period).
  ws.getCell('A10').value = 'Distributions Paid';
  ws.getCell('B10').value = 0;
  ws.getCell('C10').value = 0;
  ws.getCell('D10').value = 500000; // RISK: paid while DSCR is weak (see D11 below)
  ws.getCell('E10').value = 0;
  ws.getCell('F10').value = 600000; // CLEAN: paid while DSCR is healthy (see F11 below)

  // Backward-looking DSCR row, same columns.
  ws.getCell('A11').value = 'Backward Looking DSCR';
  ws.getCell('B11').value = 1.5;
  ws.getCell('C11').value = 1.5;
  ws.getCell('D11').value = 0.85; // below 1.0 -- the risk case
  ws.getCell('E11').value = 1.2;
  ws.getCell('F11').value = 1.6; // healthy -- the clean case

  const result = checkDscrGatedDistributions(wb);
  console.log('applicable:', result.applicable, '| flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.distributionCell, 'dist=' + f.distributionValue, '| backwardDSCR=' + f.backwardDscr));

  const flaggedCells = result.findings.map(f => f.distributionCell).sort();
  const expected = ['D10'];
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);

  // Second scenario: no DSCR series at all -- must report not-applicable.
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Model');
  ws2.getCell('A10').value = 'Distributions Paid';
  ws2.getCell('B10').value = 500000;
  const result2 = checkDscrGatedDistributions(wb2);
  const pass2 = result2.applicable === false;
  console.log('No-DSCR-series case correctly not-applicable:', pass2 ? 'PASS' : 'FAIL');

  if (!pass || !pass2) process.exit(1);
  console.log('\nALL TESTS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
