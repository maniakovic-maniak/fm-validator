const ExcelJS = require('exceljs');
const ValidatorRunner = require('./validators/runner.js');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // FIX regression: ExcelJS represents a formula cell that evaluates to
  // an error as an object, not a plain string -- String(cell.value) on
  // this used to produce the literal text "[object Object]", meaning a
  // real formula error was never actually detected.
  ws.getCell('A1').value = { formula: 'A2/A3', result: { error: '#DIV/0!' } };
  // A literal-text error must still be caught (pre-existing behavior).
  ws.getCell('A2').value = 'This cell contains #REF! as plain text';
  // FIX regression: the #NAME? regex was missing its escape.
  ws.getCell('A3').value = { formula: 'BADFUNC()', result: { error: '#NAME?' } };
  // A clean cell with no error at all.
  ws.getCell('A4').value = 42;
  // Confirms the regex fix is precise, not just "something matches":
  // '#NAM' without the full '#NAME?' string must NOT be flagged.
  ws.getCell('A5').value = 'reference #NAM only, not a real error';
  // A direct (non-formula) error value shape.
  ws.getCell('A6').value = { error: '#N/A' };

  const runner = new ValidatorRunner('./config/checklist.json');
  const result = runner.checkNoFormulaErrors(wb, {});
  const errors = result.details.errors;
  console.log('Total errors found:', errors.length);
  errors.forEach(e => console.log('  ' + e.sheet + '!' + e.cell, '->', JSON.stringify(e.value)));
  console.log('');

  check('a formula-error object cell (A1) is correctly extracted as "#DIV/0!", not "[object Object]"',
    errors.some(e => e.cell === 'A1' && e.value === '#DIV/0!'));
  check('a literal-text error (A2) is still correctly caught',
    errors.some(e => e.cell === 'A2'));
  check('a genuine #NAME? formula error (A3) is correctly extracted and matched by the fixed regex',
    errors.some(e => e.cell === 'A3' && e.value === '#NAME?'));
  check('a clean cell (A4) produces no error',
    !errors.some(e => e.cell === 'A4'));
  check('"#NAM" without the full "#NAME?" string (A5) is correctly NOT flagged -- confirms the regex fix is precise',
    !errors.some(e => e.cell === 'A5'));
  check('a direct (non-formula) error value shape (A6) is also correctly extracted',
    errors.some(e => e.cell === 'A6' && e.value === '#N/A'));
  check('overall error count is exactly 4 (A1, A2, A3, A6) -- not the 3 it would have been before the object-stringification fix, and not inflated by the regex false-positive case',
    errors.length === 4);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
