'use strict';
// Patch 33 checks: remedy check, applicability record, registry approval and the verdict ceiling.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { buildRemedyWorkbook, remedyFindings, applicabilityResults } = require('./scripts/remedy-fixtures');
const { applyRemedyChecks, citationsWithFormulas, ARG_ROLES } = require('./src/utils/remedy-check');
const { markNotApplicable, buildApplicabilityRecord } = require('./src/utils/applicability-record');
const reg = require('./src/utils/output-registry');
const { isNotApplicableAbsence } = require('./src/utils/absence-policy');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };

(async () => {
  const { parseExcel } = require('./src/parser');
  const { runTier0 } = require('./src/validator-tier0');
  const parsed = await parseExcel(await buildRemedyWorkbook());
  const t0 = await runTier0(parsed);
  const f = remedyFindings();
  const summary = applyRemedyChecks(Object.values(f), { workbook: parsed._raw, cellScoreIndex: t0.cellScoreIndex });
  const st = k => f[k].remedy_check && f[k].remedy_check.status;

  // remedy check
  check('a remedy quoting the wrong formula for a cell is withheld', st('wrongCitation') === 'withheld' && /holds SUM\(AP10:AP37\)/.test(f.wrongCitation.fix_instruction));
  check('a remedy quoting the right formula is confirmed and left as written', st('rightCitation') === 'verified' && /change it to/.test(f.rightCitation.fix_instruction));
  check('a proposed new formula is not compared with the existing one', citationsWithFormulas('Change AP242 to `=SUM(A1:A2)`.', 'S')[0].kind === 'proposed');
  check('a cited cell that is empty is withheld', st('emptyCell') === 'withheld' && /empty/.test(f.emptyCell.remedy_check.reasons[0]));
  check('a negative OFFSET columns displacement described as a width is withheld', st('displacementAsWidth') === 'withheld' && /displacement/.test(f.displacementAsWidth.remedy_check.reasons[0]));
  check('a genuinely negative OFFSET width is not withheld', st('realNegativeWidth') === 'verified');
  check('OFFSET argument roles are parsed in order', ARG_ROLES.OFFSET[1] === 'rows displacement' && ARG_ROLES.OFFSET[2] === 'columns displacement' && ARG_ROLES.OFFSET[4] === 'width');
  check('a fix that only wraps the error is withheld', st('suppression') === 'withheld' && /cause/.test(f.suppression.fix_instruction));
  check('a fix that corrects the cause and says not to wrap it is not withheld', st('causeFix') !== 'withheld');
  check('a remedy with nothing checkable is left as written and counted unverified', st('plain') === 'unverified' && f.plain.fix_instruction === 'Review the formula.');
  check('the original wording is kept in the run data', f.wrongCitation.remedy_check.original.includes('=SUM(AP10:AP19)'));
  check('a withheld remedy is no longer offered as an automatic fix', f.wrongCitation.fixable === false);
  check('the summary counts every outcome', summary.checked === 8 && summary.withheld === 4 && summary.verified === 2 && summary.unverified === 2);
  check('the finding itself is never removed or re-rated', Object.values(f).length === 8 && Object.values(f).every(x => x.id === 'T2-X' && !x.severity_before_class));
  const again = applyRemedyChecks(Object.values(f), { workbook: parsed._raw, cellScoreIndex: t0.cellScoreIndex });
  check('running the check twice changes nothing', again.checked === 0);
  check('a missing workbook leaves findings untouched', applyRemedyChecks([{ fix_instruction: 'Wrap in IFERROR' }], {}).checked === 0);

  // applicability
  const a = applicabilityResults();
  const marked = markNotApplicable(Object.values(a));
  check('an absence the reviewer says does not apply becomes Not Applicable', marked.length === 1 && a.notApplicable.record_type === 'Not Applicable');
  check('a real absence is left alone', !a.realAbsence.record_type && !isNotApplicableAbsence(a.realAbsence));
  check('a fatal rule is never set aside this way', !a.fatalRule.record_type);
  check('a statement about the reviewer\'s own limits is not an applicability decision', !a.limitation.record_type);
  check('the procedure\'s status is not changed (coverage figures stay)', a.notApplicable.status === 'uncertain');
  const rec = buildApplicabilityRecord(Object.values(a), { sheetNames: ['Inputs', 'Saved Results'], hasVba: true });
  check('the record lists the reviewer\'s reason', rec[0].id === 'T2-S6-001' && /no borrowings/.test(rec[0].reason));
  check('a macro-refilled store is disclosed separately, as not tested', rec.some(r => r.decision === 'Freshness not tested' && /macros/.test(r.subject)));
  check('no macro disclosure without macros or without such a sheet', buildApplicabilityRecord([], { sheetNames: ['Saved Results'], hasVba: false }).length === 0 && buildApplicabilityRecord([], { sheetNames: ['Inputs'], hasVba: true }).length === 0);

  // registry approval
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reg33-'));
  const proposed = { status: 'proposed', model: 'M.xlsx', approved_by: null, approved_on: null, outputs: [{ sheet: 'S', row: 5, label: 'IRR' }] };
  check('no file gives no approval', reg.loadRegistryState('M.xlsx', dir).status === 'none');
  fs.writeFileSync(path.join(dir, 'm.proposed.json'), JSON.stringify(proposed));
  check('a draft is not an approval', reg.loadRegistryState('M.xlsx', dir).status === 'proposed' && reg.registryCeiling(reg.loadRegistryState('M.xlsx', dir)).capsTopTier);
  check('approval needs a name', (() => { try { reg.approveRegistry(proposed, { approvedBy: ' ', approvedOn: '2026-10-30' }); return false; } catch (e) { return /approver/.test(e.message); } })());
  check('approval needs a real date', (() => { try { reg.approveRegistry(proposed, { approvedBy: 'Mik', approvedOn: '30/10/2026' }); return false; } catch (e) { return /YYYY-MM-DD/.test(e.message); } })());
  check('an empty list cannot be approved', (() => { try { reg.approveRegistry({ outputs: [] }, { approvedBy: 'Mik', approvedOn: '2026-10-30' }); return false; } catch (e) { return /no outputs/.test(e.message); } })());
  const approved = reg.approveRegistry(proposed, { approvedBy: 'Mik Riazanov', approvedOn: '2026-10-30' });
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify(approved));
  const state = reg.loadRegistryState('M.xlsx', dir);
  check('an approved file gives approval, the approver and the date', state.status === 'approved' && state.approved_by === 'Mik Riazanov' && state.approved_on === '2026-10-30' && !reg.registryCeiling(state).capsTopTier);
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ ...approved, approved_by: '' }));
  check('a file marked approved with no approver is not an approval', reg.loadRegistryState('M.xlsx', dir).status === 'invalid');
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({ ...approved, approved_on: 'yesterday' }));
  check('a file marked approved with no real date is not an approval', reg.loadRegistryState('M.xlsx', dir).status === 'invalid');
  const script = spawnSync(process.execPath, ['scripts/approve-output-registry.js'], { encoding: 'utf8' });
  check('the approve script refuses to run without an approver', script.status === 2);

  // report: the ceiling lowers the top tier by one level and holds nothing
  const cl = JSON.parse(fs.readFileSync('config/checklist.json', 'utf8'));
  const allPass = [...(cl.tier1 || []), ...(cl.tier2 || [])].map(r => ({ id: r.id, status: 'pass' }));
  const verdictFor = (oreg, extra = {}) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rep33-'));
    const payload = {
      originalName: 't.xlsx', modelType: 't', modelIndustry: 't', modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['S'] },
      tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] }, overallAssessment: 'audit_complete', igReadiness: 97, igCommentary: 't',
      ruleResults: allPass, errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false }, namedRangeAudit: { applicable: false },
      formulaDeepDive: { applicable: false }, reasonableness: {}, duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
      crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings: [], reviewerApproved: true, outputRegistry: oreg, ...extra,
    };
    fs.writeFileSync(path.join(d, 'p.json'), JSON.stringify(payload));
    const b = spawnSync('python3', ['src/build_report.py', path.join(d, 'p.json'), path.join(d, 'o.xlsx')], { encoding: 'utf8', timeout: 180000 });
    if (b.status !== 0) return { error: String(b.stderr).slice(-300) };
    const py = 'import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1])\nt=[]\nfor ws in wb:\n  for r in ws.iter_rows():\n    for c in r:\n      if c.value is not None: t.append((ws.title,str(c.value)))\nprint("\\n".join(x[0]+"|"+x[1].replace("\\n"," ") for x in t))';
    const q = spawnSync('python3', ['-c', py, path.join(d, 'o.xlsx')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { text: q.stdout || '' };
  };
  const ok = verdictFor({ status: 'approved', approved_by: 'Mik Riazanov', approved_on: '2026-10-30', outputs: 12, file: 'm.json' });
  const none = verdictFor({ status: 'none', approved_by: null, approved_on: null, outputs: 0, file: null });
  const prop = verdictFor({ status: 'proposed', approved_by: null, approved_on: null, outputs: 12, file: 'm.proposed.json' });
  const legacy = verdictFor(null);
  if (ok.error || none.error || prop.error || legacy.error) { check('report builds under every registry state: ' + (ok.error || none.error || prop.error || legacy.error), false); }
  else {
    check('an approved list keeps the top tier', /Reliance-ready \u2014 transaction execution/.test(ok.text) && /approved by Mik Riazanov on 2026-10-30/.test(ok.text));
    check('no list lowers the top tier by one level and says why', !/Reliance-ready \u2014 transaction execution/.test(none.text) && /Reliance-ready \u2014 lender \/ investor review/.test(none.text) && /no approved list of priority outputs/.test(none.text));
    check('a draft list does not count as approved', !/Reliance-ready \u2014 transaction execution/.test(prop.text) && /nobody has approved it/.test(prop.text));
    check('the report is still produced when no list exists', none.text.length > 1000 && /Scope and Reliance/.test(none.text));
    check('a payload without the new field behaves as no approved list', !/Reliance-ready \u2014 transaction execution/.test(legacy.text));
    const withRec = verdictFor({ status: 'none' }, { applicabilityRecord: rec, remedyChecks: { checked: 8, verified: 2, withheld: 4, unverified: 2, details: summary.details } });
    check('the Scope tab shows the applicability record and the remedy check', !withRec.error && /APPLICABILITY RECORD/.test(withRec.text) && /no borrowings/.test(withRec.text) && /Freshness not tested/.test(withRec.text) && /4 withheld/.test(withRec.text));
  }

  // a Not Applicable record stays in the Issue Log but is not queued for remediation
  (() => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'na33-'));
    const mk = (id, rt, txt) => ({ id, sheet: 'S', cell: 'B2', severity: 'medium', status: 'uncertain', confidence: 60, record_type: rt, label: txt, condition: txt, reason: txt, corrective_action: 'FIXTEXT ' + id, fix_instruction: 'FIXTEXT ' + id, category: 'Structure', workstream: 'Structure', issue_type: 'x', root_cause: 'rc ' + id, urgency: 'Before next reliance', method: 'automated', needs_retest: false, escalation_flag: false, key_output_impact: 'No', model_risk: 'm', cause: 'c', consequence: 'q', criteria: 'k' });
    const payload = { originalName: 't.xlsx', modelType: 't', modelIndustry: 't', modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['S'] }, tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] }, overallAssessment: 'audit_complete', igReadiness: 97, igCommentary: 't', ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false }, namedRangeAudit: { applicable: false }, formulaDeepDive: { applicable: false }, reasonableness: {}, duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {}, crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings: [mk('T2-A-001', 'Not Applicable', 'No debt schedule was found'), mk('T2-A-002', 'Confirmed Finding', 'Subtotal counted twice')] };
    fs.writeFileSync(path.join(d, 'p.json'), JSON.stringify(payload));
    const b = spawnSync('python3', ['src/build_report.py', path.join(d, 'p.json'), path.join(d, 'o.xlsx')], { encoding: 'utf8', timeout: 180000 });
    const py = 'import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1])\nfor n in ("Issue Log","Remediation"):\n  ws=wb[n]; t=" ".join(str(c.value) for r in ws.iter_rows() for c in r if c.value is not None)\n  print(n,"T2-A-001" in t,"T2-A-002" in t)';
    const out = b.status === 0 ? spawnSync('python3', ['-c', py, path.join(d, 'o.xlsx')], { encoding: 'utf8' }).stdout : '';
    check('a Not Applicable record stays in the Issue Log', /Issue Log True True/.test(out));
    check('a Not Applicable record is not queued in Remediation, a confirmed finding is', /Remediation False True/.test(out));
  })();

  console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 33 checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL: ' + e.stack); process.exit(1); });
