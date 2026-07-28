const ExcelJS = require('exceljs');
const { checkModelStatusFlag } = require('./src/utils/reasonableness-checks.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real gap this fixes: a model's own "MODEL STATUS: REVIEW
// REQUIRED" self-flag lives on a summary/dashboard sheet, which
// Familiarisation's key_sheets selection — explicitly defined as
// "sheets that appear to contain the core financial logic" — has no
// reason to select. Regardless of any row-extraction fix, a sheet
// Tier 2 never receives at all can never have its content flagged.
// This deterministic check scans every sheet directly, independent
// of Tier 2's sheet selection entirely.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('INVESTOR DASHBOARD');
  ws.getCell('H4').value = 'MODEL STATUS';
  ws.getCell('I4').value = 'REVIEW REQUIRED';

  const result = checkModelStatusFlag(wb);
  check('real gap fixed: a "MODEL STATUS: REVIEW REQUIRED" flag is found directly, independent of any sheet-selection mechanism',
    result.found === true && result.flags[0].value === 'REVIEW REQUIRED');
}

// ══════════════════════════════════════════════════════════════════
// Confirms multiple, separate flags across different sheets are all
// found — matching what was confirmed on the real file (three
// separate locations: DATA MAP, INVESTOR DASHBOARD, INVESTOR ANALYTICS).
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws1 = wb.addWorksheet('DATA MAP');
  ws1.getCell('A173').value = 'OVERALL MODEL STATUS';
  ws1.getCell('C173').value = 'REVIEW REQUIRED';
  const ws2 = wb.addWorksheet('INVESTOR ANALYTICS');
  ws2.getCell('L3').value = 'STATUS';
  ws2.getCell('M3').value = 'DRAFT';

  const result = checkModelStatusFlag(wb);
  check('multiple, separate flags across different sheets are all found',
    result.found === true && result.flags.length === 2);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a genuinely positive/clean status is correctly NOT flagged
// — this must only catch concerning terms, not any "status" label at all.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dashboard');
  ws.getCell('A1').value = 'Model Status';
  ws.getCell('B1').value = 'Final';

  const result = checkModelStatusFlag(wb);
  check('a genuinely clean/positive status ("Final") is correctly NOT flagged',
    result.found === false);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a "status" label with no concerning value nearby (or an
// unrelated value) is not flagged — avoids false positives on ordinary
// status columns that happen to say something else entirely.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Payment status';
  ws.getCell('B1').value = 'Paid';

  const result = checkModelStatusFlag(wb);
  check('an unrelated "status" column (e.g. payment status) with a normal value is correctly NOT flagged',
    result.found === false);
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
