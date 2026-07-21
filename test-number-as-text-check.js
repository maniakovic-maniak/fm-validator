const ExcelJS = require('exceljs');
const { checkNumbersStoredAsText } = require('./src/utils/number-as-text-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // RISK CASES: genuine numbers stored as text, in several real formats.
  ws.getCell('A1').value = '1234.56';
  ws.getCell('A2').value = '1,234,567';
  ws.getCell('A3').value = ' 500 '; // leading/trailing whitespace, a common paste artifact
  ws.getCell('A4').value = '(500)'; // parentheses-negative accounting format
  ws.getCell('A5').value = '-42.5';
  ws.getCell('A6').value = '$1,234.00';
  ws.getCell('A7').value = '15%';

  // CLEAN CASES: genuine text labels, must NOT be flagged.
  ws.getCell('B1').value = 'FY24';
  ws.getCell('B2').value = 'Q1 2024';
  ws.getCell('B3').value = 'Revenue';
  ws.getCell('B4').value = 'N/A';
  ws.getCell('B5').value = '-'; // bare dash, no digit — must not match
  ws.getCell('B6').value = '()'; // bare empty parens, no digit — must not match

  // CLEAN CASE: a genuine number (real numeric type, not text) — must
  // NOT be flagged.
  ws.getCell('C1').value = 1234.56;

  // CLEAN CASE: a formula whose text RESULT happens to look numeric —
  // this check only targets plain input cells, not formula results.
  ws.getCell('C2').value = { formula: 'TEXT(D2,"0.00")', result: '123.45' };

  // CLEAN CASE (the real false positive found on a real property/
  // development model): a bare year stored as text -- must NOT be
  // flagged, since this project's own conventions treat this as
  // correct, deliberate practice.
  ws.getCell('B7').value = '2030';
  ws.getCell('B8').value = '1999';
  ws.getCell('B9').value = ' 2024 '; // whitespace-padded bare year, still excluded

  // RISK CASE: a year-LIKE value that's actually formatted (not a bare
  // year) -- must still be flagged, since $2,030 or 2030.00 or 2030%
  // are not plausible year labels.
  ws.getCell('A8').value = '$2,030';
  ws.getCell('A9').value = '2030.00';
  ws.getCell('A10').value = '2030%';

  // CLEAN CASE: a 4-digit number outside the plausible year range --
  // must still be excluded only if it's implausible as a year (this
  // project's own year check uses 1990-2100; a value like "1500" is
  // outside that range and should be treated as a genuine number).
  ws.getCell('A11').value = '1500';

  const result = checkNumbersStoredAsText(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '=', JSON.stringify(f.textValue)));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11'].sort();
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);

  if (!pass) process.exit(1);
  console.log('\nALL TESTS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
