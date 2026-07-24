const { findNearbyLabel } = require('./src/utils/cell-label.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ── The real bug: an independent, duplicated copy of cellText's logic ──
  // Found via a real pipeline run that broke 8 different checks through
  // find-labeled-value.js's cellText. This file carried its own separate
  // copy of the same buggy logic (a hyperlink cell's numeric .text value
  // returned as-is instead of coerced to a string), which hadn't yet been
  // triggered on any real file, but was exactly the same latent crash
  // waiting to happen — now fixed by reusing the single, shared, fixed
  // cellText implementation instead of maintaining a second copy.
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('Sheet1');
  ws1.getCell('A1').value = { text: 999, hyperlink: 'https://example.com' };
  ws1.getCell('B1').value = 'Revenue';
  ws1.getCell('C1').value = 5000000;
  try {
    const label = findNearbyLabel(ws1.getRow(1), 3); // search left from column C
    check('a numeric-hyperlink cell in the search window no longer crashes findNearbyLabel', true);
    check('the real label (Revenue) is still correctly found, skipping the numeric-hyperlink cell', label === 'Revenue');
  } catch (e) {
    check('a numeric-hyperlink cell in the search window no longer crashes findNearbyLabel', false);
    console.log('  threw:', e.message);
  }

  // ── Regression: normal search directions and cell shapes still work ────
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Sheet1');
  ws2.getCell('A1').value = 'EBITDA';
  ws2.getCell('B1').value = 4200000;
  const leftLabel = findNearbyLabel(ws2.getRow(1), 2); // search left from column B
  check('a plain-string label found by searching left still works', leftLabel === 'EBITDA');

  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('Sheet1');
  ws3.getCell('A1').value = 1000000;
  ws3.getCell('B1').value = 'Net Debt';
  const rightLabel = findNearbyLabel(ws3.getRow(1), 1); // search right from column A (nothing to the left)
  check('a plain-string label found by searching right (fallback direction) still works', rightLabel === 'Net Debt');

  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet('Sheet1');
  ws4.getCell('A1').value = { richText: [{ text: 'Terminal ' }, { text: 'Growth Rate' }] };
  ws4.getCell('B1').value = 0.025;
  const richLabel = findNearbyLabel(ws4.getRow(1), 2);
  check('a richText label cell still resolves correctly', richLabel === 'Terminal Growth Rate');

  const wb5 = new ExcelJS.Workbook();
  const ws5 = wb5.addWorksheet('Sheet1');
  ws5.getCell('A1').value = 42; // a number, not a label -- must not be returned as a "label"
  ws5.getCell('B1').value = 99;
  const noLabel = findNearbyLabel(ws5.getRow(1), 2);
  check('a numeric neighbor cell (not a real label) correctly returns empty, not the number itself',
    noLabel === '');

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
