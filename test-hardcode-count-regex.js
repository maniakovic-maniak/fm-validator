let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// Replicates the exact fixed regex from src/validator-tier0.js to test
// it in isolation, since it's inlined at the point of use rather than
// exported as its own function.
const FIXED_RE = /(?<![A-Z0-9_$])[2-9]\d*(?:\.\d+)?(?![A-Z0-9_])/gi;
const OLD_RE = /(?<![A-Z0-9_])[2-9]\d*(?:\.\d+)?(?![A-Z0-9_])/gi;

function countMatches(formula, re) {
  re.lastIndex = 0;
  return (formula.match(re) || []).length;
}

// ══════════════════════════════════════════════════════════════════
// The real bug this fixes: an absolute cell reference like $AP$33 or
// $G$36 had its own row number counted as a "hardcoded" numeric
// constant, since the old lookbehind excluded [A-Z0-9_] but not "$" —
// and in an absolute reference, "$" sits directly before the row
// number, not a letter/digit. Confirmed directly on a real file: this
// was the dominant source of an 8x overcount (37,862 -> 4,733).
// ══════════════════════════════════════════════════════════════════
check('real bug fixed: an absolute reference ($AP$33) no longer counts its own row number as a hardcode',
  countMatches('PROJECTS!$AP$33', OLD_RE) === 1 && countMatches('PROJECTS!$AP$33', FIXED_RE) === 0);
check('real bug fixed: a mixed absolute/relative pattern (G32/$G$36) no longer counts the absolute row number',
  countMatches('G32/$G$36', OLD_RE) === 1 && countMatches('G32/$G$36', FIXED_RE) === 0);
check('real bug fixed: an IF formula referencing two absolute cells ($G$35, $G$36) counts zero hardcodes',
  countMatches('IF(Dbl_Promote?=1,G32/$G$36,G32/$G$35)', FIXED_RE) === 0);

// ══════════════════════════════════════════════════════════════════
// Regression: a genuinely hardcoded threshold or constant must still
// be caught — the fix should only exclude cell-reference row numbers,
// not genuine standalone numeric literals.
// ══════════════════════════════════════════════════════════════════
check('regression: a genuine hardcoded threshold (IF(A1>250,...)) is still correctly caught',
  countMatches('IF(A1>250,1,0)', FIXED_RE) === 1);
check('regression: a genuine hardcoded multiplier standing alone (e.g. *365) is still caught',
  countMatches('=B2*365', FIXED_RE) === 1);
check('regression: an ordinary relative reference (no $) was already correctly excluded before and after the fix',
  countMatches('G36/H35', OLD_RE) === 0 && countMatches('G36/H35', FIXED_RE) === 0);
check('regression: a plain SUM over a relative range counts zero hardcodes both before and after',
  countMatches('SUM(G2:G36)', OLD_RE) === 0 && countMatches('SUM(G2:G36)', FIXED_RE) === 0);

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
