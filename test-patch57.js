// Patch 57: the low-confidence-Pass measurement is read-only (shadow).
const { lowConfidencePasses, summaryLine } = require('./src/utils/low-confidence-pass');
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS: ' + n); } else { fail++; console.log('FAIL: ' + n + (extra ? ' -> ' + extra : '')); } };
const sev = new Map([['T2-S2-009', 'critical'], ['T2-S5-001', 'high'], ['T2-S9-004', 'medium'], ['T1-008', 'fatal'], ['T2-S6-003', 'fatal']]);
const rr = [
  { id: 'T2-S2-009', status: 'pass', confidence: 0.6 }, { id: 'T2-S5-001', status: 'pass', confidence: 0.68 },
  { id: 'T2-S9-004', status: 'pass', confidence: 0.5 },        // medium: ignored
  { id: 'T1-008', status: 'pass', confidence: 0.5 },           // Tier 1 deterministic: ignored
  { id: 'T2-S6-003', status: 'fail', confidence: 0.5 },        // not a Pass: ignored
  { id: 'T2-S1-001', status: 'pass', confidence: null },       // unknown severity: ignored
];
const s = lowConfidencePasses(rr, sev);
check('only Tier 2 critical/high/fatal Pass results are counted', s.totalHighSeverityPasses === 2, JSON.stringify(s));
check('bands count results at or below each confidence', s.byBand[0.6].length === 1 && s.byBand[0.65].length === 1 && s.byBand[0.7].length === 2);
check('the listed ids are those at or below 0.6', JSON.stringify(s.ids) === '["T2-S2-009"]');
check('the summary says shadow and no change to this report', /shadow, no change to this report/.test(summaryLine(s)));
check('nothing to report gives no line', summaryLine(lowConfidencePasses([], sev)) === null);
const before = JSON.stringify(rr); lowConfidencePasses(rr, sev);
check('the results are not changed', JSON.stringify(rr) === before);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
