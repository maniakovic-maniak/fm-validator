const { checkTwoDigitYearExtraction } = require('./src/utils/two-digit-year-check.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');

  // ── Case 1: the exact real risky pattern found on The Bend model —
  // two unguarded extractions subtracted from each other. ──
  ws.getCell('D23').value = { formula: 'IFERROR(VALUE(RIGHT(C23,2))-VALUE(RIGHT(B23,2)),0)', result: 0 };

  // ── Case 2: a single unguarded occurrence ──
  ws.getCell('A1').value = { formula: 'VALUE(RIGHT(B1,2))+1', result: 31 };

  // ── Case 3: RIGHT() with a different character count (a full
  // 4-digit year) — must NOT be flagged, this isn't a 2-digit case. ──
  ws.getCell('A2').value = { formula: 'VALUE(RIGHT(B2,4))', result: 2027 };

  // ── Case 4: RIGHT() without a VALUE() wrapper — still text, no
  // numeric arithmetic risk, must NOT be flagged. ──
  ws.getCell('A3').value = { formula: 'RIGHT(B3,2)', result: '30' };

  // ── Case 5: an unrelated formula — must NOT be flagged. ──
  ws.getCell('A4').value = { formula: 'SUM(B4:C4)', result: 100 };

  // ── Cases 6 & 7: the real false-positive class found via real-file
  // testing — 197 of 199 raw matches on The Bend model were the model
  // explicitly restoring the century (e.g. 2000+VALUE(RIGHT(x,2))),
  // the safe, deliberate way to handle this. Both addition orders
  // must be excluded. ──
  ws.getCell('H14').value = { formula: "MATCH((2000+VALUE(RIGHT(H6,2))),X:X,0)", result: 5 };
  ws.getCell('H15').value = { formula: "MATCH((VALUE(RIGHT(H6,2))+2000),X:X,0)", result: 5 };

  const result = checkTwoDigitYearExtraction(wb);
  console.log('Total findings:', result.flaggedCount);
  result.findings.forEach(f => console.log(`  ${f.sheet}!${f.cell} | ${f.formula}`));
  console.log('');

  check('the exact real risky pattern (two unguarded subtracted extractions) IS flagged', result.findings.some(f => f.cell === 'D23'));
  check('a single unguarded extraction IS flagged', result.findings.some(f => f.cell === 'A1'));
  check('RIGHT() with a 4-character (full year) extraction is NOT flagged', !result.findings.some(f => f.cell === 'A2'));
  check('RIGHT() without a VALUE() wrapper is NOT flagged', !result.findings.some(f => f.cell === 'A3'));
  check('an unrelated formula is NOT flagged', !result.findings.some(f => f.cell === 'A4'));
  check('a century-guarded extraction (2000+ before) is NOT flagged (the real bug found via real-file testing, fixed)', !result.findings.some(f => f.cell === 'H14'));
  check('a century-guarded extraction (+2000 after) is NOT flagged (both addition orders handled)', !result.findings.some(f => f.cell === 'H15'));
  check('exactly 2 genuine findings total (D23, A1) -- no false positives, no false negatives', result.flaggedCount === 2);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
