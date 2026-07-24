const { checkBlankCellReferences } = require('./src/utils/blank-cell-reference-check.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  const ws2 = wb.addWorksheet('Sheet2');

  // Realistic, densely-populated sheet so the column-density filter
  // behaves meaningfully (a tiny synthetic sheet with only a handful of
  // scattered cells makes every column look "sparse" by definition).
  for (let r = 1; r <= 20; r++) {
    ws.getCell('A' + r).value = r;
    ws.getCell('J' + r).value = r * 5;
  }
  for (let r = 1; r <= 15; r++) ws.getCell('B' + r).value = r * 2; // dense column B, B16-B20 left blank
  for (let r = 1; r <= 15; r++) ws2.getCell('X' + r).value = r; // dense column on sheet2 too; A1 left blank there

  // Case 1: a genuine gap in an otherwise-dense column -- MUST be flagged
  ws.getCell('C1').value = { formula: 'A1+B16', result: 1 };

  // Case 2: a range with intentional blank padding -- must NOT be flagged
  ws.getCell('D1').value = 10;
  ws.getCell('D2').value = 20;
  ws.getCell('E1').value = { formula: 'SUM(D1:D5)', result: 30 };

  // Case 3: explicitly blank-aware formula (ISBLANK) -- must be skipped entirely
  ws.getCell('F1').value = { formula: 'IF(ISBLANK(G1),0,G1*2)', result: 0 };

  // Case 4: explicit ="" comparison -- must be skipped entirely
  ws.getCell('H1').value = { formula: 'IF(I1="","",I1*2)', result: '' };

  // Case 5: reference to a non-blank cell -- must NOT be flagged
  ws.getCell('K1').value = { formula: 'J1*2', result: 10 };

  // Case 6: cross-sheet reference to a genuine gap -- MUST be flagged with the correct sheet name
  ws.getCell('L1').value = { formula: "'Sheet2'!A1+10", result: 10 };

  // Case 7: a string literal that happens to look like a cell reference -- must NOT be matched
  ws.getCell('M1').value = { formula: 'IF(TRUE,"A1","B1")', result: 'A1' };

  // ── The real false positive found via testing against a real project file ──
  // A "Debt Dashboard" sheet referenced a P&L cell in a structural
  // spacer/label column (33% populated across the sheet, vs. 82% for
  // the real data column right next to it) — every reference into that
  // column was being flagged even though the blankness was by design,
  // not a gap. Reproduced here with the same shape: column N is a
  // sparse spacer column (populated in only 2 of 20 rows).
  for (let r = 1; r <= 2; r++) ws.getCell('N' + r).value = 'label';
  ws.getCell('O1').value = { formula: 'A1+N10', result: 1 }; // N10 is blank, but N is a structurally sparse column

  const result = checkBlankCellReferences(wb);
  console.log('Total findings:', result.flaggedCount);
  result.findings.forEach(f => console.log(`  ${f.sheet}!${f.cell} -> ${f.referencedCell}`));
  console.log('');

  check('a genuine gap in an otherwise-dense column IS flagged', result.findings.some(f => f.cell === 'C1' && f.referencedCell === 'Sheet1!B16'));
  check('a range with intentional blank padding is NOT flagged', !result.findings.some(f => f.cell === 'E1'));
  check('an ISBLANK-aware formula is skipped entirely', !result.findings.some(f => f.cell === 'F1'));
  check('an ="" comparison formula is skipped entirely', !result.findings.some(f => f.cell === 'H1'));
  check('a reference to a non-blank cell is NOT flagged', !result.findings.some(f => f.cell === 'K1'));
  check('a cross-sheet gap in a dense sheet is flagged with the correct sheet name', result.findings.some(f => f.cell === 'L1' && f.referencedCell === 'Sheet2!A1'));
  check('a string literal resembling a cell reference is NOT matched', !result.findings.some(f => f.cell === 'M1'));
  check('a blank cell in a structurally sparse column is correctly excluded (the real bug found via real-file testing)', !result.findings.some(f => f.cell === 'O1'));
  check('exactly 3 genuine findings (C1, L1) -- no false positives, no false negatives', result.flaggedCount === 2);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
