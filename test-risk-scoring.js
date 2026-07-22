const {
  scoreDecisionConsequence, scoreExposure, scorePropagation, scoreControlWeakness,
  computeRiskScore, assignRiskScores,
} = require('./src/utils/risk-scoring');

function run() {
  let allPass = true;

  // --- Decision consequence ---
  const dcCases = [
    [{ issue_type: 'Formula complexity', key_output_impact: 'Unknown' }, 2, 'baseline, no key-output hint, no specific impact'],
    [{ issue_type: 'DSCR lock-up not enforced', key_output_impact: 'Unknown' }, 4, 'key-output hint (debt/dscr), still unknown impact'],
    [{ issue_type: 'DSCR lock-up not enforced', key_output_impact: 'Equity distributions overstated' }, 5, 'key-output hint AND specific named impact -- capped at 5'],
    [{ issue_type: 'Number stored as text', key_output_impact: 'Total Revenue understated' }, 3, 'no key-output hint, but specific named impact'],
  ];
  for (const [f, expected, desc] of dcCases) {
    const got = scoreDecisionConsequence(f);
    const pass = got === expected;
    if (!pass) allPass = false;
    console.log(`${pass ? 'PASS' : 'FAIL'}: decision consequence - ${desc} (expected ${expected}, got ${got})`);
  }

  // --- Exposure ---
  const expCases = [
    [{ material_occurrence_count: 0 }, 1, 'zero occurrences'],
    [{ material_occurrence_count: 1 }, 2, 'one occurrence'],
    [{ material_occurrence_count: 5 }, 3, 'five occurrences'],
    [{ material_occurrence_count: 10 }, 4, 'ten occurrences'],
    [{ material_occurrence_count: 50 }, 5, 'fifty occurrences'],
    [{ occurrence_count: 10 }, 4, 'falls back to occurrence_count when material_occurrence_count absent'],
  ];
  for (const [f, expected, desc] of expCases) {
    const got = scoreExposure(f);
    const pass = got === expected;
    if (!pass) allPass = false;
    console.log(`${pass ? 'PASS' : 'FAIL'}: exposure - ${desc} (expected ${expected}, got ${got})`);
  }

  // --- Propagation ---
  const propCases = [
    [{ affected_sheets: [], affected_cells: [] }, 1, 'no sheets at all'],
    [{ affected_sheets: ['A'], affected_cells: ['A!1'] }, 1, 'one sheet, one cell'],
    [{ affected_sheets: ['A'], affected_cells: ['A!1', 'A!2'] }, 2, 'one sheet, multiple cells'],
    [{ affected_sheets: ['A', 'B'], affected_cells: ['A!1', 'B!1'] }, 3, 'two sheets'],
    [{ affected_sheets: ['A', 'B', 'C'], affected_cells: [] }, 4, 'three sheets'],
    [{ affected_sheets: ['A', 'B', 'C', 'D', 'E'], affected_cells: [] }, 5, 'five sheets'],
  ];
  for (const [f, expected, desc] of propCases) {
    const got = scorePropagation(f);
    const pass = got === expected;
    if (!pass) allPass = false;
    console.log(`${pass ? 'PASS' : 'FAIL'}: propagation - ${desc} (expected ${expected}, got ${got})`);
  }

  // --- Control weakness ---
  const cwCases = [
    [{ confidence: 95, needs_retest: false }, 2, 'high confidence, no retest needed'],
    [{ confidence: 95, needs_retest: true }, 3, 'high confidence, retest needed'],
    [{ confidence: 80, needs_retest: false }, 3, 'moderate confidence (70-84)'],
    [{ confidence: 65, needs_retest: false }, 4, 'lower confidence (below 70)'],
    [{ confidence: 65, needs_retest: true }, 5, 'lower confidence AND retest needed -- capped at 5'],
  ];
  for (const [f, expected, desc] of cwCases) {
    const got = scoreControlWeakness(f);
    const pass = got === expected;
    if (!pass) allPass = false;
    console.log(`${pass ? 'PASS' : 'FAIL'}: control weakness - ${desc} (expected ${expected}, got ${got})`);
  }

  // --- assignRiskScores: only Confirmed Finding gets scored ---
  const findings = [
    { record_type: 'Confirmed Finding', issue_type: 'DSCR lock-up not enforced', confidence: 65, material_occurrence_count: 10, affected_sheets: ['A','B','C'], needs_retest: true },
    { record_type: 'Query', issue_type: 'DSCR lock-up not enforced', confidence: 45 }, // must NOT be scored
    { record_type: 'Critical Query', confidence: 50 }, // must NOT be scored
  ];
  assignRiskScores(findings);
  const gatingPass = typeof findings[0].risk_weighted_total === 'number'
    && findings[1].risk_weighted_total === undefined
    && findings[2].risk_weighted_total === undefined;
  console.log(`${gatingPass ? 'PASS' : 'FAIL'}: assignRiskScores only scores record_type === 'Confirmed Finding'`);
  if (!gatingPass) allPass = false;
  console.log('  Confirmed Finding scores:', JSON.stringify({
    dc: findings[0].risk_decision_consequence, exp: findings[0].risk_exposure,
    prop: findings[0].risk_propagation, cw: findings[0].risk_control_weakness,
    total: findings[0].risk_weighted_total,
  }));

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}
run();
