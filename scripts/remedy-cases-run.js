'use strict';
// Runs acceptance cases 15 and 16 and prints one JSON line. Called by acceptance-baseline.js.
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { buildRemedyWorkbook, remedyFindings, applicabilityResults } = require('./remedy-fixtures');
(async () => {
  const res = {};
  const { parseExcel } = require(path.join(ROOT, 'src/parser'));
  const { runTier0 } = require(path.join(ROOT, 'src/validator-tier0'));
  const { applyRemedyChecks } = require(path.join(ROOT, 'src/utils/remedy-check'));
  const parsed = await parseExcel(await buildRemedyWorkbook());
  const t0 = await runTier0(parsed);
  const f = remedyFindings();
  applyRemedyChecks(Object.values(f), { workbook: parsed._raw, cellScoreIndex: t0.cellScoreIndex });
  const st = k => f[k].remedy_check && f[k].remedy_check.status;
  const unsafeWithheld = st('wrongCitation') === 'withheld' && st('displacementAsWidth') === 'withheld' && st('suppression') === 'withheld';
  const safeKept = st('rightCitation') === 'verified' && st('realNegativeWidth') === 'verified' && st('causeFix') !== 'withheld' && st('plain') === 'unverified';
  res[15] = { status: unsafeWithheld && safeKept ? 'pass' : 'fail', note: `wrong cited cell ${st('wrongCitation')}, displacement-as-width ${st('displacementAsWidth')}, hide-the-error ${st('suppression')}; right citation ${st('rightCitation')}, real negative width ${st('realNegativeWidth')}` };

  const { markNotApplicable, buildApplicabilityRecord } = require(path.join(ROOT, 'src/utils/applicability-record'));
  const a = applicabilityResults();
  const marked = markNotApplicable(Object.values(a));
  const rec = buildApplicabilityRecord(Object.values(a), { sheetNames: ['Inputs', 'Saved Results'], hasVba: true });
  const onlyNA = marked.length === 1 && marked[0] === 'T2-S6-001';
  const realStays = !a.realAbsence.record_type && !a.fatalRule.record_type && !a.limitation.record_type;
  const macro = rec.find(r => /Freshness not tested/.test(r.decision));
  const noMacro = buildApplicabilityRecord([], { sheetNames: ['Inputs'], hasVba: true }).length === 0 && buildApplicabilityRecord([], { sheetNames: ['Saved Results'], hasVba: false }).length === 0;
  res[16] = { status: onlyNA && realStays && macro && noMacro ? 'pass' : 'fail', note: `not-applicable absence recorded (${marked.join(',') || 'none'}), real absence, fatal rule and limitation unchanged=${realStays}, macro-store freshness disclosed separately=${!!macro}` };
  console.log(JSON.stringify(res));
})().catch(e => { console.error(e.stack); process.exit(1); });
