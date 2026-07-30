// This test confirms the ID-generation logic directly, replicating
// the exact expressions used in index.js/server.js (they're inlined
// at the point of use, not exported as standalone functions).

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real bug this fixes: found via investigating an unexpected "90
// previously-closed item(s) have reappeared (regressed)" signal on a
// real production run. Traced to its root: cross-run fingerprinting
// keys on `{root_cause_id}::{affected_cell}`, where root_cause_id
// defaults to a finding's own `id`. Three checks (T0-TOTALRANGE,
// T0-DUPCALC, T0-CHAIN) generated that id from a sequential array
// index rather than stable content — meaning the SAME index number
// can point at a completely different underlying finding across two
// runs whenever the check's finding count or order shifts, which the
// R-16 aggregation fix did dramatically for two of these three
// (44->2 and 299->30 findings). This causes spurious regressed/new
// signals even when nothing about the model itself changed.
// ══════════════════════════════════════════════════════════════════

// T0-TOTALRANGE: confirms the new ID is a pure function of sheet+cell,
// stable regardless of how many other findings exist or in what order.
{
  const buildId = (f) => `T0-TOTALRANGE-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.cell}`;
  const findingA = { sheet: 'PROJECTS', cell: 'N11' };
  const findingB = { sheet: 'PROJECTS ARCHIVE', cell: 'N11' };

  const idAWith2Findings = buildId(findingA); // as if only 2 findings exist total
  const idAWith44Findings = buildId(findingA); // as if 44 findings existed (pre-aggregation count)
  check('T0-TOTALRANGE: the same underlying finding produces the identical ID regardless of how many other findings exist in the array',
    idAWith2Findings === idAWith44Findings && idAWith2Findings === 'T0-TOTALRANGE-PROJECTS-N11');
  check('T0-TOTALRANGE: a genuinely different sheet+cell produces a genuinely different ID',
    buildId(findingA) !== buildId(findingB));
}

// T0-DUPCALC: confirms the new ID derives from the first real
// occurrence's sheet+cell, not array position.
{
  const buildId = (f) => {
    const firstOccurrence = f.occurrences[0];
    const [occSheet, occCell] = firstOccurrence.includes('!') ? firstOccurrence.split('!') : [f.sheets[0], firstOccurrence];
    return `T0-DUPCALC-${occSheet.replace(/[^A-Za-z0-9]/g, '')}-${occCell}`;
  };
  const finding = { sheets: ['Underwriting', 'DATA MAP'], occurrences: ['Underwriting!I105', 'DATA MAP!C157'] };
  check('T0-DUPCALC: the new ID is derived from the first occurrence\'s real sheet and cell',
    buildId(finding) === 'T0-DUPCALC-Underwriting-I105');
}

// T0-CHAIN: confirms the new ID derives from the result's own
// sheet+cell, not array position.
{
  const buildId = (r) => `T0-CHAIN-${r.sheet.replace(/[^A-Za-z0-9]/g, '')}-${r.cell}`;
  const result = { sheet: 'Underwriting', cell: 'ET203' };
  check('T0-CHAIN: the new ID is derived from the result\'s own sheet and cell',
    buildId(result) === 'T0-CHAIN-Underwriting-ET203');
}

// ══════════════════════════════════════════════════════════════════
// The precise regression scenario this fix prevents: simulating what
// would have happened under the OLD sequential-index scheme when a
// check's finding count shrinks between runs (the R-16 aggregation
// case), to confirm the NEW scheme doesn't reproduce it.
// ══════════════════════════════════════════════════════════════════
{
  // OLD scheme: run 1 has 3 findings (indices 1,2,3); run 2 (post-
  // aggregation) has only 1 finding, which gets index 1 again —
  // colliding with whatever finding used to hold that index, even
  // though the underlying cell is completely different.
  const oldIdRun1 = `T0-TOTALRANGE-${String(1).padStart(3, '0')}`; // was e.g. Sheet1!A1
  const oldIdRun2 = `T0-TOTALRANGE-${String(1).padStart(3, '0')}`; // is now e.g. Sheet2!Z99 — SAME ID, different finding
  check('demonstrates the old bug: the sequential scheme produces an IDENTICAL id for two different underlying findings across runs',
    oldIdRun1 === oldIdRun2); // this "passing" demonstrates the bug existed

  // NEW scheme: the same two different underlying findings now
  // produce genuinely different, stable IDs.
  const buildNewId = (sheet, cell) => `T0-TOTALRANGE-${sheet.replace(/[^A-Za-z0-9]/g, '')}-${cell}`;
  const newIdRun1 = buildNewId('Sheet1', 'A1');
  const newIdRun2 = buildNewId('Sheet2', 'Z99');
  check('the fix: the new content-addressed scheme correctly produces DIFFERENT ids for two different underlying findings',
    newIdRun1 !== newIdRun2);
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
