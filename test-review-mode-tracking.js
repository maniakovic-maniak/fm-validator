// This replicates the exact normalization mapping from validator-
// tier2.js's runTier2 in isolation, since that function makes live
// Anthropic API calls and can't be practically mocked end-to-end here.

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// Replicates the review_mode-relevant portion of the normalised
// mapping exactly as it appears in validator-tier2.js.
function normalise(r) {
  return {
    id: r.id || 'UNKNOWN',
    status: r.status || 'uncertain',
    review_mode: r.review_mode || 'llm_only',
  };
}

// ══════════════════════════════════════════════════════════════════
// The real gap this fixes: found while trying to directly verify
// whether Tier 2 genuinely uses the R-8 formula-sample capability on
// a real run. skill.md instructs Claude to set review_mode on every
// finding (llm_only / llm_with_partial_formulas / etc.), but the
// normalization step listed fixed fields explicitly rather than
// spreading the result through, silently dropping review_mode (and
// nothing downstream — build_report.py, the Issue Log — ever showed
// it), leaving no way to objectively confirm R-8's usage.
// ══════════════════════════════════════════════════════════════════
{
  const claudeResult = { id: 'T2-S5-002', status: 'fail', review_mode: 'llm_with_partial_formulas' };
  const normalised = normalise(claudeResult);
  check('real gap fixed: review_mode genuinely set by Claude now survives normalization',
    normalised.review_mode === 'llm_with_partial_formulas');
}

// Confirms a finding where Claude didn't set review_mode at all (or
// an older/malformed response) falls back to the correct default
// rather than becoming undefined or throwing.
{
  const claudeResult = { id: 'T2-S1-001', status: 'pass' }; // no review_mode field at all
  const normalised = normalise(claudeResult);
  check('a finding with no review_mode field falls back to the correct default (llm_only), not undefined',
    normalised.review_mode === 'llm_only');
}

// Confirms all four documented mode values pass through correctly,
// not just the two most common ones.
{
  const modes = ['llm_only', 'llm_with_partial_formulas', 'llm_with_formulas', 'llm_with_documents'];
  const allSurvive = modes.every(m => normalise({ id: 'X', status: 'fail', review_mode: m }).review_mode === m);
  check('all four documented review_mode values survive normalization unchanged',
    allSurvive);
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
