const { classifyRecordType, assignRecordTypes } = require('./src/utils/record-type-classifier');

function run() {
  const cases = [
    // [description, finding, expected]
    ['explicit record_type is always respected', { record_type: 'False Positive', confidence: 100, severity: 'critical' }, 'False Positive'],
    ['informational urgency -> Observation', { urgency: 'Informational', confidence: 30, severity: 'low' }, 'Observation'],
    ['low confidence, no key-output hint -> Query', { confidence: 45, severity: 'medium', issue_type: 'Formula complexity' }, 'Query'],
    ['low confidence, valuation-adjacent -> Critical Query', { confidence: 45, severity: 'medium', issue_type: 'Valuation divergence' }, 'Critical Query'],
    ['low confidence, debt-adjacent via root_cause -> Critical Query', { confidence: 50, severity: 'high', root_cause: 'DSCR lock-up not enforced' }, 'Critical Query'],
    ['high confidence, real severity -> Confirmed Finding', { confidence: 80, severity: 'high' }, 'Confirmed Finding'],
    ['high confidence, low severity -> Confirmed Finding', { confidence: 100, severity: 'low' }, 'Confirmed Finding'],
    ['no severity, high confidence -> Observation (fallback)', { confidence: 90 }, 'Observation'],
    // Tier 3: P1-severity confidence demotion — the memo's evidence-quality
    // principle applied to the P1 tier specifically
    ['critical severity at marginal confidence (60-79) -> Critical Query, NOT P1-eligible', { confidence: 65, severity: 'critical' }, 'Critical Query'],
    ['fatal severity at marginal confidence -> Critical Query', { confidence: 70, severity: 'fatal' }, 'Critical Query'],
    ['critical severity at strong confidence (80+) -> Confirmed Finding', { confidence: 80, severity: 'critical' }, 'Confirmed Finding'],
    ['high severity at the same marginal confidence stays Confirmed Finding (demotion is scoped to fatal/critical only)', { confidence: 65, severity: 'high' }, 'Confirmed Finding'],
  ];

  let allPass = true;
  for (const [desc, finding, expected] of cases) {
    const got = classifyRecordType(finding);
    const pass = got === expected;
    if (!pass) allPass = false;
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc} (expected ${expected}, got ${got})`);
  }

  // assignRecordTypes mutates an array in place
  const arr = [{ confidence: 90, severity: 'high' }, { confidence: 30, severity: 'medium' }];
  assignRecordTypes(arr);
  const mutPass = arr[0].record_type === 'Confirmed Finding' && arr[1].record_type === 'Query';
  console.log(`${mutPass ? 'PASS' : 'FAIL'}: assignRecordTypes mutates array in place correctly`);
  if (!mutPass) allPass = false;

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}
run();
