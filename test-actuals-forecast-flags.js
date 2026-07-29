const ExcelJS = require('exceljs');
const { runTier1 } = require('./src/validator-tier1.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

function makeParsed(sheetsData) {
  const wb = new ExcelJS.Workbook();
  const sheets = {};
  for (const [name, rows] of Object.entries(sheetsData)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((row, i) => {
      row.forEach((val, j) => { if (val !== null) ws.getCell(i + 1, j + 1).value = val; });
    });
    sheets[name] = [];
  }
  return { sheetNames: Object.keys(sheetsData), sheets, tier0: {}, _raw: wb, _type: 'exceljs' };
}

// ══════════════════════════════════════════════════════════════════
// The real defects this fixes, confirmed via an independent review:
// T1-009 and T1-012 both only ever searched for a dedicated sheet
// named Timing/Flags/Timeline/Inputs/Assumptions — but a real model's
// actual/forecast flags genuinely exist embedded in an ordinary sheet
// (Underwriting!row 4, which is ALSO that sheet's date-header row).
// ══════════════════════════════════════════════════════════════════
{
  const parsed = makeParsed({
    'Summary': [['Overview']],
    'Financial Statements': [['Balance Sheet']],
    'Underwriting': [
      ['Actual / Forecast Status', null, 'Actual', 'Actual', 'Forecast', 'Forecast'],
    ],
  });
  const results = runTier1(parsed);
  const t1009 = results.find(r => r.id === 'T1-009');
  const t1012 = results.find(r => r.id === 'T1-012');
  check('real defect fixed: T1-009 now passes when actual/forecast flags are embedded in an ordinary sheet, not a dedicated one',
    t1009 && t1009.status === 'pass');
  check('real defect fixed: T1-012 now passes for the same reason',
    t1012 && t1012.status === 'pass');
}

// ══════════════════════════════════════════════════════════════════
// The edge case found while fixing this: a forward-only model where
// every period currently evaluates to "Forecast" (no historical
// periods reached yet) must still pass — the flag MECHANISM is what
// matters, not whether "Actual" happens to appear today.
// ══════════════════════════════════════════════════════════════════
{
  const parsed = makeParsed({
    'Summary': [['Overview']],
    'Financial Statements': [['Balance Sheet']],
    'Underwriting': [
      ['Actual / Forecast Status', null, 'Forecast', 'Forecast', 'Forecast', 'Forecast'],
    ],
  });
  const results = runTier1(parsed);
  const t1009 = results.find(r => r.id === 'T1-009');
  check('forward-only model edge case: a row with only "Forecast" values (no "Actual" has occurred yet) still passes, since the flag mechanism itself is what is being verified',
    t1009 && t1009.status === 'pass');
}

// ══════════════════════════════════════════════════════════════════
// Regression: a genuine absence (no dedicated sheet, no embedded flag
// row anywhere) must still correctly fail, with a clear, non-
// misleading message.
// ══════════════════════════════════════════════════════════════════
{
  const parsed = makeParsed({
    'Summary': [['Overview']],
    'Financial Statements': [['Balance Sheet']],
    'Underwriting': [['Some other label', 'Some value']],
  });
  const results = runTier1(parsed);
  const t1009 = results.find(r => r.id === 'T1-009');
  const t1012 = results.find(r => r.id === 'T1-012');
  check('regression: a genuine absence of any actual/forecast flag mechanism still correctly fails T1-009',
    t1009 && t1009.status === 'fail');
  check('regression: a genuine absence still correctly fails T1-012',
    t1012 && t1012.status === 'fail');
  check('message fix: the failure reason states what was searched for, not a bare "0 found" dump',
    t1009.reason.includes('None of the expected sheet types'));
}

// ══════════════════════════════════════════════════════════════════
// A single mention of "actual" or "forecast" alone (not a genuine
// per-column flag pattern, and no combined label) must not
// false-positive.
// ══════════════════════════════════════════════════════════════════
{
  const parsed = makeParsed({
    'Summary': [['Overview']],
    'Financial Statements': [['Balance Sheet']],
    'Underwriting': [['Forecast period: 5 years']],
  });
  const results = runTier1(parsed);
  const t1009 = results.find(r => r.id === 'T1-009');
  check('a single incidental mention of "forecast" (no combined label, no per-column flag pattern) does not false-positive',
    t1009 && t1009.status === 'fail');
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
