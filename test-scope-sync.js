#!/usr/bin/env node
// test-scope-sync.js - proves the platform layers agree about scope and completion.
//
// Run:  node test-scope-sync.js        (also run by scripts/pre-deploy-check.js)
//
// What it guards, in plain terms:
//   1. Config: every rule id named in a scope config exists, sits in exactly one category, and no fatal rule is
//      scoped out by a rule that does not allow it.
//   2. Scope plan: the pre-run plan removes what it should for a regulated-network model, nothing for an unrelated
//      one, nothing extended on a cold start or in a full review, and never a fatal/critical/high rule as "extended".
//   3. Exclusion engine: pre-run exclusions and post-run exclusions end up in ONE record with categories.
//   4. Completion: src/utils/rule-scope.js (server) and src/completion.py (report) return identical figures.
//   5. Payload: every key server.js hands to the report builder is actually read by report-tab.js, so a new field
//      can no longer be dropped silently between the two.
//   6. Tier 1: T1-006/T1-008 find the right sheet and ignore look-alike rows; T1-017 reads the real calc settings.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const checklist = require('./config/checklist.json');
const exclCfg = require('./config/rule-exclusions.json');
const scopeCfg = require('./config/rule-scope.json');
const { applyRuleExclusions } = require('./src/utils/rule-exclusions');
const scope = require('./src/utils/rule-scope');

let passed = 0;
const quiet = () => {};
function test(name, fn) {
  try { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => { passed++; console.log(`  ok  ${name}`); }); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

const byId = new Map([...checklist.tier1, ...checklist.tier2].map(r => [r.id, r]));
const INFRA = 'skill-infrastructure.md';
const REGULATED = 'electricity transmission system operator riio price control';
const seedHistory = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'rule-history-seed', 'infrastructure.json'), 'utf8'));
const tieringCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'rule-tiering.json'), 'utf8'));
const plan = (extra = {}) => scope.buildScopePlan(Object.assign({
  checklist, domainFile: INFRA, modelText: REGULATED, runKey: 'test', log: quiet,
  configs: { exclusions: exclCfg, scope: scopeCfg, tiering: tieringCfg, history: seedHistory }
}, extra));

(async () => {
  console.log('Config');
  test('every scoped rule id exists in checklist.json', () => {
    const ids = [...scopeCfg.evidenceRequired.ruleIds];
    for (const p of exclCfg.profiles) for (const t of Object.values(p.tiers)) if (t.ruleIds) ids.push(...t.ruleIds);
    const missing = ids.filter(i => !byId.has(i));
    assert.deepStrictEqual(missing, [], `unknown rule ids: ${missing.join(', ')}`);
  });
  test('no rule id sits in two scope categories', () => {
    const seen = new Map();
    const add = (id, where) => { if (seen.has(id)) throw new Error(`${id} is in both ${seen.get(id)} and ${where}`); seen.set(id, where); };
    scopeCfg.evidenceRequired.ruleIds.forEach(i => add(i, 'evidenceRequired'));
    for (const p of exclCfg.profiles) for (const [n, t] of Object.entries(p.tiers)) (t.ruleIds || []).forEach(i => add(i, `${p.id}/${n}`));
  });
  test('no fatal rule is in evidenceRequired unless allowed', () => {
    if (scopeCfg.evidenceRequired.allowFatal) return;
    const fatal = scopeCfg.evidenceRequired.ruleIds.filter(i => byId.get(i).severity === 'fatal');
    assert.deepStrictEqual(fatal, []);
  });

  console.log('Scope plan');
  const eso = plan();
  const cat = (p, c) => p.preExcluded.filter(x => x.category === c).map(x => x.id);
  test('regulated model: scope decisions + evidence + extended are removed before the run', () => {
    const na = cat(eso, 'not_applicable');
    // every enabled tier that names rule ids; a fatal rule only counts where its tier allows fatal
    const expected = Object.values(exclCfg.profiles[0].tiers)
      .filter(t => t.enabled && Array.isArray(t.ruleIds))
      .flatMap(t => t.ruleIds.filter(i => i.startsWith('T2-') && (byId.get(i).severity !== 'fatal' || t.allowFatal === true)));
    assert.deepStrictEqual(na.sort(), expected.sort());
    assert.deepStrictEqual(cat(eso, 'evidence_required').sort(), [...scopeCfg.evidenceRequired.ruleIds].sort());
    assert.ok(cat(eso, 'extended_not_run').length > 0, 'expected an extended tier from the seeded history');
  });
  test('extended tier never contains a fatal, critical or high rule, or a rule that has concluded before', () => {
    for (const id of cat(eso, 'extended_not_run')) {
      assert.ok(!['fatal', 'critical', 'high'].includes(byId.get(id).severity), `${id} is ${byId.get(id).severity}`);
      assert.ok(!(seedHistory.rules[id] && seedHistory.rules[id].concluded > 0), `${id} has concluded before`);
    }
  });
  test('skipRuleIds only ever holds Tier 2 ids', () => {
    for (const id of eso.skipRuleIds) assert.ok(id.startsWith('T2-'), id);
  });
  test('unrelated infrastructure model: no not-applicable removals', () => {
    const p = plan({ modelText: 'toll road concession project finance' });
    assert.strictEqual(cat(p, 'not_applicable').length, 0);
    assert.strictEqual(cat(p, 'evidence_required').length, scopeCfg.evidenceRequired.ruleIds.length);
  });
  test('full review: nothing extended, scope decisions still apply', () => {
    const p = plan({ fullScope: true });
    assert.strictEqual(cat(p, 'extended_not_run').length, 0);
    assert.ok(cat(p, 'not_applicable').length > 0);
  });
  test('cold start (fewer than minRunsBeforeTiering runs): nothing extended', () => {
    const p = plan({ configs: { exclusions: exclCfg, scope: scopeCfg, tiering: tieringCfg, history: { runs: 1, rules: {} } } });
    assert.strictEqual(cat(p, 'extended_not_run').length, 0);
  });
  test('no history at all (new model type): nothing extended', () => {
    const p = plan({ domainFile: 'skill-newdomain.md', configs: { exclusions: exclCfg, scope: scopeCfg, tiering: tieringCfg, history: null } });
    assert.strictEqual(cat(p, 'extended_not_run').length, 0);
  });
  test('skip-share limit protects against over-trimming', () => {
    const p = plan({ configs: { exclusions: exclCfg, scope: Object.assign({}, scopeCfg, { limits: { maxSkipShareOfTier2: 0.01 } }), tiering: tieringCfg, history: seedHistory } });
    assert.strictEqual(cat(p, 'extended_not_run').length, 0);
  });

  console.log('Same model, different domain skill (Fm-00036)');
  test('the regulated-network scope decisions follow the model description, not the domain skill the classifier picked', () => {
    const desc = 'corporate - electricity transmission system operation (UK energy regulation)';
    for (const skill of ['skill-infrastructure.md', 'skill-generic.md', 'skill-corporate.md']) {
      const p = plan({ domainFile: skill, modelText: desc, configs: { exclusions: exclCfg, scope: scopeCfg, tiering: tieringCfg, history: null } });
      assert.ok(cat(p, 'not_applicable').length > 0, `${skill}: scope decisions were not applied`);
    }
  });
  test('an unrelated model is not caught by that profile under any domain skill', () => {
    for (const skill of ['skill-infrastructure.md', 'skill-generic.md']) {
      const p = plan({ domainFile: skill, modelText: 'three-statement model for a retail chain', configs: { exclusions: exclCfg, scope: scopeCfg, tiering: tieringCfg, history: null } });
      assert.strictEqual(cat(p, 'not_applicable').length, 0, skill);
    }
  });
  test('a profile without appliesToAnyDomainSkill still needs its own domain skill', () => {
    const cfg = { profiles: [{ id: 'x', appliesToDomainSkill: 'skill-mining.md', matchAny: ['quarry'], tiers: {} }] };
    assert.strictEqual(require('./src/utils/rule-exclusions').matchProfile(cfg, 'skill-generic.md', 'a quarry'), null);
    assert.ok(require('./src/utils/rule-exclusions').matchProfile(cfg, 'skill-mining.md', 'a quarry'));
  });

  console.log("Trigger preconditions (a procedure whose own instruction starts 'Trigger:')");
  const GENERIC = 'skill-generic.md';
  const pre = (facts, extra = {}) => plan(Object.assign({ domainFile: GENERIC, modelText: 'corporate valuation', facts }, extra));
  const preIds = p => p.preExcluded.filter(x => x.tier === 'P_precondition_absent').map(x => x.id).sort();
  test('config names only Tier 2 rules that exist, each with a trigger in its own instruction', () => {
    for (const r of scopeCfg.preconditions.rules) for (const id of r.ruleIds) {
      assert.ok(byId.has(id), `unknown rule ${id}`);
      assert.ok(/^\s*Trigger:/i.test(byId.get(id).fix_instruction || ''), `${id} has no Trigger: in its instruction`);
    }
  });
  test('no SavedResults sheet, no OFFSET, no calculation-manipulating macro: both RIIO procedures leave the plan', () => {
    const p = pre({ sheetNames: ['Valuation', 'Assumptions'], offsetCount: 0, vbaManipulatesCalculation: false });
    assert.deepStrictEqual(preIds(p), ['T2-S10-788', 'T2-S10-789']);
    assert.ok(p.skipRuleIds.has('T2-S10-788') && p.skipRuleIds.has('T2-S10-789'));
    assert.ok(p.preExcluded.filter(x => x.tier === 'P_precondition_absent').every(x => x.category === 'not_applicable' && x.reason));
  });
  test('OFFSET formulas keep both procedures; a SavedResults sheet or a calc-manipulating macro keeps 788 only', () => {
    assert.deepStrictEqual(preIds(pre({ sheetNames: ['A'], offsetCount: 354, vbaManipulatesCalculation: false })), []);
    assert.deepStrictEqual(preIds(pre({ sheetNames: ['A', 'SavedResults'], offsetCount: 0, vbaManipulatesCalculation: false })), ['T2-S10-789']);
    assert.deepStrictEqual(preIds(pre({ sheetNames: ['A'], offsetCount: 0, vbaManipulatesCalculation: true })), ['T2-S10-789']);
  });
  test('facts that could not be read keep the procedures in scope', () => {
    assert.deepStrictEqual(preIds(pre(null)), []);
    assert.deepStrictEqual(preIds(pre({ sheetNames: ['A'] })), []);          // offsetCount and vba unknown
  });
  test('the precondition applies to every domain and can be switched off', () => {
    const facts = { sheetNames: ['A'], offsetCount: 0, vbaManipulatesCalculation: false };
    assert.deepStrictEqual(preIds(plan({ facts })), ['T2-S10-788', 'T2-S10-789']);   // ESO-type domain too
    const off = Object.assign({}, scopeCfg, { preconditions: Object.assign({}, scopeCfg.preconditions, { enabled: false }) });
    assert.deepStrictEqual(preIds(plan({ facts, configs: { exclusions: exclCfg, scope: off, tiering: tieringCfg, history: seedHistory } })), []);
  });
  test('server.js passes facts read from the file (sheet names, Tier 0 OFFSET count, VBA scan)', () => {
    const srv = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.ok(/facts: \{[\s\S]*sheetNames: parsed\.sheetNames[\s\S]*totalOffsetCount[\s\S]*T0-VBA-005/.test(srv));
  });

  console.log('Absence policy');
  const abs = require('./src/utils/absence-policy');
  const unc = (condition, extra = {}) => Object.assign({ id: 'T2-S5-005', status: 'uncertain', confidence: 0.55, condition, priority: 'Query' }, extra);
  test('a plain absence in a complete workbook is recorded as "Not present in the workbook"', () => {
    const rs = [unc('No receivables, payables or inventory rows were found across any sheet.')];
    const out = abs.applyAbsencePolicy(rs, { complete: true, ruleById: byId });
    assert.deepStrictEqual(out.converted, ['T2-S5-005']);
    assert.strictEqual(rs[0].status, 'fail');
    assert.ok(rs[0].condition.startsWith(abs.PREFIX));
    assert.ok(rs[0].confidence >= 0.7);
    assert.ok(/^P[123]$/.test(rs[0].priority));
  });
  test('nothing changes when the reviewer saw only part of the workbook', () => {
    const rs = [unc('No receivables rows were found across any sheet.')];
    const out = abs.applyAbsencePolicy(rs, { complete: false, ruleById: byId });
    assert.strictEqual(out.converted.length, 0);
    assert.strictEqual(rs[0].status, 'uncertain');
  });
  test('statements about the reviewer\'s own limits, or about the model type, stay uncertain', () => {
    const cases = [
      unc('No cell formatting/colour information is present in this formula-only extract.'),
      unc('No explicit plug-style row could be confirmed or ruled out from the formula text alone.'),
      unc('No orphaned-input analysis was performed across the input cells.'),
      unc('No balance sheet was found in any sheet.', { root_cause: 'Model type does not produce a statutory balance sheet.' }),
      unc('Not applicable to this model type: no receivables are expected.'),
      unc('Cover!G4 is the only formula visible, with no change log found.')
    ];
    const out = abs.applyAbsencePolicy(cases, { complete: true, ruleById: byId });
    assert.deepStrictEqual(out.converted, []);
    cases.forEach(c => assert.strictEqual(c.status, 'uncertain'));
  });
  test('pass and fail answers are never touched; an existing P1-P3 priority is kept', () => {
    const rs = [{ id: 'a', status: 'pass', condition: 'No issues found.' }, { id: 'b', status: 'fail', condition: 'No schedule found.' }, unc('No deferred tax line was found anywhere.', { priority: 'P2' })];
    abs.applyAbsencePolicy(rs, { complete: true, ruleById: byId });
    assert.strictEqual(rs[0].status, 'pass'); assert.strictEqual(rs[1].status, 'fail');
    assert.strictEqual(rs[2].priority, 'P2');
  });
  test('validator-tier2.js applies the policy only when the reviewer got every formula, all static text and every named range in one chunk', () => {
    const src = fs.readFileSync(path.join(__dirname, 'src', 'validator-tier2.js'), 'utf8');
    assert.ok(/complete: _absEnforce && useFullParse && fullParseCoverage === 'complete_workbook' && allDataSingleChunk/.test(src));
    assert.strictEqual(scopeCfg.absencePolicy.enforce, true);
    assert.ok(/if \(dataChunks\.length > 1\) allDataSingleChunk = false;/.test(src));
  });

  console.log('What the reviewer is given (formulas, static text, named ranges)');
  const ExcelJS = require('exceljs');
  const fp = require('./src/validator-tier2-fullparse');
  const mkWb = () => {
    const wb = new ExcelJS.Workbook();
    const cover = wb.addWorksheet('Cover');
    cover.getCell('A1').value = 'Purpose: annual revenue and RAV model';
    cover.getCell('A3').value = 'Change log';
    cover.getCell('B3').value = { richText: [{ text: 'v1.2 ' }, { text: 'updated tax rate' }] };
    cover.getCell('A5').value = 42;                                   // a number is not text
    const calc = wb.addWorksheet('Calc');
    calc.getCell('A2').value = 'Receivables';
    calc.getCell('B2').value = 100;
    calc.getCell('C2').value = { formula: 'B2*1.1' };
    calc.getCell('A3').value = 'Closing RAV';
    calc.getCell('C3').value = { formula: 'ClosingRAV+C2' };
    calc.getCell('H3').value = 'Wide note far from the label columns';
    wb.definedNames.add('Calc!$C$3', 'ClosingRAV');
    return wb;
  };
  test('the payload carries static text, including sheets with no formulas, plus the formulas', () => {
    const b = fp.buildFullParsePayloadWithText(mkWb());
    assert.ok(b.payload.Cover && b.payload.Cover.includes('A=Change log') && b.payload.Cover.includes('B=v1.2 updated tax rate'), 'cover text missing');
    assert.ok(b.payload.Calc.includes('C2: =B2*1.1') && b.payload.Calc.includes('R2: A=Receivables'), 'calc sheet incomplete');
    assert.ok(!b.payload.Cover.includes('42') && !b.payload.Calc.includes('=100'), 'numbers must not appear as text');
    assert.ok(!/R2:.*B2=/.test(b.payload.Calc), 'a formula cell must not be repeated as text');
  });
  test('named ranges are listed with what they refer to', () => {
    const b = fp.buildFullParsePayloadWithText(mkWb());
    const n = b.namedRanges.names.find(x => x.name === 'ClosingRAV');
    assert.ok(n && /Calc/.test(n.refersTo) && /C\$?3/.test(n.refersTo), JSON.stringify(b.namedRanges));
  });
  test('everything fits: coverage is complete_workbook', () => {
    const b = fp.buildFullParsePayloadWithText(mkWb());
    assert.strictEqual(b.textIndex.mode, 'full');
    assert.strictEqual(b.coverage, 'complete_workbook');
  });
  test('over budget: label columns only, and the reviewer is told it saw a partial view', () => {
    const wb = mkWb();
    const full = fp.buildTextIndex(wb);
    const b = fp.buildFullParsePayloadWithText(wb, { maxChars: full.chars - 5 });
    assert.strictEqual(b.textIndex.mode, 'narrowed');
    assert.ok(!b.payload.Calc.includes('H=Wide note'), 'wide column should be dropped in narrowed mode');
    assert.ok(b.payload.Cover.includes('Change log'), 'a sheet with no formulas stays whole');
    assert.strictEqual(b.coverage, 'partial_view');
  });
  test('still over budget: later text is cut, the cut sheets are named, coverage is partial', () => {
    const b = fp.buildFullParsePayloadWithText(mkWb(), { maxChars: 60 });
    assert.strictEqual(b.textIndex.mode, 'truncated');
    assert.ok(b.textIndex.truncatedSheets.length > 0);
    assert.ok(b.textIndex.chars <= 60);
    assert.strictEqual(b.coverage, 'partial_view');
  });
  test('over budget only because rows repeat: duplicates are dropped, every distinct row stays, still complete', () => {
    const wb = mkWb();
    const arc = wb.addWorksheet('Archive');
    for (let r = 1; r <= 200; r++) { arc.getCell(`A${r}`).value = 'Scenario output'; arc.getCell(`B${r}`).value = 'Units'; }
    const full = fp.buildTextIndex(wb);
    const b = fp.buildFullParsePayloadWithText(wb, { maxChars: Math.floor(full.chars / 3) });
    assert.strictEqual(b.textIndex.mode, 'deduped');
    assert.ok(b.payload.Archive.includes('A=Scenario output | B=Units') && b.payload.Archive.split('\n').filter(l => l.includes('Scenario output')).length === 1);
    assert.ok(b.payload.Calc.includes('A=Receivables') && b.payload.Cover.includes('Change log'));
    assert.strictEqual(b.coverage, 'complete_workbook');
  });
  test('a huge sheet cannot starve the others: the budget is shared and the cut sheets are named', () => {
    const wb = mkWb();
    const big = wb.addWorksheet('Big');
    for (let r = 1; r <= 2000; r++) big.getCell(`A${r}`).value = `Row label number ${r} with some descriptive wording`;
    const b = fp.buildFullParsePayloadWithText(wb, { maxChars: 4000 });
    assert.strictEqual(b.textIndex.mode, 'truncated');
    assert.ok(b.payload.Cover.includes('Change log') && b.payload.Calc.includes('A=Receivables'), 'small sheets must survive');
    assert.deepStrictEqual(b.textIndex.truncatedSheets, ['Big']);
    assert.ok(b.textIndex.chars <= 4000);
    assert.strictEqual(b.coverage, 'partial_view');
  });
  test('a cut name list also means partial_view', () => {
    assert.strictEqual(fp.fullParseCoverage({ mode: 'full' }, { truncated: true }), 'partial_view');
    assert.strictEqual(fp.fullParseCoverage({ mode: 'full' }, { truncated: false }), 'complete_workbook');
    assert.strictEqual(fp.fullParseCoverage(null, null), 'partial_view');
  });
  test('the text budget grows when the formulas leave room, and shrinks back to the base cap when they do not', () => {
    assert.strictEqual(fp.textBudgetChars(381000), 500000);                       // ESO-sized formulas (Fm-00038): room for 441k chars of text
    assert.strictEqual(fp.textBudgetChars(900000), fp.TEXT_INDEX_MAX_CHARS);      // very large formula list: never below the base cap
    assert.ok(fp.textBudgetChars(500000) >= fp.TEXT_INDEX_MAX_CHARS && fp.textBudgetChars(500000) <= 500000);
  });
  test('payload builder uses that budget: text that exceeds the base cap but fits the room stays complete', () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Calc');
    for (let r = 1; r <= 2500; r++) { ws.getCell(r, 1).value = `Row label number ${r} with a reasonably long description of the line`; ws.getCell(r, 2).value = `Note for line ${r} explaining the basis of the calculation`; ws.getCell(r, 3).value = { formula: `A${r}&"x"` }; }
    const b = fp.buildFullParsePayloadWithText(wb);
    assert.ok(b.textIndex.chars > fp.TEXT_INDEX_MAX_CHARS, `expected text above the base cap, got ${b.textIndex.chars}`);
    assert.ok(b.textIndex.mode === 'full' && b.coverage === 'complete_workbook');
  });
  test('the reviewer payload includes namedRangeMap and the prompt describes the static text section', () => {
    const t2 = fs.readFileSync(path.join(__dirname, 'src', 'validator-tier2.js'), 'utf8');
    assert.ok(/namedRangeMap: tier0Context\.namedRangeMap/.test(t2));
    assert.ok(fp.FULL_PARSE_PROMPT_ADDENDUM.includes('# STATIC TEXT CELLS') && fp.FULL_PARSE_PROMPT_ADDENDUM.includes('namedRangeMap'));
    assert.ok(/fullParseCoverage === 'complete_workbook' && dataChunks\.length === 1/.test(t2));
  });

  console.log('Exclusion engine');
  const eng = applyRuleExclusions({
    checklist, t1Results: [{ id: 'T1-008', status: 'uncertain' }, { id: 'T1-012', status: 'uncertain' }], t2Results: [],
    domainFile: INFRA, modelText: REGULATED, originalName: 'scope-sync-test', log: quiet, config: exclCfg, preExcluded: eso.preExcluded
  });
  try { fs.unlinkSync(path.join(__dirname, 'data', 'rule-exclusions', 'scope-sync-test.json')); } catch (_) {}
  test('one record carries pre-run and post-run exclusions with categories', () => {
    assert.ok(eng.applied);
    for (const p of eso.preExcluded) assert.ok(eng.isExcluded(p.id), `${p.id} not excluded`);
    assert.ok(eng.isExcluded('T1-008') && eng.isExcluded('T1-012'), 'explicit T1 scope decisions still applied after the run');
    const cats = eng.record.byCategory;
    assert.strictEqual(cats.evidence_required, scopeCfg.evidenceRequired.ruleIds.length);
    assert.ok(cats.not_applicable >= 23 && cats.extended_not_run > 0);
    const sum = Object.values(cats).reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, eng.record.excludedCount);
    assert.strictEqual(eng.record.plannedAfter, eng.record.plannedBefore - eng.record.excludedCount);
  });
  test('engine works with no profile matched when there are global exclusions', () => {
    const e = applyRuleExclusions({ checklist, t1Results: [], t2Results: [], domainFile: 'skill-generic.md', modelText: 'retail', originalName: 'scope-sync-test2', log: quiet, config: exclCfg,
      preExcluded: [{ id: 'T2-S3-003', category: 'evidence_required', tier: 'E_evidence_required', reason: 'x' }] });
    try { fs.unlinkSync(path.join(__dirname, 'data', 'rule-exclusions', 'scope-sync-test2.json')); } catch (_) {}
    assert.ok(e.applied && e.isExcluded('T2-S3-003') && e.record.profileId === 'global_scope');
  });
  test('engine with nothing to do is a no-op, as before', () => {
    const e = applyRuleExclusions({ checklist, t1Results: [], t2Results: [], domainFile: 'skill-generic.md', modelText: 'retail', originalName: 'x', log: quiet, config: exclCfg });
    assert.strictEqual(e.applied, false);
  });
  test('planned set drops exactly the excluded ids', () => {
    const all = scope.plannedRules(checklist, INFRA, []);
    const left = scope.plannedRules(checklist, INFRA, eng.excludedIds);
    assert.strictEqual(all.length - left.length, eng.excludedIds.length);
  });

  console.log('Completion: JavaScript and Python agree');
  const planned = scope.plannedRules(checklist, INFRA, eng.excludedIds);
  function lcg(seed) { let s = seed; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
  const fixtures = [];
  for (let k = 0; k < 6; k++) {
    const rnd = lcg(k + 7);
    const results = [];
    for (const r of planned) {
      const x = rnd();
      if (x < 0.15) continue;                                   // not returned
      const st = x < 0.45 ? 'pass' : x < 0.75 ? 'uncertain' : 'fail';
      results.push({ id: r.id, status: st });
      if (rnd() < 0.05) results.push({ id: `${r.id}-extra`, status: rnd() < 0.5 ? 'fail' : 'pass' });   // prefixed sub-results
    }
    fixtures.push(results);
  }
  fixtures.push([]);                                            // nothing returned
  test('identical figures on 7 fixtures (incl. empty)', () => {
    const py = spawnSync('python3', ['-I', '-c', `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.join(__dirname, 'src'))})
from completion import compute_completion
d = json.load(sys.stdin)
print(json.dumps([compute_completion(d['planned'], f)['counts'] for f in d['fixtures']]))
`], { input: JSON.stringify({ planned, fixtures }), encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    assert.strictEqual(py.status, 0, py.stderr);
    const pyOut = JSON.parse(py.stdout);
    fixtures.forEach((f, i) => assert.deepStrictEqual(scope.computeCompletion(planned, f).counts, pyOut[i], `fixture ${i}`));
  });
  test('zero planned rules gives 0, not NaN', () => {
    assert.strictEqual(scope.computeCompletion([], []).counts.concludedPct, 0);
  });
  test('status derivation matches the Validation Matrix rules', () => {
    assert.strictEqual(scope.ruleStatus('R', []), 'Not Performed');
    assert.strictEqual(scope.ruleStatus('R', [{ id: 'R', status: 'pass' }]), 'Pass');
    assert.strictEqual(scope.ruleStatus('R', [{ id: 'R', status: 'uncertain' }]), 'Uncertain');
    assert.strictEqual(scope.ruleStatus('R', [{ id: 'R-1', status: 'pass' }, { id: 'R-2', status: 'fail' }]), 'Raised Issue');
    assert.strictEqual(scope.ruleStatus('R1', [{ id: 'R10', status: 'pass' }]), 'Not Performed');
  });

  console.log('Report payload');
  test('every key server.js passes to buildReportFile is read by report-tab.js', () => {
    const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const start = server.indexOf('await buildReportFile(reportPath, allFlagged, [], {');
    assert.ok(start > 0, 'buildReportFile call not found');
    const body = server.slice(start, server.indexOf('\n    });', start));
    const keys = [...body.matchAll(/^\s{6}(\w+)\s*[:,]/gm)].map(m => m[1]);
    const tab = fs.readFileSync(path.join(__dirname, 'src', 'report-tab.js'), 'utf8');
    const dropped = keys.filter(k => !new RegExp(`\\b${k}\\b`).test(tab));
    assert.deepStrictEqual(dropped, [], `report-tab.js never reads: ${dropped.join(', ')}`);
    assert.ok(keys.includes('scopeSummary') && keys.includes('excludedRuleIds'));
  });

  console.log('Report build');
  test('build_report.py shows one completion figure and the scope disclosure', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-sync-'));
    const rules = planned.filter(r => r.id !== 'T2-S10-002');
    const ruleResults = rules.map((r, i) => ({ id: r.id, status: ['pass', 'uncertain', 'fail'][i % 3], confidence: 80, needs_retest: false, reason: null }));
    const payload = { modelName: 'smoke', sourceFile: 'smoke.xlsx', domainSkill: INFRA, ruleResults, findings: [], excludedRuleIds: eng.excludedIds, igReadiness: 99,
      scopeSummary: { discloseInReport: true, notApplicable: 23, evidenceRequired: [{ id: 'T2-S3-003', label: 'Historical data reconciles to source documents' }], extendedNotRun: 9, fullReview: false } };
    fs.writeFileSync(path.join(tmp, 'd.json'), JSON.stringify(payload));
    const r = spawnSync('python3', [path.join(__dirname, 'src', 'build_report.py'), path.join(tmp, 'd.json'), path.join(tmp, 'o.xlsx')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const expected = scope.computeCompletion(planned, ruleResults).counts.concludedPct;
    // no -I here: isolated mode ignores user site-packages, where openpyxl lives on the VPS
    const chk = spawnSync('python3', ['-c', `
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(path.join(tmp, 'o.xlsx'))}, read_only=True, data_only=True)
tile = None; texts = []
for ws in wb:
    for row in ws.iter_rows(values_only=True):
        for v in row:
            if ws.title == 'Audit Output' and isinstance(v, float) and 0 <= v <= 1 and tile is None and round(v*100) == ${expected}: tile = v
            if isinstance(v, str): texts.append(v)
print(json.dumps({'tile': tile, 'has99': any('99%' in t for t in texts), 'notCounted': any('Not counted:' in t for t in texts),
                  'evidenceRow': any('Procedures needing source documents' in t for t in texts), 'extendedRow': any('Extended review procedures' in t for t in texts)}))
`], { encoding: 'utf8' });
    assert.strictEqual(chk.status, 0, chk.stderr);
    const o = JSON.parse(chk.stdout);
    assert.ok(o.tile !== null, `tile for ${expected}% not found`);
    assert.ok(!o.has99, 'the stale 99% from the payload leaked into the report');
    assert.ok(o.notCounted && o.evidenceRow && o.extendedRow, JSON.stringify(o));
  });

  console.log('Tier 1');
  const JSZip = require('jszip');
  const { runTier1 } = require('./src/validator-tier1');
  async function parsedFrom(wb) {
    return { sheetNames: wb.worksheets.map(w => w.name), sheets: {}, _raw: wb, _type: 'exceljs' };
  }
  function t1(parsed, id) { return runTier1(parsed, {}).filter(r => r.id === id || r.id.startsWith(`${id}-`)); }
  await test('T1-008 finds a "Balance Sheet" sheet, ignores "Net cash flow", flags a negative closing cash', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Balance Sheet');
    ws.addRow(['Net cash flow', -5, -6]); ws.addRow(['Cash and cash equivalents', 10, 12]);
    const ok = t1(await parsedFrom(wb), 'T1-008'); assert.strictEqual(ok[0].status, 'pass');
    ws.addRow(['Closing cash', 4, -2]);
    const bad = t1(await parsedFrom(wb), 'T1-008'); assert.strictEqual(bad[0].status, 'fail');
  });
  await test('T1-006 ignores depreciation rows that mention PP&E', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Financial Statements');
    ws.addRow(['Depreciation of PP&E', -3, -3]); ws.addRow(['Property, plant and equipment', 50, 47]);
    assert.strictEqual(t1(await parsedFrom(wb), 'T1-006')[0].status, 'pass');
  });
  await test('T1-006 stays honest when no such row exists anywhere', async () => {
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('Balance Sheet').addRow(['Inventory', 1]);
    assert.strictEqual(t1(await parsedFrom(wb), 'T1-006')[0].status, 'uncertain');
  });
  await test('T1-017 reads real calcPr settings from the file', async () => {
    const { parseExcel } = require('./src/parser');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-'));
    const wb = new ExcelJS.Workbook(); wb.addWorksheet('Inputs').addRow([1]);
    const base = path.join(tmp, 'base.xlsx'); await wb.xlsx.writeFile(base);
    async function withCalcPr(name, tag) {
      const zip = await JSZip.loadAsync(fs.readFileSync(base));
      let xml = await zip.file('xl/workbook.xml').async('string');
      xml = xml.replace(/<calcPr[^>]*\/>/i, '').replace('</workbook>', `${tag}</workbook>`);
      zip.file('xl/workbook.xml', xml);
      const out = path.join(tmp, name); fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' })); return out;
    }
    const clean = await parseExcel(await withCalcPr('clean.xlsx', '<calcPr calcId="191029"/>'));
    assert.strictEqual(t1(clean, 'T1-017')[0].status, 'pass');
    const iter = await parseExcel(await withCalcPr('iter.xlsx', '<calcPr calcId="191029" iterate="1" iterateCount="100"/>'));
    assert.strictEqual(iter._calcSettings.iterate, true);
    assert.strictEqual(t1(iter, 'T1-017')[0].status, 'fail');
    const prec = await parseExcel(await withCalcPr('prec.xlsx', '<calcPr calcId="191029" fullPrecision="0"/>'));
    assert.strictEqual(t1(prec, 'T1-017')[0].status, 'fail');
    assert.strictEqual(t1({ sheetNames: [], sheets: {}, _raw: wb, _type: 'exceljs' }, 'T1-017')[0].status, 'uncertain');
  });

  console.log('Sheet facts');
  test('hidden, very hidden and protected sheets are reported', () => {
    const { buildSheetFacts } = require('./src/utils/sheet-facts');
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('A'); wb.addWorksheet('B', { state: 'hidden' }); wb.addWorksheet('C', { state: 'veryHidden' });
    wb.getWorksheet('A').protect('pw', {});
    const f = buildSheetFacts({ _raw: wb });
    assert.deepStrictEqual(f.map(x => x.state), ['visible', 'hidden', 'veryHidden']);
    assert.strictEqual(f[0].sheetProtected, true);
    assert.strictEqual(buildSheetFacts({}), null);
  });

  console.log(`\n${passed} check(s) passed${process.exitCode ? ' - WITH FAILURES' : ''}`);
})();
