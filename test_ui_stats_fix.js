// Direct test of the p1Count/p2Count/p3Count/criticalQueryCount fix in
// server.js -- replicates the real logic to verify it correctly uses
// record_type instead of the old, disconnected f.priority check that
// never matched anything (that field was never set on JS-side objects).

const isConfirmed = f => (f.record_type || 'Confirmed Finding') === 'Confirmed Finding';
function computeStats(allFlagged) {
  const p1Count = allFlagged.filter(f => isConfirmed(f) && (f.severity === 'fatal' || f.severity === 'critical')).length;
  const p2Count = allFlagged.filter(f => isConfirmed(f) && (f.severity === 'high' || f.severity === 'medium')).length;
  const p3Count = allFlagged.filter(f => isConfirmed(f) && !['fatal','critical','high','medium'].includes(f.severity)).length;
  const criticalQueryCount = allFlagged.filter(f => f.record_type === 'Critical Query').length;
  const riskRating = `P1: ${p1Count} · P2: ${p2Count} · P3: ${p3Count}` +
    (criticalQueryCount > 0 ? ` · Critical Query: ${criticalQueryCount}` : '');
  return { p1Count, p2Count, p3Count, criticalQueryCount, riskRating };
}

let allPass = true;
function check(desc, pass) {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
}

// The exact real scenario this bug would have gotten wrong: a
// critical-severity Critical Query (e.g. T0-DSCRGATE at confidence
// 65-79, demoted by Tier 3's confidence rule) must NOT count as P1.
const scenario1 = [
  { severity: 'critical', record_type: 'Critical Query' },   // must NOT be P1
  { severity: 'critical', record_type: 'Confirmed Finding' }, // must be P1
];
const stats1 = computeStats(scenario1);
check('a critical-severity Critical Query is correctly excluded from p1Count (the actual real bug)',
  stats1.p1Count === 1 && stats1.criticalQueryCount === 1);
console.log('  ' + stats1.riskRating);

// The old bug's exact failure mode: f.priority was checked but never
// set -- confirm severity alone (without record_type) still can't
// wrongly inflate the count for a non-Confirmed-Finding record.
const scenario2 = [
  { severity: 'high', record_type: 'Observation' },   // must NOT be P2
  { severity: 'high', record_type: 'Query' },          // must NOT be P2
  { severity: 'high', record_type: 'Confirmed Finding' }, // must be P2
];
const stats2 = computeStats(scenario2);
check('Observation and Query with high severity are correctly excluded from p2Count',
  stats2.p2Count === 1);

// Backward compatibility: a finding with NO record_type at all
// (shouldn't happen post-Tier-1, but defensively) defaults to
// Confirmed Finding, matching build_report.py's own same default.
const scenario3 = [{ severity: 'critical' }]; // no record_type field
const stats3 = computeStats(scenario3);
check('a finding with no record_type at all defaults to Confirmed Finding (matches build_report.py behavior)',
  stats3.p1Count === 1);

// riskRating string omits Critical Query entirely when there are none
// (no misleading "Critical Query: 0" clutter).
const stats4 = computeStats([{ severity: 'high', record_type: 'Confirmed Finding' }]);
check('riskRating omits the Critical Query segment entirely when count is zero',
  !stats4.riskRating.includes('Critical Query'));

// The real simulated scenario from earlier in this session: 4 P1, 16
// Critical Query, 48% coverage -- riskRating must surface all of it,
// not just the 4 P1s.
const realScenario = [
  ...Array(4).fill({ severity: 'critical', record_type: 'Confirmed Finding' }),
  ...Array(16).fill({ severity: 'high', record_type: 'Critical Query' }),
  ...Array(30).fill({ severity: 'medium', record_type: 'Confirmed Finding' }),
];
const statsReal = computeStats(realScenario);
check('the real 4-P1/16-Critical-Query scenario from earlier this session is now correctly surfaced',
  statsReal.p1Count === 4 && statsReal.criticalQueryCount === 16 && statsReal.riskRating.includes('Critical Query: 16'));
console.log('  ' + statsReal.riskRating);

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
process.exit(allPass ? 0 : 1);
