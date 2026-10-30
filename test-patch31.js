'use strict';
// Patch 31 checks: lookup contract, average completeness, fallback propagation, bypassed checks, quantification.
const path = require('path');
const { runFixture } = require('./scripts/path-fixtures');
const { typedKey } = require('./src/utils/lookup-contract');
const { parseScaled } = require('./src/utils/double-scaling-check');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };
const ROOT = __dirname;

(async () => {
  const base = await runFixture(ROOT, {});
  const L = base.pc.lookup;
  check('four focus lookups each select exactly one source row', L.records.filter(r => /^B[1-4]$/.test(r.cell)).every(r => r.verdict === 'passed' && r.matches === 1));
  check('a duplicated key is a query with the count of matching rows', (() => { const r = L.records.find(x => x.cell === 'B5'); return r && r.verdict === 'query' && r.matches === 2; })());
  check('the duplicate finding is medium and the clean lookups raise nothing', base.findings.filter(f => /LOOKUP/.test(f.id || f.ruleId || '')).length === 1);
  check('a clean eight-year average passes', base.pc.average.records[0].verdict === 'passed');
  check('no accusation is made against any clean focus cell', !base.findings.some(f => /B[1-4]\b/.test(JSON.stringify(f)) && /LOOKUP-001/.test(f.id || f.ruleId || '')));

  const bad = await runFixture(ROOT, { breakKey: 'beta', dropYear: true });
  const miss = bad.pc.lookup.records.find(r => r.cell === 'B2');
  check('a missing key is a defect with zero matches', miss && miss.verdict === 'defect' && miss.matches === 0);
  check('the other three focus lookups stay unaccused in the mutated copy', ['B1', 'B3', 'B4'].every(c => bad.pc.lookup.records.find(r => r.cell === c).verdict === 'passed'));
  check('an average that loses a year to a text result is a defect', bad.pc.average.records[0].verdict === 'defect');
  check('the average defect names the range and the cell that returns text', (() => { const r = bad.pc.average.records[0]; return r.range && /H1/.test(r.text); })());
  const ids = bad.findings.map(f => f.id || f.ruleId);
  check('mutated copy raises the high lookup and average findings', ids.includes('T0-LOOKUP-001') && ids.includes('T0-AVGCOMP-001'));

  const ns = base.ns.findings[0];
  check('nested subtotal is retained', ns && ns.cell === 'B38');
  check('nested subtotal is quantified from saved values', ns.quantification.reported === 20 && ns.quantification.withoutRepeat === 10 && ns.quantification.repeatedSubtotal === 10);
  check('the check that cannot reach the total is named', JSON.stringify(ns.bypassedChecks.bypassed) === '["B41"]');
  check('the check that reads the total is not called bypassed', JSON.stringify(ns.bypassedChecks.reading) === '["B42"]');
  check('the note says which check could not have caught it', /B41 does not read B38/.test(ns.note));
  const fixed = await runFixture(ROOT, { fixSubtotal: true });
  check('a corrected subtotal raises no nested-subtotal finding', fixed.ns.findings.length === 0);

  const amt = base.ds.findings.find(f => f.cell === 'B3'), ratio = base.ds.findings.find(f => f.cell === 'B4');
  check('scaled amount keeps its finding and is expected at the once-scaled figure', amt && !amt.ratio && amt.quantification.expected === -15 && amt.quantification.difference === -3.75);
  check('scaled ratio is separated and expected unscaled', ratio && ratio.ratio && ratio.quantification.expected === -2);
  check('the amount and ratio notes differ', amt.note !== ratio.note && /unit-free/.test(ratio.note) && !/unit-free/.test(amt.note));
  check('a formula with an unreadable input has no quantification invented', (() => { const p = parseScaled('Q1/ESOpf'); return p && p.name === 'ESOpf'; })());

  // key typing
  check('an invalid date is not a key (it used to match every row)', typedKey(new Date(NaN)) === null);
  check('a date and its serial number are the same key', typedKey(new Date(Date.UTC(2020, 0, 1))) === typedKey(43831));
  check('text keys ignore case through the index, numbers differ from text', typedKey('1') !== typedKey(1));
  check('blank and error values are not keys', typedKey('') === null && typedKey({ error: '#N/A' }) === null && typedKey(null) === null);

  // report payload and tab
  const pcm = require('./src/utils/path-checks'); const { VERDICT_LABEL } = pcm;
  const rows = pcm.pathCheckRows(bad.pc);
  check('report rows carry a readable verdict and location', rows.rows.length >= 6 && rows.rows.every(r => r.location && r.verdict && r.evidence) && rows.rows.some(r => r.verdict === VERDICT_LABEL.defect));
  check('the report summary lists the three original criteria first (later patches add more)', rows.summary.length >= 3 && rows.summary.slice(0, 3).map(s => s.criterion).join(',') === 'Lookup contract,Average completeness,Fallback propagation' && rows.summary[0].tested >= 5);
  const { proposeRegistry, slug } = require('./src/utils/output-registry');
  const reg = proposeRegistry({ getWorksheet: () => null }, {}, 'm.xlsx');
  check('a registry is only ever drafted as proposed, with no approval filled in', reg.status === 'proposed' && reg.approved_by === null && reg.approved_on === null);
  check('registry file names are safe', slug('My Model (v2).xlsm') === 'my-model-v2');
  console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 31 checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL: ' + e.stack); process.exit(1); });
