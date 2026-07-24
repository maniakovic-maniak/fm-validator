const { normalizeModelIdentity } = require('./src/utils/finding-history.js');

function run() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ── The exact real case that motivated this fix — found via a real
  // production run where "Financial_Model_The_Bend_12_7_2026.xlsx" and
  // "Financial_Model_The_Bend_13_7_2026_Audited.xlsx" (genuinely the
  // same underlying model, one day and one audit pass apart) were
  // tracked as two completely unrelated models, always showing "First
  // run for this model" regardless of real prior runs. ──
  const a = normalizeModelIdentity('Financial_Model_The_Bend_12_7_2026.xlsx');
  const b = normalizeModelIdentity('Financial_Model_The_Bend_13_7_2026_Audited.xlsx');
  check('the exact real motivating case now normalizes to the same identity', a === b);
  console.log(`  both normalize to: "${a}"`);

  // ── Common real-world revision/versioning patterns ──
  check('a _v2 suffix normalizes the same as no suffix',
    normalizeModelIdentity('Model_v2.xlsx') === normalizeModelIdentity('Model.xlsx'));
  check('a (1) copy suffix normalizes the same',
    normalizeModelIdentity('Model (1).xlsx') === normalizeModelIdentity('Model.xlsx'));
  check('a _Draft vs _Final pair normalizes the same',
    normalizeModelIdentity('Model_Draft.xlsx') === normalizeModelIdentity('Model_Final.xlsx'));
  check('a hyphenated date format normalizes the same as underscore-separated',
    normalizeModelIdentity('Model_2026-07-13.xlsx') === normalizeModelIdentity('Model_13_7_2026.xlsx'));
  check('a period-separated date format normalizes the same',
    normalizeModelIdentity('Model.13.7.2026.xlsx') === normalizeModelIdentity('Model_13_7_2026.xlsx'));
  check('an .xlsm extension normalizes the same as .xlsx for an otherwise-identical name',
    normalizeModelIdentity('Model_13_7_2026.xlsm') === normalizeModelIdentity('Model_13_7_2026.xlsx'));
  check('multiple stacked revision markers all get stripped (_Audited_v2_Final)',
    normalizeModelIdentity('Model_Audited_v2_Final.xlsx') === normalizeModelIdentity('Model.xlsx'));

  // ── Case-insensitivity ──
  check('case differences do not affect the identity',
    normalizeModelIdentity('MODEL_AUDITED.xlsx') === normalizeModelIdentity('model_audited.xlsx'));

  // ── Genuinely different models must NOT collide — this is the real,
  // acknowledged tradeoff of any filename-heuristic approach, and the
  // check list here is deliberately conservative to keep this risk low. ──
  check('two genuinely different real models (Carlsberg vs The Bend) do NOT collide',
    normalizeModelIdentity('CarlsbergFinancialModel_1.xlsm') !== normalizeModelIdentity('Financial_Model_The_Bend_13_7_2026.xlsx'));
  check('two different real projects with superficially similar structure do NOT collide',
    normalizeModelIdentity('Hidden_Gem_Base_Case.xlsm') !== normalizeModelIdentity('The_Bend_David_Gifford.xlsx'));
  check('two models differing only in a genuine, non-revision word do NOT collide',
    normalizeModelIdentity('Model_North.xlsx') !== normalizeModelIdentity('Model_South.xlsx'));

  // ── Robustness ──
  check('an empty or missing filename does not throw, and returns a usable (if empty) string',
    typeof normalizeModelIdentity('') === 'string' && typeof normalizeModelIdentity(undefined) === 'string');
  check('a filename that normalizes to nothing meaningful falls back to the raw lowercased filename rather than an empty string',
    normalizeModelIdentity('2026_07_13.xlsx').length > 0);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

run();
