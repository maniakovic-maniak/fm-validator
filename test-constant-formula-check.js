const { checkConstantFormulaCells } = require('./src/utils/constant-formula-check.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // ── Case 1: the exact Operis worked example ──
  ws.getCell('A1').value = { formula: '10+40', result: 50 };

  // ── Case 2: a formula with a real cell reference — must NOT be flagged ──
  ws.getCell('A2').value = { formula: 'B2+40', result: 40 };

  // ── Case 3: bare TODAY() — no numeric literal, nothing buried ──
  ws.getCell('A3').value = { formula: 'TODAY()', result: new Date() };

  // ── Case 4: text-only formula — must NOT be flagged ──
  ws.getCell('A4').value = { formula: '"Hello"', result: 'Hello' };

  // ── Case 5: another genuine buried-derivation example ──
  ws.getCell('A5').value = { formula: '365*24', result: 8760 };

  // ── Case 6 & 7: the real bug found via real-file testing — a bare
  // literal placeholder (e.g. "=0", extremely common) was being
  // flagged even though it isn't combining/deriving anything the way
  // Operis's own example does; it's functionally identical to a plain
  // input cell already. Fixed by requiring an actual operator or
  // function call to be present. ──
  ws.getCell('A6').value = { formula: '0', result: 0 };
  ws.getCell('A7').value = { formula: '1', result: 1 };

  // ── Case 8 & 9: the second real bug found — whole-row/whole-column
  // references (e.g. 5:5, A:A) have no column-letter+row-digit shape,
  // so the original regex never recognized them as real references,
  // causing a real formula like SUMIF(5:5,TRUE,38:38) on the Carlsberg
  // model to be incorrectly treated as having zero references. ──
  ws.getCell('A8').value = { formula: 'SUMIF(5:5,TRUE,38:38)', result: 0 };
  ws.getCell('A9').value = { formula: 'SUM(A:A)', result: 0 };

  // ── Case 10: a real, genuine finding pattern discovered on The Bend
  // model — a descriptive range label ("3% to 5%") apparently typed in
  // a way Excel silently interpreted as arithmetic instead of text,
  // computing a nonsensical result (2.95) with no visible error. A
  // real, valuable catch, not a false positive. ──
  ws.getCell('A10').value = { formula: '3-5%', result: 2.95 };

  // ── Case 11: a hardcoded date buried in a formula — another real,
  // valid pattern found on The Bend model (Inputs!E17). ──
  ws.getCell('A11').value = { formula: 'DATE(2027,6,30)', result: new Date('2027-06-30') };

  const result = checkConstantFormulaCells(wb);
  console.log('Total findings:', result.flaggedCount);
  result.findings.forEach(f => console.log(`  ${f.sheet}!${f.cell} | ${f.formula}`));
  console.log('');

  check('the exact Operis worked example (=10+40) IS flagged', result.findings.some(f => f.cell === 'A1'));
  check('a formula with a real cell reference is NOT flagged', !result.findings.some(f => f.cell === 'A2'));
  check('bare TODAY() (no numeric literal) is NOT flagged', !result.findings.some(f => f.cell === 'A3'));
  check('a text-only formula is NOT flagged', !result.findings.some(f => f.cell === 'A4'));
  check('another genuine buried-derivation example (365*24) IS flagged', result.findings.some(f => f.cell === 'A5'));
  check('a bare literal placeholder "=0" is NOT flagged (real bug #1, fixed)', !result.findings.some(f => f.cell === 'A6'));
  check('a bare literal placeholder "=1" is NOT flagged', !result.findings.some(f => f.cell === 'A7'));
  check('a whole-row reference (5:5) is correctly recognized as a real reference, NOT flagged (real bug #2, fixed)', !result.findings.some(f => f.cell === 'A8'));
  check('a whole-column reference (A:A) is correctly recognized, NOT flagged', !result.findings.some(f => f.cell === 'A9'));
  check('a descriptive-range-label-turned-arithmetic pattern (the real finding from The Bend) IS flagged', result.findings.some(f => f.cell === 'A10'));
  check('a hardcoded date buried in DATE() (the other real finding from The Bend) IS flagged', result.findings.some(f => f.cell === 'A11'));
  check('exactly 4 genuine findings total (A1, A5, A10, A11)', result.flaggedCount === 4);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
