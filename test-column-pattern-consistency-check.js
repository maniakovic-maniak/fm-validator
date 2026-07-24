const { checkColumnPatternConsistency } = require('./src/utils/column-pattern-consistency-check.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // ── Case 1: a genuine outlier in an otherwise-consistent column ──
  for (let r = 1; r <= 8; r++) ws.getCell('A' + r).value = r * 10;
  for (let r = 1; r <= 4; r++) ws.getCell('B' + r).value = { formula: 'A' + r + '*2', result: r * 20 };
  ws.getCell('B5').value = { formula: 'A5*3', result: 150 }; // genuine outlier -- different multiplier
  for (let r = 6; r <= 8; r++) ws.getCell('B' + r).value = { formula: 'A' + r + '*2', result: r * 20 };

  // ── Case 2: a legitimate column total at the bottom ──
  for (let r = 1; r <= 6; r++) ws.getCell('C' + r).value = { formula: 'A' + r + '+1', result: r * 10 + 1 };
  ws.getCell('C7').value = { formula: 'SUM(C1:C6)', result: 999 };

  // ── Case 3: a date-metadata block mixed with unrelated numeric
  // calculations -- the real false positive found via testing against
  // a real project file (a P&L sheet with model dates near the top of
  // a column, unrelated SUMSQ-based numeric cells much further down). ──
  for (let r = 1; r <= 4; r++) ws.getCell('D' + r).value = { formula: 'Inputs!X' + r, result: new Date('2027-01-0' + r) };
  for (let r = 10; r <= 15; r++) ws.getCell('D' + r).value = { formula: 'A' + r + '*5', result: r * 50 };
  ws.getCell('D12').value = { formula: 'A12*7', result: 999 }; // a genuine outlier WITHIN the numeric segment

  // ── Case 4: a "checks register" style column -- the second real
  // false positive found via testing, which persisted even after the
  // result-type segmentation fix for Case 3, since every named check
  // still produced the same "string" result category (PASS/FAIL/
  // CONTROLLED). Each row here is a deliberately different check by
  // design, matching the real "Model Checks" sheet found. ──
  ws.getCell('F1').value = { formula: 'IF(A1=0,"PASS","FAIL")', result: 'PASS' };
  ws.getCell('F2').value = { formula: 'IF(ABS(A2)<0.0001,"PASS","FAIL")', result: 'PASS' };
  ws.getCell('F3').value = { formula: 'IF(A3=0,"PASS","CONTROLLED")', result: 'CONTROLLED' };
  ws.getCell('F4').value = { formula: 'IF(A4>100,"FAIL","PASS")', result: 'PASS' };
  ws.getCell('F5').value = { formula: 'IF(A5<0,"FAIL","PASS")', result: 'PASS' };

  const result = checkColumnPatternConsistency(wb);
  console.log('Total findings:', result.flaggedCount);
  result.findings.forEach(f => console.log(`  ${f.sheet}!${f.cell} | ${f.formula}`));
  console.log('');

  check('a genuine outlier in an otherwise-consistent column is flagged', result.findings.some(f => f.cell === 'B5'));
  check('a legitimate column total is NOT flagged', !result.findings.some(f => f.cell === 'C7'));
  check('date-metadata cells are NOT flagged against an unrelated numeric block (real bug #1, fixed)',
    !result.findings.some(f => ['D1', 'D2', 'D3', 'D4'].includes(f.cell)));
  check('a genuine outlier WITHIN the numeric segment is still correctly flagged (confirms the segmentation fix did not over-suppress)',
    result.findings.some(f => f.cell === 'D12'));
  check('a checks-register-style column (all differently-named PASS/FAIL/CONTROLLED checks) is NOT flagged at all (real bug #2, fixed)',
    !result.findings.some(f => ['F1', 'F2', 'F3', 'F4', 'F5'].includes(f.cell)));
  check('exactly 2 genuine findings total (B5, D12) -- no false positives, no false negatives', result.flaggedCount === 2);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
