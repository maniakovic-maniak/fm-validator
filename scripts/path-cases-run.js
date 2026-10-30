'use strict';
// Runs acceptance cases 10-14 on the synthetic fixtures and prints one JSON line. Called by acceptance-baseline.js.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { runFixture } = require('./path-fixtures');
(async () => {
  const res = {};
  const base = await runFixture(ROOT, {});
  const bad = await runFixture(ROOT, { breakKey: 'beta', dropYear: true });
  const L = base.pc.lookup.records;
  const focus = L.filter(r => /^B[1-4]$/.test(r.cell));
  const accuses = base.findings.some(f => /wrong (entity|row)/i.test(JSON.stringify(f)));
  res[10] = { status: focus.length === 4 && focus.every(r => r.verdict === 'passed') && !accuses ? 'pass' : 'fail', note: `${focus.length} focus lookups, ${focus.filter(r => r.verdict === 'passed').length} passed, wrong-entity wording ${accuses}` };
  const dup = L.find(r => r.cell === 'B5'), miss = bad.pc.lookup.records.find(r => r.cell === 'B2');
  res[11] = { status: dup && dup.verdict === 'query' && dup.matches === 2 && miss && miss.verdict === 'defect' && miss.matches === 0 ? 'pass' : 'fail', note: `duplicate ${dup && dup.verdict}/${dup && dup.matches}, missing ${miss && miss.verdict}/${miss && miss.matches}` };
  const av = bad.pc.average.records[0];
  res[12] = { status: base.pc.average.records[0].verdict === 'passed' && av && av.verdict === 'defect' ? 'pass' : 'fail', note: `clean ${base.pc.average.records[0].verdict}, with a text year ${av && av.verdict}` };
  const ns = base.ns.findings[0];
  res[13] = { status: ns && ns.quantification && ns.quantification.reported === 20 && ns.quantification.withoutRepeat === 10 && ns.bypassedChecks && JSON.stringify(ns.bypassedChecks.bypassed) === '["B41"]' ? 'pass' : 'fail', note: ns ? `reported ${ns.quantification && ns.quantification.reported}, without repeat ${ns.quantification && ns.quantification.withoutRepeat}, bypassed ${ns.bypassedChecks && ns.bypassedChecks.bypassed}` : 'not found' };
  const amt = base.ds.findings.find(f => f.cell === 'B3'), ratio = base.ds.findings.find(f => f.cell === 'B4');
  res[14] = { status: amt && ratio && !amt.ratio && ratio.ratio && amt.quantification.expected === -15 && ratio.quantification.expected === -2 ? 'pass' : 'fail', note: `amount expected ${amt && amt.quantification.expected}, ratio expected ${ratio && ratio.quantification.expected}` };
  console.log(JSON.stringify(res));
})().catch(e => { console.error(e.stack); process.exit(1); });
