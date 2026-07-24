const { checkWhitespaceSheetNames } = require('./src/utils/whitespace-sheet-name-check.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Sheet1 ');    // trailing space
  wb.addWorksheet(' Sheet2');    // leading space
  wb.addWorksheet(' Sheet3 ');   // both
  wb.addWorksheet('CleanSheet'); // clean, must not be flagged
  wb.addWorksheet('   ');        // whitespace-only -- a different concern (sheet-resolver.js's own domain), must not be flagged here

  const result = checkWhitespaceSheetNames(wb);
  console.log('Total findings:', result.flaggedCount);
  result.findings.forEach(f => console.log(`  ${JSON.stringify(f.sheet)}`));
  console.log('');

  check('a trailing-space sheet name IS flagged', result.findings.some(f => f.sheet === 'Sheet1 '));
  check('a leading-space sheet name IS flagged', result.findings.some(f => f.sheet === ' Sheet2'));
  check('a sheet name with both leading and trailing whitespace IS flagged', result.findings.some(f => f.sheet === ' Sheet3 '));
  check('a clean sheet name is NOT flagged', !result.findings.some(f => f.sheet === 'CleanSheet'));
  check('a whitespace-only sheet name is NOT flagged (a different, already-covered concern)', !result.findings.some(f => f.sheet === '   '));
  check('exactly 3 genuine findings, no false positives, no false negatives', result.flaggedCount === 3);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
