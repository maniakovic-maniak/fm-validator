const { findLabeledValues } = require('./src/utils/find-labeled-value.js');
const ExcelJS = require('exceljs');

// cellText itself isn't exported (an internal helper), so it's tested
// indirectly through findLabeledValues, which is what every one of the
// 8 real checks that broke in production actually calls.

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ── The real production bug ──────────────────────────────────────────────
  // Found via a real pipeline run: 8 different checks (DSRA sizing,
  // DSCR-gated distributions, balance-never-negative, sign convention,
  // tax effective-rate, revolver/cash cross-check, key-output chain,
  // reasonableness checks) all failed with the identical error
  // "cellText(...).toLowerCase is not a function" on the same real
  // workbook — traced to this shared utility. A hyperlink-shaped cell
  // value whose .text is a non-string truthy value (e.g. a numeric
  // display text) was returned as-is instead of being coerced to a
  // string, so .toLowerCase() downstream threw.
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('Sheet1');
  ws1.getCell('A1').value = { text: 12345, hyperlink: 'https://example.com' };
  ws1.getCell('B1').value = 'WACC';
  ws1.getCell('C1').value = 0.08;
  try {
    const r = findLabeledValues(wb1, ['wacc']);
    check('a hyperlink cell with numeric display text no longer crashes findLabeledValues', true);
    check('the real label (WACC) is still correctly found despite the numeric-hyperlink cell nearby',
      r.length === 1 && r[0].value === 0.08);
  } catch (e) {
    check('a hyperlink cell with numeric display text no longer crashes findLabeledValues', false);
    console.log('  threw:', e.message);
  }

  // ── Regression: every normal cell.value shape must still work ───────────
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Sheet1');
  ws2.getCell('A1').value = { richText: [{ text: 'Terminal ' }, { text: 'Value' }] };
  ws2.getCell('B1').value = 12000000;
  const r2 = findLabeledValues(wb2, ['terminal value']);
  check('a normal multi-run richText cell still resolves correctly',
    r2.length === 1 && r2[0].value === 12000000);

  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('Sheet1');
  ws3.getCell('A1').value = 'EBITDA Margin';
  ws3.getCell('B1').value = 0.25;
  const r3 = findLabeledValues(wb3, ['ebitda margin']);
  check('a normal plain-string label cell still resolves correctly',
    r3.length === 1 && r3[0].value === 0.25);

  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet('Sheet1');
  ws4.getCell('A1').value = { text: 'Normal string hyperlink', hyperlink: 'https://x.com' };
  ws4.getCell('B1').value = 'Some Label';
  ws4.getCell('C1').value = 42;
  const r4 = findLabeledValues(wb4, ['some label']);
  check('a normal hyperlink cell with genuinely string display text still resolves correctly',
    r4.length === 1 && r4[0].value === 42);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
