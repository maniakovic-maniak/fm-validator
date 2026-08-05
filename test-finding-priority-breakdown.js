const { classifyPriority, computeFindingBreakdown, formatBreakdownLine } = require('./src/utils/finding-priority-breakdown.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// classifyPriority — must replicate build_report.py's own priority()
// exactly, since the console headline and the report itself must
// never disagree about what counts as what.
check('classifyPriority: a finding with no record_type and critical severity is P1',
  classifyPriority({ severity: 'critical' }) === 'P1');
check('classifyPriority: fatal severity is also P1',
  classifyPriority({ severity: 'fatal' }) === 'P1');
check('classifyPriority: high and medium severity are both P2',
  classifyPriority({ severity: 'high' }) === 'P2' && classifyPriority({ severity: 'medium' }) === 'P2');
check('classifyPriority: anything else (including no severity at all) falls to P3',
  classifyPriority({ severity: 'low' }) === 'P3' && classifyPriority({}) === 'P3');
check('classifyPriority: a Critical Query record_type overrides severity entirely',
  classifyPriority({ record_type: 'Critical Query', severity: 'critical' }) === 'Critical Query');
check('classifyPriority: an explicit "Confirmed Finding" record_type is treated the same as no record_type at all',
  classifyPriority({ record_type: 'Confirmed Finding', severity: 'high' }) === 'P2');

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: confirmed directly against a real
// report — 227 total blends 136 confirmed findings with 91 open
// questions (Query/Observation), with no way to tell them apart from
// the headline alone.
// ══════════════════════════════════════════════════════════════════
{
  const findings = [];
  for (let i = 0; i < 5; i++) findings.push({ severity: 'critical' });
  for (let i = 0; i < 101; i++) findings.push({ severity: 'high' });
  for (let i = 0; i < 4; i++) findings.push({ severity: 'low' });
  for (let i = 0; i < 26; i++) findings.push({ record_type: 'Critical Query' });
  for (let i = 0; i < 88; i++) findings.push({ record_type: 'Query' });
  for (let i = 0; i < 3; i++) findings.push({ record_type: 'Observation' });

  const bd = computeFindingBreakdown(findings);
  check('real defect fixed: the exact real report numbers (227 total) split into 136 confirmed / 91 open questions',
    bd.total === 227 && bd.confirmedCount === 136 && bd.openQuestionCount === 91);

  const line = formatBreakdownLine(bd);
  check('the formatted line includes both the confirmed and open-question breakdowns explicitly',
    line.includes('136 confirmed') && line.includes('91 open question') && line.includes('88 Query') && line.includes('3 Observation'));
}

// ══════════════════════════════════════════════════════════════════
// Confirms the "no open questions" case stays a plain total — not
// adding confusing "0 open questions" noise to a report where every
// finding is already a confirmed category.
// ══════════════════════════════════════════════════════════════════
{
  const findings = [{ severity: 'critical' }, { severity: 'high' }, { record_type: 'Critical Query' }];
  const bd = computeFindingBreakdown(findings);
  const line = formatBreakdownLine(bd);
  check('a run with zero open-question findings shows a plain total, not confusing "0 open questions" noise',
    line === '3 item(s) flagged');
}

// Confirms a genuinely empty findings array doesn't crash.
{
  const bd = computeFindingBreakdown([]);
  const line = formatBreakdownLine(bd);
  check('an empty findings array (a genuinely clean model) does not crash and shows a plain "0 item(s) flagged"',
    line === '0 item(s) flagged');
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
