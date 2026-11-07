// Patch 56b: the RIIO skill layer must not depend on how the familiarisation call happens to word the model type.
const { loadDomainSkill } = require('./src/classifier');
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS: ' + n); } else { fail++; console.log('FAIL: ' + n + (extra ? ' -> ' + extra : '')); } };
const has = d => (d.layers || []).includes('skill-riio-pcfm.md');
const ESO_SHEETS = ['Cover', 'SystemOperator', 'NGESO (Scenarios)', 'Ofgem FD Forecast', 'RoRE', 'FinancialRatios'];
check('Fm-00060 wording still loads the layer', has(loadDomainSkill('infrastructure', 'electricity transmission system operation (regulated utility)')));
check('Fm-00061 wording loads the layer (text only)', has(loadDomainSkill('infrastructure', 'electricity system operator regulated utility')));
check('vague wording loads the layer when the sheets say Ofgem / RoRE', has(loadDomainSkill('infrastructure', 'energy utility', ESO_SHEETS)));
check('sheet name "RoRE" alone is enough', has(loadDomainSkill('infrastructure', 'utility', ['Inputs', 'RoRE'])));
check('an ordinary infrastructure model does not get the layer', !has(loadDomainSkill('infrastructure', 'toll road concession', ['Inputs', 'Debt', 'Returns'])));
check('a word inside another sheet name does not trigger it', !has(loadDomainSkill('infrastructure', 'toll road concession', ['Scorecard Summary', 'Core'])));
check('no sheet names passed behaves as before', !has(loadDomainSkill('infrastructure', 'toll road concession')));
check('main skill file is unchanged', loadDomainSkill('infrastructure', 'electricity system operator regulated utility').file === 'skill-infrastructure.md');

// ---- Part 2: the report names the procedures set aside as not applicable
const fs = require('fs'); const { execFileSync } = require('child_process');
const { summarizeScopeForReport } = require('./src/utils/rule-scope');
const record = { excluded: [
  { id: 'T2-S10-346', category: 'not_applicable', severity: 'high', finding: 'Not applicable to this model type: no waste collection, transfer, processing or disposal activity.' },
  { id: 'T2-S10-610', category: 'not_applicable', severity: 'high', finding: 'Not applicable to this model type: no toll road demand-risk assumptions present.' },
  { id: 'T1-008', category: 'not_applicable', severity: 'fatal', decision: 'Owner scope decision', finding: 'Found "FinancialStatements" but no row labelled with "Cash"' },
  { id: 'T2-S9-001', category: 'not_applicable', severity: 'low', preRun: true, decision: 'profile' },
  { id: 'T2-S9-002', category: 'extended_not_run', severity: 'low', preRun: true },
] };
const sum = summarizeScopeForReport(record, { fullScope: false, tier2ToRun: 5 }, { discloseInReport: true });
check('list holds the post-run not-applicable procedures only', sum.notApplicableList.length === 3 && !sum.notApplicableList.some(e => e.id === 'T2-S9-001'), JSON.stringify(sum.notApplicableList.map(e => e.id)));
check('count is unchanged (all not-applicable, pre-run included)', sum.notApplicable === 4, String(sum.notApplicable));
check('fatal-gate item is marked as an owner decision', sum.notApplicableList.find(e => e.id === 'T1-008').fatal === true && sum.notApplicableList.find(e => e.id === 'T1-008').ownerDecision === true);
const payload = {
  originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
  modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['A'] },
  tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
  overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
  ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
  namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
  duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
  crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings: [], scopeSummary: sum,
};
fs.writeFileSync('/tmp/test-p56b-payload.json', JSON.stringify(payload));
execFileSync('python3', ['src/build_report.py', '/tmp/test-p56b-payload.json', '/tmp/test-p56b-out.xlsx'], { cwd: __dirname });
const txt = execFileSync('python3', ['-c', `
import openpyxl
wb = openpyxl.load_workbook('/tmp/test-p56b-out.xlsx'); ws = wb['Scope and Reliance']
print('\\n'.join(str(c.value) for row in ws.iter_rows() for c in row if c.value))
`], { encoding: 'utf8' });
check('Scope tab names the reviewer-stated procedures with reasons', /Procedures the reviewer said do not apply/.test(txt) && /T2-S10-346: no waste collection/.test(txt) && /T2-S10-610: no toll road/.test(txt));
check('Scope tab shows the fatal-gate scope decision separately', /Fatal-gate checks set aside by scope decision/.test(txt) && /T1-008/.test(txt));
check('a pre-run profile exclusion is not listed by id', !/T2-S9-001/.test(txt));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
