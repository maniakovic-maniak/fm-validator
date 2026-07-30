const { sheetNameMatchesKeyword: matchTier0 } = require('./src/validator-tier0.js');
const { sheetNameMatchesKeyword: matchTier1 } = require('./src/validator-tier1.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real bug this fixes: found via a full-repo bug scan. tier0.js
// and tier1.js both define a function named sheetNameMatchesKeyword,
// intended to behave identically — but tier1.js's long-keyword branch
// (keyword.length > 6) checked both directions (sheet name contains
// keyword, OR keyword contains sheet name), while tier0.js's version
// only checked one direction. Fixed by aligning tier0.js to match.
// ══════════════════════════════════════════════════════════════════

// The exact real-world scenario this fix enables: a sheet named just
// "Debt" (short, abbreviated) should match the longer keyword "debt
// schedule" — only possible via the reverse direction (keyword
// contains sheet name), which tier0.js was missing before this fix.
check('real defect fixed: tier0.js now matches a short, abbreviated sheet name ("Debt") against a longer keyword ("debt schedule"), same as tier1.js already did',
  matchTier0('Debt', 'debt schedule') === true && matchTier1('Debt', 'debt schedule') === true);

// The two functions must now agree across a range of realistic cases,
// not just the one motivating scenario above.
const cases = [
  ['Balance Sheet', 'balance sheet'],       // exact match, long keyword
  ['Consolidated Balance Sheet Detail', 'balance sheet'], // sheet name contains keyword (the original, already-working direction)
  ['P&L', 'income statement'],              // genuinely unrelated — must NOT match either way
  ['Summary', 'operational dashboard'],     // genuinely unrelated
  ['Dashboard', 'operational dashboard'],   // short sheet name contained within a longer keyword
];
let allAgree = true;
for (const [sheet, kw] of cases) {
  const r0 = matchTier0(sheet, kw);
  const r1 = matchTier1(sheet, kw);
  if (r0 !== r1) {
    allAgree = false;
    console.log(`  MISMATCH: sheetNameMatchesKeyword("${sheet}", "${kw}") — tier0=${r0}, tier1=${r1}`);
  }
}
check('tier0.js and tier1.js now agree on every tested case (5 realistic sheet/keyword pairs, both matching and non-matching)',
  allAgree);

// Confirms the short-keyword path (<=6 chars, word-boundary regex —
// untouched by this fix) still works identically too, for completeness.
check('the untouched short-keyword (<=6 char) path still agrees between both files',
  matchTier0('Debt Schedule', 'Debt') === matchTier1('Debt Schedule', 'Debt') &&
  matchTier0('Construction Timeline', 'Cons') === matchTier1('Construction Timeline', 'Cons'));

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
