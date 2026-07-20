const ExcelJS = require('exceljs');
const { checkEmbeddedErrorBranches } = require('./src/utils/embedded-error-branch-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // RISK CASE: error literal in the FALSE branch (the exact real-world
  // example from Mazars' Top 10 Errors list).
  ws.getCell('A1').value = { formula: 'IF(AND(L2>=E8,L3<=F8),1,#REF!)', result: 1 };
  // RISK CASE: error literal in the TRUE branch.
  ws.getCell('A2').value = { formula: 'IF(B2=0,#DIV/0!,C2/B2)', result: 5 };
  // RISK CASE: a different error literal, #N/A.
  ws.getCell('A3').value = { formula: 'IF(D3="",#N/A,D3*2)', result: 10 };
  // CLEAN CASE: ordinary IF with no error literal — must NOT be flagged.
  ws.getCell('A4').value = { formula: 'IF(E4>0,E4*2,0)', result: 0 };
  // CLEAN CASE: IFERROR (a different function) wrapping a real error —
  // this is a different, already-covered pattern, must NOT be flagged
  // by THIS check.
  ws.getCell('A5').value = { formula: 'IFERROR(F5/G5,0)', result: 0 };
  // CLEAN CASE: an error literal appearing only as a TEXT STRING inside
  // an IF, not as the branch value itself — must NOT be flagged.
  ws.getCell('A6').value = { formula: 'IF(H6>0,"Check for #REF! manually",0)', result: 0 };
  // CLEAN CASE: nested IF where the error literal is buried inside a
  // deeper, unrelated function call, not a direct branch of the outer
  // IF — must NOT be flagged for the OUTER if's branches themselves,
  // though the INNER if (if present) legitimately could be. Here there's
  // no inner IF at all, just a SUM wrapping a literal, so nothing should
  // fire for this cell.
  ws.getCell('A7').value = { formula: 'IF(I7>0,SUM(J7,K7),0)', result: 0 };
  // RISK CASE: a nested IF, error literal in the INNER if's branch.
  ws.getCell('A8').value = { formula: 'IF(L8>0,IF(M8>0,1,#VALUE!),0)', result: 1 };

  const result = checkEmbeddedErrorBranches(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '-', f.errorLiteral, 'in', f.branchPosition, 'branch'));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['A1', 'A2', 'A3', 'A8'].sort();
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);

  if (!pass) process.exit(1);
  console.log('\nALL TESTS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
