const { computeFamiliariserMaxTokens } = require('./src/familiariser.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real bug: the OLD formula (floor 12000, rate 250/sheet) meant
// 4000 + 32*250 = 12000 exactly, so the floor dominated for every
// model with 32 sheets or fewer — confirmed truncation failures on
// 24, 26, and 31-sheet real files all got the IDENTICAL 12000-token
// budget as a 13-sheet file, despite vastly more content to describe.
// The fix must give meaningfully more budget as sheet count grows
// across this exact range, not an identical number.
// ══════════════════════════════════════════════════════════════════

check('13 sheets gets a reasonable baseline budget', computeFamiliariserMaxTokens(13) >= 8000);
check('24 sheets (confirmed real failure point) gets MORE than the old flat 12000', computeFamiliariserMaxTokens(24) > 12000);
check('26 sheets (confirmed real failure point) gets MORE than the old flat 12000', computeFamiliariserMaxTokens(26) > 12000);
check('31 sheets (confirmed real failure point) gets MORE than the old flat 12000', computeFamiliariserMaxTokens(31) > 12000);

// The core regression check: budget must genuinely scale across the
// range that was failing, not stay flat.
const budget13 = computeFamiliariserMaxTokens(13);
const budget24 = computeFamiliariserMaxTokens(24);
const budget31 = computeFamiliariserMaxTokens(31);
check('regression fixed: a 31-sheet model gets a meaningfully larger budget than a 13-sheet model (the old formula gave them the identical 12000)',
  budget31 > budget13 + 5000);
check('budget increases monotonically with sheet count across the previously-flat range',
  budget13 < budget24 && budget24 < budget31);

// Sanity bounds — never below a sane minimum, never above the ceiling
// shared with Tier 2's own max_tokens.
check('never goes below a sane floor even for a tiny model', computeFamiliariserMaxTokens(1) >= 4000);
check('respects the 32000 ceiling even for a very large model', computeFamiliariserMaxTokens(200) === 32000);

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
