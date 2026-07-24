const { checkHiddenFormulas } = require('./src/utils/hidden-formula-check.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ── Case 1: sheet WITH protection, a hidden formula — must be flagged ──
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('Protected');
  ws1.getCell('A1').value = { formula: 'B1*2', result: 10 };
  ws1.getCell('A1').protection = { hidden: true, locked: true };
  await ws1.protect('pw', {});
  const r1 = checkHiddenFormulas(wb1);
  check('a hidden formula on a genuinely protected sheet IS flagged',
    r1.flaggedCount === 1 && r1.findings[0].cell === 'A1');

  // ── Case 2: same hidden attribute, but sheet protection is NOT
  // enabled — must NOT be flagged, since the attribute is inert without
  // active protection. ──
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Unprotected');
  ws2.getCell('A1').value = { formula: 'B1*2', result: 10 };
  ws2.getCell('A1').protection = { hidden: true, locked: true };
  const r2 = checkHiddenFormulas(wb2);
  check('a hidden attribute with no active sheet protection is NOT flagged (the attribute is inert)',
    r2.flaggedCount === 0);

  // ── Case 3: sheet protected, but this particular formula is NOT
  // hidden — must NOT be flagged. ──
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('ProtectedButVisible');
  ws3.getCell('A1').value = { formula: 'B1*2', result: 10 };
  ws3.getCell('A1').protection = { hidden: false, locked: true };
  await ws3.protect('pw', {});
  const r3 = checkHiddenFormulas(wb3);
  check('a formula that is not hidden, even on a protected sheet, is NOT flagged',
    r3.flaggedCount === 0);

  // ── Case 4: a non-formula cell (a plain value) marked hidden on a
  // protected sheet — must NOT be flagged, since this check is
  // specifically about hiding a CALCULATION's logic, not a plain input. ──
  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet('PlainValue');
  ws4.getCell('A1').value = 42;
  ws4.getCell('A1').protection = { hidden: true, locked: true };
  await ws4.protect('pw', {});
  const r4 = checkHiddenFormulas(wb4);
  check('a hidden PLAIN VALUE (not a formula) is NOT flagged', r4.flaggedCount === 0);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
