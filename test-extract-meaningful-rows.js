const { extractMeaningfulRows } = require('./src/validator-tier2.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

function row(rowNum, obj) {
  const r = { ...obj };
  Object.defineProperty(r, '_rowNum', { value: rowNum, enumerable: false });
  return r;
}

// ══════════════════════════════════════════════════════════════════
// Real bug #1, found via the original forensic audit review: a
// balance sheet's "Cash" row (hard-coded to 0) and its "TOTAL CHECK"
// row got arbitrarily dropped by a positional cap, while unrelated
// numeric rows survived purely by coming first in sheet order.
// ══════════════════════════════════════════════════════════════════
{
  const rows = [];
  // 30 unrelated numeric rows that would normally fill the entire cap
  for (let i = 1; i <= 30; i++) rows.push(row(i, { label: `Line item ${i}`, val: i * 1000 }));
  // The critical rows, positioned late enough to be dropped by a naive cap
  rows.push(row(33, { label: 'Cash', val: 0 }));
  rows.push(row(45, { label: 'TOTAL EQUITY', val: 87000000 }));
  rows.push(row(52, { label: 'TOTAL CHECK', val: 0 }));

  const selected = extractMeaningfulRows(rows, 20);
  const survived = selected.map(r => r._excelRow);
  check('labeled priority rows: "Cash" row survives a 20-row cap despite 30 other numeric rows coming first',
    survived.includes(33));
  check('labeled priority rows: "TOTAL EQUITY" row survives', survived.includes(45));
  check('labeled priority rows: "TOTAL CHECK" row survives', survived.includes(52));
}

// ══════════════════════════════════════════════════════════════════
// Real bug #2, found via verifying a specific claim in the same
// forensic audit review: a model's own "MODEL STATUS: REVIEW
// REQUIRED" self-flag lives in a non-numeric row (pure text, no
// parseable number anywhere in it). The old composition put numeric
// rows first with a flat final slice, so if numeric rows alone
// reached the cap, non-numeric rows got zero room regardless of
// content — confirmed directly on a real file (all 20 survivors were
// numeric, none was the status row).
// ══════════════════════════════════════════════════════════════════
{
  const rows = [];
  // 25 unrelated numeric rows — more than enough to fill a 20-row cap alone
  for (let i = 1; i <= 25; i++) rows.push(row(i, { label: `Line item ${i}`, val: i * 500 }));
  // A non-numeric status row, positioned early but with no number in it at all
  rows.push(row(4, { col1: 'MODEL STATUS', col2: 'REVIEW REQUIRED' }));

  const selected = extractMeaningfulRows(rows, 20);
  const survived = selected.map(r => r._excelRow);
  check('non-numeric row reservation: a "MODEL STATUS: REVIEW REQUIRED" row survives even when 25 numeric rows alone exceed the cap',
    survived.includes(4));
}

// ══════════════════════════════════════════════════════════════════
// Confirm both fixes coexist correctly — a sheet with labeled
// priority numeric rows AND a non-numeric status row must keep both.
// ══════════════════════════════════════════════════════════════════
{
  const rows = [];
  for (let i = 1; i <= 30; i++) rows.push(row(i, { label: `Line item ${i}`, val: i * 1000 }));
  rows.push(row(33, { label: 'Cash', val: 0 }));
  rows.push(row(52, { label: 'TOTAL CHECK', val: 0 }));
  rows.push(row(60, { status: 'REVIEW REQUIRED' }));

  const selected = extractMeaningfulRows(rows, 20);
  const survived = selected.map(r => r._excelRow);
  check('both fixes coexist: labeled priority row ("Cash") and non-numeric status row both survive together',
    survived.includes(33) && survived.includes(60));
}

// ══════════════════════════════════════════════════════════════════
// The two-tier priority fix: found via checking a real 176-row sheet
// (DEBT) directly. A single-tier priority system still failed to
// surface a genuinely important row, because 75 rows matched the
// combined priority terms but only 12 matched the rare, specific
// return/covenant terms (dscr/yield/npv/irr) — the other 63 matched
// only common balance-sheet-integrity terms (cash/total/balance),
// whose sheer volume crowded out the rarer, more important rows under
// one shared cap.
// ══════════════════════════════════════════════════════════════════
{
  const rows = [];
  // Many common-term rows (would all match the LOW-priority tier)
  for (let i = 1; i <= 30; i++) rows.push(row(i, { label: `Total facility line ${i}`, val: i * 1000 }));
  // A rare, specific high-priority term buried late in iteration order
  rows.push(row(133, { label: 'Debt yield', val: -0.076 }));

  const selected = extractMeaningfulRows(rows, 20);
  const survived = selected.map(r => r._excelRow);
  check('two-tier priority fix: a rare high-priority term ("Debt yield") survives even when 30 common-term rows ("Total...") would otherwise crowd it out under a single shared cap',
    survived.includes(133));
}

// ══════════════════════════════════════════════════════════════════
// Confirms the fix correctly handles a label sharing a row with an
// unrelated value pair — the exact real pattern found ("Line fee" in
// columns A-B, "Debt yield" in columns J-K, same physical row).
// ══════════════════════════════════════════════════════════════════
{
  const rows = [];
  for (let i = 1; i <= 25; i++) rows.push(row(i, { label: `Line item ${i}`, val: i * 100 }));
  rows.push(row(50, { unrelatedLabel: 'Line fee', unrelatedVal: 0, priorityLabel: 'Debt yield', priorityVal: -0.05 }));

  const selected = extractMeaningfulRows(rows, 20);
  const survived = selected.map(r => r._excelRow);
  check('side-by-side label fix: a priority term is detected even when it is not the first string value on the row (an unrelated label appears first)',
    survived.includes(50));
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against the real files that motivated both
// fixes.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
const { parseWorkbook } = require('./src/parser.js');

(async () => {
  const realFile = '/mnt/user-data/uploads/The_Bend_Precinct_Model_26_7_2026_Investor_Ready_v6.xlsm';
  if (fs.existsSync(realFile)) {
    const parsed = await parseWorkbook(realFile);

    const fsRows = parsed.sheets['Financial Statements'];
    const fsSelected = extractMeaningfulRows(fsRows, 40);
    const fsSurvived = fsSelected.map(r => r._excelRow);
    check('end-to-end: real file — Financial Statements "Cash" (33), "TOTAL EQUITY" (45), and "TOTAL CHECK" (52) all survive',
      [33, 45, 52].every(n => fsSurvived.includes(n)));

    const idRows = parsed.sheets['INVESTOR DASHBOARD'];
    const idSelected = extractMeaningfulRows(idRows, 20);
    const idSurvived = idSelected.map(r => r._excelRow);
    check('end-to-end: real file — INVESTOR DASHBOARD "MODEL STATUS: REVIEW REQUIRED" (row 4) survives',
      idSurvived.includes(4));

    // Found via systematically checking all 13 audit-review defects
    // against a fresh run — DEBT, VALUATIONS, and INVESTOR ANALYTICS
    // all showed the same class of bug (key comparison-pair rows
    // dropped by the cap), confirmed here with the fix applied.
    const debtSelected = extractMeaningfulRows(parsed.sheets['DEBT'], 20);
    const debtSurvived = debtSelected.map(r => r._excelRow);
    check('end-to-end: real file — DEBT periodic "Debt yield" row (133, showing a real negative value) survives',
      debtSurvived.includes(133));

    const valSelected = extractMeaningfulRows(parsed.sheets['VALUATIONS'], 20);
    const valSurvived = valSelected.map(r => r._excelRow);
    check('end-to-end: real file — VALUATIONS both sides of the property-value-vs-DCF comparison (rows 8 and 12) survive together',
      valSurvived.includes(8) && valSurvived.includes(12));
    check('end-to-end: real file — VALUATIONS both sides of the NPV-vs-XNPV comparison (rows 44 and 45) survive together',
      valSurvived.includes(44) && valSurvived.includes(45));

    const iaSelected = extractMeaningfulRows(parsed.sheets['INVESTOR ANALYTICS'], 20);
    const iaSurvived = iaSelected.map(r => r._excelRow);
    check('end-to-end: real file — INVESTOR ANALYTICS DSCR summary (63, 64) and periodic (77) rows all survive',
      [63, 64, 77].every(n => iaSurvived.includes(n)));
  } else {
    console.log('SKIPPED: end-to-end real-file tests (files not present in this environment)');
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
