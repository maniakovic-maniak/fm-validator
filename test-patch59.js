// Patch 59: confidence arrives as a percent inside a run; the measurement must read it as such.
const { lowConfidencePasses } = require('./src/utils/low-confidence-pass');
const sev = new Map([['T2-S2-009', 'critical'], ['T2-S5-007', 'critical'], ['T2-S5-001', 'high'], ['T2-S10-014', 'critical']]);
const rr = [
  { id: 'T2-S2-009', status: 'pass', confidence: 60 }, { id: 'T2-S5-007', status: 'pass', confidence: 65 },
  { id: 'T2-S5-001', status: 'pass', confidence: 82 }, { id: 'T2-S10-014', status: 'pass', confidence: 0.55 },
];
const s = lowConfidencePasses(rr, sev); let bad = 0;
const ck = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) bad++; };
ck('percent values are read as 0-1 (60 counts at <=0.6)', s.byBand[0.6].includes('T2-S2-009'));
ck('65 counts at <=0.65 but not <=0.6', s.byBand[0.65].includes('T2-S5-007') && !s.byBand[0.6].includes('T2-S5-007'));
ck('82 is not low', !s.byBand[0.7].includes('T2-S5-001'));
ck('values already on a 0-1 scale still work', s.byBand[0.6].includes('T2-S10-014'));
ck('counts: <=0.6 two, <=0.65 three, <=0.7 three', s.byBand[0.6].length === 2 && s.byBand[0.65].length === 3 && s.byBand[0.7].length === 3);
const before = JSON.stringify(rr); lowConfidencePasses(rr, sev); ck('input is not changed', JSON.stringify(rr) === before);
console.log(bad ? bad + ' failed' : '\n6 checks passed'); process.exit(bad ? 1 : 0);
