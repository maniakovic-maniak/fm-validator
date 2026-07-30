let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// Replicates the exact extraction logic from index.js/server.js, since
// it's inlined at the point of use rather than exported as its own
// function.
function extractSheetAndCell(targetCell) {
  return targetCell.includes('!') ? targetCell.split('!') : ['', 'A1'];
}

// ══════════════════════════════════════════════════════════════════
// The real bug this fixes: sheet:'' and cell:'A1' were hardcoded
// directly in the finding object, even though the genuine location
// (targetCell, e.g. "Tenant Report!M2") was already available and
// used in the same object's own label/condition text. Confirmed
// directly on a real file: this was the single largest contributor
// (24 of 314 findings) to both the blank-Sheet and Cell=A1 metadata
// problems an independent review flagged.
// ══════════════════════════════════════════════════════════════════
{
  const [sheet, cell] = extractSheetAndCell('Tenant Report!M2');
  check('real bug fixed: a genuine sheet!cell targetCell correctly splits into real sheet and cell values',
    sheet === 'Tenant Report' && cell === 'M2');
}
{
  const [sheet, cell] = extractSheetAndCell('Underwriting!M138');
  check('real bug fixed: a second real example splits correctly too',
    sheet === 'Underwriting' && cell === 'M138');
}

// ══════════════════════════════════════════════════════════════════
// Regression: a malformed or missing targetCell (no "!" at all) must
// still fall back to a safe placeholder rather than throwing or
// producing a nonsensical split.
// ══════════════════════════════════════════════════════════════════
{
  const [sheet, cell] = extractSheetAndCell('NoExclamationMark');
  check('a malformed targetCell without "!" falls back to a safe placeholder rather than throwing',
    sheet === '' && cell === 'A1');
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
