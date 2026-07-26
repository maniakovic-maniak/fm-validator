const { resolveSheetName, resolveSheetNames, resolveAny } = require('./src/utils/sheet-resolver.js');

function run() {
  let allPass = true;
  const check = (desc, got, expected) => {
    const pass = JSON.stringify(got) === JSON.stringify(expected);
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)})`);
    if (!pass) allPass = false;
  };

  // Level 1 — exact match
  check('Level 1: exact match', resolveSheetName('Debt', ['Debt', 'Equity']), 'Debt');

  // Level 2 — case-insensitive
  check('Level 2: case-insensitive exact', resolveSheetName('debt', ['Debt', 'Equity']), 'Debt');
  check('Level 1 takes priority over Level 2: an exact-case match anywhere in the list wins over an earlier case-different one',
    resolveSheetName('Debt', ['debt', 'Debt']), 'Debt');

  // Level 3 — normalized (spaces/dashes/underscores/dots stripped)
  check('Level 3: dash stripped', resolveSheetName('Cash-Flow', ['Cashflow']), 'Cashflow');
  check('Level 3: underscore stripped', resolveSheetName('Cash_Flow', ['Cashflow']), 'Cashflow');
  check('Level 3: space stripped', resolveSheetName('Cash Flow', ['Cashflow']), 'Cashflow');
  check('Level 3: "&" is NOT stripped — a known, deliberate non-match', resolveSheetName('Sources and Uses', ['SOURCES & USES']), null);

  // Level 4 — startsWith / contains (normalized)
  check('Level 4: target is a prefix of the real sheet name', resolveSheetName('Sources', ['SOURCES & USES']), 'SOURCES & USES');
  check('Level 4: real sheet name is a prefix of the target', resolveSheetName('Debt Schedule Detail', ['Debt']), 'Debt');

  // No match at all
  check('no match returns null, not undefined or a false-y accident', resolveSheetName('Nonexistent', ['Debt', 'Equity']), null);

  // Guard clauses
  check('empty target returns null immediately', resolveSheetName('', ['Debt']), null);
  check('empty sheetNames list returns null', resolveSheetName('Debt', []), null);

  // ── The real bug, found via a real bug-scan run ──────────────────────────
  // The __BLANK__ sentinel string used to represent "blank name" was
  // itself a matchable value, so two different blank/whitespace-only
  // names could incorrectly resolve as equal to each other.
  check('a whitespace-only target against an actually-blank sheet name does NOT collide',
    resolveSheetName('   ', ['', 'Debt']), null);
  check('a whitespace-only target against a DIFFERENT whitespace-only sheet name does NOT collide',
    resolveSheetName('  ', ['   ', 'Debt']), null);
  check('a whitespace-only target against a normal sheet name still correctly finds no match',
    resolveSheetName(' ', ['Debt', 'Equity']), null);

  // resolveSheetNames (plural) and resolveAny still work correctly
  check('resolveSheetNames maps each target independently',
    resolveSheetNames(['Debt', 'Nonexistent', 'debt'], ['Debt', 'Equity']),
    ['Debt', null, 'Debt']);
  check('resolveAny returns the first candidate that matches',
    resolveAny(['Nonexistent', 'Debt', 'Equity'], ['Debt', 'Equity']),
    'Debt');
  check('resolveAny returns null when nothing matches',
    resolveAny(['Nonexistent1', 'Nonexistent2'], ['Debt', 'Equity']),
    null);

  // ── Real bugs found via a real production run (The Bend Precinct Model,
  // 26 7 2026) ──────────────────────────────────────────────────────────────
  // The old Level 4 (plain startsWith on the space-stripped string)
  // destroyed word boundaries entirely, causing two real, opposite-
  // direction failures on the same run.
  check('word-boundary fix: "Cons" no longer falsely matches "Construction Timeline" (confirmed still-active on a real run, despite an existing comment claiming this was already fixed)',
    resolveSheetName('Cons', ['Construction Timeline', 'Debt', 'Equity']), null);
  check('word-boundary fix: "Cash Flow" now correctly matches "Annual Cash Flow" (a genuine whole-word match not located at the start, which the old character-level startsWith missed entirely)',
    resolveSheetName('Cash Flow', ['Annual Cash Flow', 'Debt', 'Equity']), 'Annual Cash Flow');
  check('word-boundary fix: a single short whole word ("Debt") still matches a longer sheet name starting with it, same as before',
    resolveSheetName('Debt', ['Debt Schedule Detail']), 'Debt Schedule Detail');
  check('word-boundary fix: partial-word matches are still correctly rejected in the other direction too ("Structio" is not a whole word inside "Construction Timeline")',
    resolveSheetName('Structio', ['Construction Timeline']), null);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

run();
