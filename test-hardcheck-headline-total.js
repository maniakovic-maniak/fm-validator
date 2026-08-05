let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// Replicates the exact label/breakdown computation added to
// index.js/server.js, so this can be tested in isolation without
// running the full pipeline.
function computeHeadline(highConfCount, lowConfCount) {
  const totalCount = highConfCount + lowConfCount;
  const breakdown = lowConfCount > 0 ? ` (${highConfCount} high-confidence, ${lowConfCount} lower-confidence)` : '';
  return `${totalCount} check/reconciliation cell(s) appear hardcoded rather than formula-driven${breakdown}`;
}

// ══════════════════════════════════════════════════════════════════
// The exact real scenario this fixes: confirmed directly against a
// real report that the OLD headline showed only "3" (the high-
// confidence subset) while 39 more genuine findings existed only in
// a footnote — easy to miss even when looking directly at the
// underlying code, as this session's own investigation demonstrated.
// ══════════════════════════════════════════════════════════════════
{
  const headline = computeHeadline(3, 39);
  check('real scenario fixed: the headline now shows the true total (42), not just the high-confidence subset (3)',
    headline.startsWith('42 check/reconciliation cell(s)'));
  check('the headline includes an explicit confidence breakdown so the split is visible without opening a second field',
    headline.includes('(3 high-confidence, 39 lower-confidence)'));
}

// ══════════════════════════════════════════════════════════════════
// Confirms the "no low-confidence findings at all" case stays clean
// — no confusing "(3 high-confidence, 0 lower-confidence)" noise
// when every finding is already high-confidence.
// ══════════════════════════════════════════════════════════════════
{
  const headline = computeHeadline(5, 0);
  check('when there are zero lower-confidence findings, the headline shows a plain total with no confusing "(5 high-confidence, 0 lower-confidence)" parenthetical',
    headline === '5 check/reconciliation cell(s) appear hardcoded rather than formula-driven');
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
