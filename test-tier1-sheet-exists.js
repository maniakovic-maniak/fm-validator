const ExcelJS = require('exceljs');
const { runTier1 } = require('./src/validator-tier1.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// A real, minimal ExcelJS workbook wrapped in the same shape parseWorkbook()
// produces — several other Tier 1 rules need a genuine workbook (with
// .eachSheet()) available via parsed._raw, not just a plain mock object.
function makeParsed(sheetNames) {
  const wb = new ExcelJS.Workbook();
  const sheets = {};
  sheetNames.forEach(name => {
    wb.addWorksheet(name);
    sheets[name] = [];
  });
  return { sheetNames, sheets, tier0: {}, _raw: wb, _type: 'exceljs' };
}

// ══════════════════════════════════════════════════════════════════
// The real, confirmed bug: T1-004 ("Balance sheet check sheet
// exists") and T1-005 ("Cash flow reconciliation sheet exists") both
// P1/fatal severity — used a sheets list of ['AFS', 'IFS', 'Balance
// Sheet'] / ['AFS', 'IFS', 'Cons', 'Cash Flow'], neither of which
// included "Financial Statements". Confirmed directly on a real
// file: T1-004 failed with "None of the expected sheets found: AFS,
// IFS, Balance Sheet" despite the model's genuine, verified balance-
// sheet check living on a sheet literally named "Financial
// Statements". The matching function itself (resolveSheetName) was
// already correct — this was purely a data gap in checklist.json's
// own sheets list, the same class of fix already applied elsewhere
// in this project (e.g. DEEP_ACCOUNTING_CATEGORIES).
// ══════════════════════════════════════════════════════════════════
{
  const sheetNames = ['Summary', 'Underwriting', 'Financial Statements', 'DEBT'];
  const results = runTier1(makeParsed(sheetNames));

  const t1004 = results.find(r => r.id === 'T1-004');
  check('real bug fixed: T1-004 now correctly passes when only "Financial Statements" exists (no AFS/IFS/Balance Sheet sheet)',
    t1004 && t1004.status === 'pass');

  const t1005 = results.find(r => r.id === 'T1-005');
  check('real bug fixed: T1-005 now correctly passes when only "Financial Statements" exists',
    t1005 && t1005.status === 'pass');
}

// ══════════════════════════════════════════════════════════════════
// Regression check: T1-005 must still correctly pass when only
// "Annual Cash Flow" exists (the original, already-working case via
// the word-boundary matching fix), confirming removing the risky
// "Cons" alias didn't break the case it was meant to serve.
// ══════════════════════════════════════════════════════════════════
{
  const sheetNames = ['Summary', 'Underwriting', 'Annual Cash Flow', 'DEBT'];
  const results = runTier1(makeParsed(sheetNames));
  const t1005 = results.find(r => r.id === 'T1-005');
  check('regression check: T1-005 still passes via "Annual Cash Flow" (word-boundary match), unaffected by removing "Cons"',
    t1005 && t1005.status === 'pass');
}

// ══════════════════════════════════════════════════════════════════
// Regression check: removing "Cons" from T1-005 must not silently
// break detection when a sheet is genuinely named exactly "Cons" or
// similar acceptable variants (AFS/IFS/Cash Flow still present).
// And a model with NONE of the valid sheets must still correctly fail.
// ══════════════════════════════════════════════════════════════════
{
  const sheetNames = ['Summary', 'Underwriting', 'Construction Timeline', 'DEBT'];
  const results = runTier1(makeParsed(sheetNames));
  const t1005 = results.find(r => r.id === 'T1-005');
  check('regression check: a model with NO genuine cash-flow-statement sheet still correctly fails T1-005 (confirms "Cons" removal didn\'t mask real absence, and doesn\'t falsely match "Construction Timeline")',
    t1005 && t1005.status === 'fail');
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
