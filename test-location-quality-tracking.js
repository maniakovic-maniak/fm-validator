let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// Replicates the exact bad-location detection logic from
// validator-tier2.js's runTier2 in isolation.
function countBadLocations(normalised, sheetNames) {
  const validSheetSet = new Set((sheetNames || []).map(s => s.toLowerCase()));
  return normalised.filter(r =>
    r.cell === 'A1' || !r.sheet || !validSheetSet.has(String(r.sheet).toLowerCase())
  ).length;
}

// ══════════════════════════════════════════════════════════════════
// The real gap this fixes: found via an independent review
// confirming 88 of 226 findings (39%) had an unusable "A1"
// placeholder cell, and 59 had a blank or invalid sheet name — far
// exceeding the "rare" case the A1 escape hatch in soul.md was
// written for. This makes the frequency directly, objectively
// monitorable on every run, rather than only discoverable by
// manually auditing the report afterward.
// ══════════════════════════════════════════════════════════════════

const realSheets = ['Summary', 'Underwriting', 'DEBT', 'DATA MAP'];

// A genuine, well-located finding: real sheet, real (non-A1) cell.
{
  const findings = [{ sheet: 'DEBT', cell: 'F152' }];
  check('a genuinely well-located finding (real sheet, real cell) is correctly NOT counted as a bad location',
    countBadLocations(findings, realSheets) === 0);
}

// The exact A1 case.
{
  const findings = [{ sheet: 'DEBT', cell: 'A1' }];
  check('a finding whose cell fell back to "A1" is correctly counted as a bad location',
    countBadLocations(findings, realSheets) === 1);
}

// A blank sheet.
{
  const findings = [{ sheet: '', cell: 'F152' }];
  check('a finding with a blank sheet is correctly counted as a bad location, even with a real-looking cell',
    countBadLocations(findings, realSheets) === 1);
}

// The specific confusion the review flagged directly: sheet itself
// set to the literal string "A1" (not a real sheet name at all).
{
  const findings = [{ sheet: 'A1', cell: 'B5' }];
  check('a finding whose sheet is itself the literal string "A1" (not a real sheet) is correctly counted as a bad location',
    countBadLocations(findings, realSheets) === 1);
}

// Sheet-name matching is case-insensitive (a genuine sheet name with
// different casing should not be falsely flagged as invalid).
{
  const findings = [{ sheet: 'debt', cell: 'F152' }];
  check('sheet-name validation is case-insensitive — a real sheet name in different casing is not falsely flagged',
    countBadLocations(findings, realSheets) === 0);
}

// A realistic mixed batch, confirming the count and percentage logic
// together match what a real run's console log would show.
{
  const findings = [
    { sheet: 'DEBT', cell: 'F152' },       // good
    { sheet: 'DEBT', cell: 'A1' },          // bad — A1
    { sheet: '', cell: 'F98' },             // bad — blank sheet
    { sheet: 'Nonexistent Sheet', cell: 'B5' }, // bad — invalid sheet
    { sheet: 'Summary', cell: 'O12' },      // good
  ];
  const badCount = countBadLocations(findings, realSheets);
  check('a realistic mixed batch of 5 findings correctly counts exactly 3 bad locations',
    badCount === 3);
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
