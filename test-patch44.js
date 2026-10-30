'use strict';
// Patch 44: effective priority in shadow mode. It records what a consequence-based priority would be and changes nothing else.
const fs = require('fs'), os = require('os'), path = require('path');
const EP = require('./src/utils/effective-priority');
const { priorityOf } = require('./src/utils/master-findings');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };
const F = (o) => Object.assign({ id: 'X', record_type: 'Confirmed Finding', severity: 'high', dollar_impact: 'unquantified', key_output_impact: 'Unknown' }, o);

check('substantiated P2 stays P2', EP.effectivePriority(F({ dollar_impact: '-GBP 4.2m on 2027 revenue', key_output_impact: 'Yes' })).priority === 'P2');
check('substantiated critical stays P1', EP.effectivePriority(F({ severity: 'critical', dollar_impact: 'GBP 12m', key_output_impact: 'Yes' })).priority === 'P1');
check('a critical defect with no quantified consequence is Impact pending, not P1 and not dropped', EP.effectivePriority(F({ severity: 'critical' })).priority === 'Impact pending');
check('a key output named but not quantified is Impact pending', EP.effectivePriority(F({ key_output_impact: 'Yes' })).priority === 'Impact pending');
check('quantified but no stated key-output effect is P2 (material, contained)', EP.effectivePriority(F({ severity: 'critical', dollar_impact: 'GBP 0.3m', key_output_impact: 'No' })).priority === 'P2');
check('"unquantified - ..." and dashes count as not quantified', !EP.isQuantified(F({ dollar_impact: 'unquantified — structural' })) && !EP.isQuantified(F({ dollar_impact: '—' })) && !EP.isQuantified(F({ dollar_impact: '' })));
check('P3 stays P3', EP.effectivePriority(F({ severity: 'low' })).priority === 'P3');
check('Query, Critical Query, Observation and Not Applicable get no effective priority', ['Query', 'Critical Query', 'Observation', 'Not Applicable', 'False Positive'].every(t => EP.effectivePriority(F({ record_type: t })) === null));

// occurrence counts, propagation and an incomplete graph are not read
const a = EP.effectivePriority(F({ dollar_impact: 'GBP 1m', key_output_impact: 'Yes' }));
const b = EP.effectivePriority(F({ dollar_impact: 'GBP 1m', key_output_impact: 'Yes', occurrence_count: 1, affected_sheets: ['S'], dependency_graph_complete: false, distance_to_output: 9 }));
const c = EP.effectivePriority(F({ dollar_impact: 'GBP 1m', key_output_impact: 'Yes', occurrence_count: 500, affected_sheets: ['A', 'B', 'C', 'D', 'E', 'F'] }));
check('occurrence count, sheet spread, distance and graph completeness do not change the result', a.priority === b.priority && a.priority === c.priority);

// shadow: nothing but the effective fields changes
const fs1 = [F({ id: 'A', dollar_impact: 'GBP 1m', key_output_impact: 'Yes' }), F({ id: 'B' }), F({ id: 'C', record_type: 'Query' })];
const before = JSON.stringify(fs1.map(f => [f.id, f.record_type, f.severity, priorityOf(f)]));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p44-'));
const s = EP.runShadow(fs1, { runId: 'T-1' });
check('shadow run counts both views', s.total === 2 && s.differs === 1 && s.byEffective['Impact pending'] === 1);
check('record type, severity and today\'s priority are untouched', JSON.stringify(fs1.map(f => [f.id, f.record_type, f.severity, priorityOf(f)])) === before);
check('the finding carries the effective fields and whether they differ', fs1[0].effective_priority === 'P2' && fs1[0].effective_priority_differs === false && fs1[1].effective_priority_differs === true && fs1[2].effective_priority === undefined);
check('the comparison is saved on its own, not in the finding history', fs.existsSync(path.join(__dirname, 'data', 'shadow', 'effective-priority', 'T-1.json')));
try { fs.unlinkSync(path.join(__dirname, 'data', 'shadow', 'effective-priority', 'T-1.json')); } catch (_) {}
process.env.FM_EFFECTIVE_PRIORITY_SHADOW = 'off';
check('it can be switched off', EP.runShadow([F({})], { runId: 'T-2' }) === null);
delete process.env.FM_EFFECTIVE_PRIORITY_SHADOW;
check('the log line states that nothing changed in the report', /no change to this report/.test(EP.logLine(s)) && /1 of 2/.test(EP.logLine(s)));

// both entry points call it, after the risk scores, inside a try so a failure cannot affect the run
for (const f of ['server.js', 'index.js']) {
  const t = fs.readFileSync(path.join(__dirname, f), 'utf8');
  const i = t.indexOf('assignRiskScores(allFlagged);'), j = t.indexOf('runEffectivePriorityShadow(allFlagged');
  check(`${f} runs the shadow step after the risk scores, inside a try`, i > 0 && j > i && /try \{ const _ep = runEffectivePriorityShadow/.test(t));
}
// the report does not read the effective fields yet
const py = fs.readFileSync(path.join(__dirname, 'src', 'build_report.py'), 'utf8'), mf = fs.readFileSync(path.join(__dirname, 'src', 'utils', 'master-findings.js'), 'utf8');
check('build_report.py and master-findings.js do not use effective_priority yet (shadow only)', !/effective_priority/.test(py) && !/effective_priority/.test(mf));
console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 44 checks passed');
process.exit(fails ? 1 : 0);
