const { checkErrorLiteralInFormula } = require('./src/utils/error-literal-in-formula-check.js');
const { checkEmbeddedErrorBranches } = require('./src/utils/embedded-error-branch-check.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // Case 1: exact overlap with embedded-error-branch-check.js — #REF!
  // is the ENTIRE content of an IF() branch. Must be flagged by the
  // OLD check, but NOT duplicated by this NEW check.
  ws.getCell('A1').value = { formula: 'IF(B1>0,C1,#REF!)', result: 0 };

  // Case 2: a genuine standalone case -- #REF! as an arithmetic term,
  // not inside any IF() at all. Mirrors the real pattern found on the
  // Carlsberg model: a broken cross-sheet reference inside INDEX().
  ws.getCell('A2').value = { formula: "B2+INDEX('Scenario analysis'!#REF!,1)", result: 0 };

  // Case 3: #REF! appears within an IF() branch but is only PART of a
  // larger expression, not the whole branch -- must still be flagged.
  ws.getCell('A3').value = { formula: 'IF(B3>0,C3+#REF!,0)', result: 0 };

  // Case 4: a string literal merely mentioning the term as text --
  // must NOT be flagged at all.
  ws.getCell('A4').value = { formula: 'CONCATENATE("Error was ","#REF!")', result: 'Error was #REF!' };

  // Case 5: inside a SUM() argument -- must be flagged.
  ws.getCell('A5').value = { formula: 'SUM(B5,#N/A,C5)', result: 0 };

  const newResult = checkErrorLiteralInFormula(wb);
  const oldResult = checkEmbeddedErrorBranches(wb);

  console.log('New check findings:', newResult.flaggedCount);
  newResult.findings.forEach(f => console.log(`  ${f.sheet}!${f.cell} | ${f.errorLiteral} | ${f.formula}`));
  console.log('');

  check('the exact IF-branch overlap case is NOT duplicated by the new check', !newResult.findings.some(f => f.cell === 'A1'));
  check('the exact IF-branch overlap case IS still caught by the OLD check (no regression to the existing check)', oldResult.findings.some(f => f.cell === 'A1'));
  check('a standalone error literal inside INDEX() (mirrors the real Carlsberg finding) IS flagged', newResult.findings.some(f => f.cell === 'A2'));
  check('an error literal that is only PART of an IF() branch expression (not the whole branch) IS flagged', newResult.findings.some(f => f.cell === 'A3'));
  check('a string literal merely mentioning the error term as text is NOT flagged', !newResult.findings.some(f => f.cell === 'A4'));
  check('an error literal inside a SUM() argument IS flagged', newResult.findings.some(f => f.cell === 'A5'));
  check('exactly 3 genuine findings total (A2, A3, A5)', newResult.flaggedCount === 3);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
