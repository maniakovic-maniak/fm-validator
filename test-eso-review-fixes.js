#!/usr/bin/env node
// test-eso-review-fixes.js - proves the false positives an independent review found in the ESO licence-model report
// no longer occur, and that the genuine cases each check exists for still do. No API calls.
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// ── circular references: ROW()/COLUMN() read position, not value ───────────────────────────────────
console.log('Circular references');
const { stripStructuralFunctionArgs, buildDependencyGraph, findCycles } = require('./src/utils/circular-reference-detector');
test('ROW(E368)-ROW($E$368) in E368 is not a self-cycle', () => {
  const graph = buildDependencyGraph({ 'Tables!E368': { formulaText: 'INDEX($A$1:$A$9,ROW(E368)-ROW($E$368)+1)' } }, ['Tables']);
  assert.strictEqual(findCycles(graph).length, 0);
});
test('a genuine self-reference is still found', () => {
  const graph = buildDependencyGraph({ 'Tables!E368': { formulaText: 'E368+1' } }, ['Tables']);
  assert.strictEqual(findCycles(graph).length, 1);
});
test('COLUMN/ROW stripping keeps the call and drops only its argument', () => {
  assert.strictEqual(stripStructuralFunctionArgs('COLUMN(A1)+ROW(B2)'), 'COLUMN()+ROW()');
});

// ── lookups: a written-out approximate match is deliberate ────────────────────────────────────────
console.log('Lookups');
const { checkLookupExactMatch } = require('./src/utils/lookup-exact-match-check');
test('MATCH(x,r,1) and VLOOKUP(...,TRUE) are not flagged; omitted arguments are', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('M');
  ws.getCell('A1').value = { formula: 'MATCH(B1,C1:C9,1)', result: 1 };
  ws.getCell('A2').value = { formula: 'VLOOKUP(B2,C2:D9,2,TRUE)', result: 1 };
  ws.getCell('A3').value = { formula: 'MATCH(B3,C3:C9)', result: 1 };
  ws.getCell('A4').value = { formula: 'MATCH(B4,C4:C9,-1)', result: 1 };
  const r = checkLookupExactMatch(wb);
  assert.deepStrictEqual(r.findings.map(f => f.cell), ['A3']);
  assert.strictEqual(r.deliberateApproximate, 3);
});

// ── constant formulas: metadata and name-based formulas hide no input ────────────────────────────
console.log('Constant formulas');
const { checkConstantFormulaCells } = require('./src/utils/constant-formula-check');
test('CELL("filename") text extraction and COLUMN(name) are not flagged; =10+40 still is', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Cover');
  ws.getCell('A1').value = { formula: 'MID(CELL("filename"),SEARCH("[",CELL("filename"))+1,20)', result: 'x' };
  ws.getCell('A2').value = { formula: 'COLUMN(AllOutputData_Start)-1', result: 3 };
  ws.getCell('A3').value = { formula: 'AllOutputData_Start*12', result: 3 };
  ws.getCell('A4').value = { formula: '10+40', result: 50 };
  const r = checkConstantFormulaCells(wb);
  assert.deepStrictEqual(r.findings.map(f => f.cell), ['A4']);
});

// ── overflow dates: a number format that spells words is not a date format ───────────────────────
console.log('Overflow dates');
const { isRealDateFormat } = require('./src/utils/overflow-error-check');
test('a custom format that shows scenario names is not a date format', () => {
  assert.strictEqual(isRealDateFormat('[=1]"Company proposal";[=2]"Ofgem DD";General'), false);
  assert.strictEqual(isRealDateFormat('"Licence Model"'), false);
  assert.strictEqual(isRealDateFormat('0.00'), false);
});
test('genuine date formats still count', () => {
  for (const f of ['dd/mm/yyyy', 'd-mmm-yy', '[$-409]d-mmm-yy', 'mmm yyyy', 'yyyy-mm-dd hh:mm', 'dd\\/mm\\/yyyy']) assert.strictEqual(isRealDateFormat(f), true, f);
  assert.strictEqual(isRealDateFormat(null), true);
});

const { checkOverflowError } = require('./src/utils/overflow-error-check');
test('a text result under a date format (parsed as Invalid Date) is not an overflow; a real implausible date is', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
  ws.getCell('A1').value = { formula: "Other!A1", result: new Date(NaN) };
  ws.getCell('A1').numFmt = 'dd mmm yyyy';
  ws.getCell('A2').value = { formula: "B1-B2", result: new Date(Date.UTC(1791, 3, 14)) };
  ws.getCell('A2').numFmt = 'dd mmm yyyy';
  const r = checkOverflowError(wb);
  assert.deepStrictEqual(r.findings.map(f => f.cell), ['A2']);
  assert.strictEqual(r.textResultUnderDateFormat, 1);
});

// ── orphan sheets ──────────────────────────────────────────────────────────────────────────────
console.log('Orphan sheets');
const { detectOrphanSheets } = require('./src/utils/sheet-linkage');
const sheets = ['FinancialStatements', 'SystemOperator', 'LiveResults', 'SavedResults', 'Scratch calc', 'Lonely calc', 'Cover'];
const depMap = {
  FinancialStatements: { SystemOperator: 20 },
  SystemOperator: {},
  LiveResults: { SystemOperator: 130 },
  SavedResults: {},
  'Scratch calc': { SystemOperator: 4 },
  'Lonely calc': {},
  Cover: {},
};
const stats = Object.fromEntries(sheets.map(n => [n, { formulaCount: n === 'SavedResults' ? 0 : 50 }]));
test('a results sheet that reads the model is a consumer, a values-only store is not an orphan', () => {
  const r = detectOrphanSheets(depMap, sheets, [], stats);
  assert.ok(!r.orphanSheets.includes('LiveResults'));
  assert.ok(!r.orphanSheets.includes('SavedResults'));
  assert.ok(r.valueOnlySheets.includes('SavedResults'));
  assert.deepStrictEqual(r.orphanSheets, ['Lonely calc']);
});
test('a consumer not named like an output goes to the low-severity review list, an output-named one does not', () => {
  const r = detectOrphanSheets(depMap, sheets, [], stats);
  assert.deepStrictEqual(r.reviewConsumers, ['Scratch calc']);
  assert.ok(r.terminalConsumers.includes('LiveResults'));
});
test('without sheet stats the behaviour degrades safely', () => {
  const r = detectOrphanSheets(depMap, sheets, []);
  assert.ok(!r.orphanSheets.includes('LiveResults'));
});

// ── named ranges ───────────────────────────────────────────────────────────────────────────────
console.log('Named ranges');
const { detectNamedRangeIssues, applyVbaNameUsage } = require('./src/utils/named-range-audit');
function nameBook(names) {
  // A stub workbook: ExcelJS's own defined-names setter silently drops external-workbook ranges, which is exactly why
  // the audit also re-reads xl/workbook.xml. The audit only needs these three members.
  return {
    definedNames: { model: names },
    eachSheet() {},
    getWorksheet(n) { return n === 'Model' ? {} : undefined; },
  };
}
test('a print area pointing into another workbook is housekeeping, not a broken name', () => {
  const wb = nameBook([
    { name: 'Print_Area_MI', ranges: ["[1]Monthly actuals!$BN$1:$CA$52"] },
    { name: 'RealBroken', ranges: ["Gone!$A$1"] },
    { name: 'Good', ranges: ["Model!$A$1"] },
  ]);
  const r = detectNamedRangeIssues(wb, null);
  assert.deepStrictEqual(r.broken.map(b => b.name), ['RealBroken']);
  assert.deepStrictEqual(r.metadataOrExternal.map(b => b.name), ['Print_Area_MI']);
});
test('a name used only by macro source is not reported unused', () => {
  const audit = { applicable: true, unused: [{ name: 'AllOutputData' }, { name: 'ReallyUnused' }] };
  applyVbaNameUsage(audit, [{ sourceCode: 'Range("AllOutputData").Copy\nApplication.Run "x"' }]);
  assert.deepStrictEqual(audit.unused.map(u => u.name), ['ReallyUnused']);
  assert.deepStrictEqual(audit.usedByVba.map(u => u.name), ['AllOutputData']);
});

// ── macro scanner clean-up ───────────────────────────────────────────────────────────────────────
console.log('Macro review');
const { refineModuleFindings, hasIterativeSolverPattern, subBodyIsEmpty } = require('./src/utils/vba-refine');
const mod = (src, findings) => ({ name: 'M', sourceCode: src, findings });
test('empty ActiveX handlers are not open-time triggers', () => {
  const src = 'Private Sub ComboBox1_Change()\nEnd Sub\nPrivate Sub Label1_Click()\n  \' nothing\nEnd Sub';
  const r = refineModuleFindings(mod(src, [
    { category: 'AutoExec', keyword: 'ComboBox1_Change' }, { category: 'AutoExec', keyword: 'Label1_Click' }]));
  assert.strictEqual(r.findings.length, 0);
  assert.strictEqual(r.dropped.length, 2);
});
test('Workbook_Open with a body is kept; with an empty body it is dropped', () => {
  const full = 'Private Sub Workbook_Open()\n  Sheets("A").Calculate\nEnd Sub';
  assert.strictEqual(refineModuleFindings(mod(full, [{ category: 'AutoExec', keyword: 'Workbook_Open' }])).findings.length, 1);
  const empty = 'Private Sub Workbook_Open()\nEnd Sub';
  assert.strictEqual(refineModuleFindings(mod(empty, [{ category: 'AutoExec', keyword: 'Workbook_Open' }])).findings.length, 0);
  assert.strictEqual(subBodyIsEmpty('Sub Missing()\nx=1\nEnd Sub', 'NotThere'), false);
});
test('keywords only in comments or strings, base64 heuristics and a routine named Run are dropped', () => {
  const src = "Sub Go()\n  ' write Output to a file\n  MsgBox \"Open the Output\"\n  Application.Run \"Other\"\nEnd Sub";
  const r = refineModuleFindings(mod(src, [
    { category: 'Suspicious', keyword: 'Open' }, { category: 'Suspicious', keyword: 'output' },
    { category: 'Suspicious', keyword: 'Base64 Strings' }, { category: 'Suspicious', keyword: 'Run' }]));
  assert.strictEqual(r.findings.length, 0, JSON.stringify(r.dropped));
});
test('Shell and a real file-I/O statement are kept', () => {
  const src = 'Sub Go()\n  Shell "calc"\n  Open "c.txt" For Output As #1\nEnd Sub';
  const r = refineModuleFindings(mod(src, [
    { category: 'Suspicious', keyword: 'Shell' }, { category: 'Suspicious', keyword: 'Open' }, { category: 'Suspicious', keyword: 'Output' }]));
  assert.strictEqual(r.findings.length, 3);
});
test('a calculation loop is an iterative solver, a mode save/restore is not', () => {
  assert.strictEqual(hasIterativeSolverPattern('Do While i < 50\n  Sheets(1).Calculate\n  i = i + 1\nLoop'), true);
  assert.strictEqual(hasIterativeSolverPattern('Application.Iteration = True'), true);
  assert.strictEqual(hasIterativeSolverPattern('m = Application.Calculation\nApplication.Calculation = xlAutomatic\nRange("A1").Value = Range("B1").Value\nApplication.Calculation = m'), false);
});

// ── unused inputs: section numbers ─────────────────────────────────────────────────────────────────
console.log('Unused inputs');
const { detectRedundantInputs } = require('./src/utils/redundant-inputs');
test('1, 2, 3, 4 beside headings (with gaps) are section numbers, not unused assumptions', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Inputs');
  [[42, 1], [52, 2], [75, 3], [94, 4]].forEach(([row, n]) => { ws.getCell(`E${row}`).value = n; ws.getCell(`F${row}`).value = 'Section heading'; });
  ws.getCell('H10').value = 0.0725; ws.getCell('G10').value = 'Discount rate';
  const calc = wb.addWorksheet('Calc'); calc.getCell('A1').value = { formula: 'Inputs!H10*2', result: 1 };
  const r = detectRedundantInputs(wb);
  assert.deepStrictEqual(r.redundant.filter(x => ['E42', 'E52', 'E75', 'E94'].includes(x.cell)), []);
  assert.ok(r.excludedNumberedHeadings >= 4);
});
test('two isolated integers are still reported', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Inputs');
  ws.getCell('E5').value = 1; ws.getCell('E9').value = 2; ws.getCell('D5').value = 'Tax rate switch'; ws.getCell('D9').value = 'Mode';
  const r = detectRedundantInputs(wb);
  assert.ok(r.redundant.length >= 2);
});

// ── Tier 1 ────────────────────────────────────────────────────────────────────────────────────────
console.log('Tier 1');
const { findLabelledPeriodFlagRow } = require('./src/validator-tier1');
test('numeric historical/forecast period-flag rows count as an actual/forecast switch', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('SystemOperator');
  ws.getCell('D266').value = 'Historical period flag';
  ['AP', 'AQ', 'AR', 'AS'].forEach((c, i) => { ws.getCell(`${c}266`).value = i < 2 ? 1 : 0; });
  const f = findLabelledPeriodFlagRow({ _raw: wb, _type: 'exceljs' });
  assert.deepStrictEqual(f, { sheetName: 'SystemOperator', rowNum: 266 });
});
test('a row of numbers with an unrelated label is not a period flag', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Calc');
  ws.getCell('D5').value = 'Revenue switch'; [1, 0, 1, 0].forEach((v, i) => { ws.getCell(5, 6 + i).value = v; });
  assert.strictEqual(findLabelledPeriodFlagRow({ _raw: wb, _type: 'exceljs' }), null);
});
const icaew = require('./src/utils/validator-tier1-icaew-additions');
test('a hyphen in a sheet name that has a space is accepted; a bare operator name is still rejected', () => {
  const rule = { id: 'T1-015', label: 'x', severity: 'medium', reject_patterns: ['^Sheet[0-9]+$', '\\+', '\\-', '\\*', '\\/'] };
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('RIIO-1 revenue and charges'); wb.addWorksheet('Revenue');
  assert.strictEqual(icaew.worksheet_naming_check(wb, rule).status, 'pass');
  const wb2 = new ExcelJS.Workbook(); wb2.addWorksheet('Rev-Cost'); wb2.addWorksheet('Sheet1');
  assert.strictEqual(icaew.worksheet_naming_check(wb2, rule).status, 'fail');
});

// ── scope ──────────────────────────────────────────────────────────────────────────────────────
console.log('Scope');
const { matchProfile, explicitScopeTiers, loadExclusionConfig } = require('./src/utils/rule-exclusions');
test('a regulated licence model drops the conditional project-finance procedures before the run', () => {
  const cfg = loadExclusionConfig(() => {});
  const profile = matchProfile(cfg, 'skill-infrastructure.md', 'NGESO electricity system operator licence model');
  assert.ok(profile);
  const ids = new Set(explicitScopeTiers(profile).flatMap(t => t.ruleIds));
  for (const id of ['T2-S10-343', 'T2-S10-405', 'T2-S10-553', 'T2-S10-584', 'T2-S10-688', 'T2-S10-695', 'T2-S7-003', 'T2-S10-012', 'T2-S5-005', 'T2-S10-009', 'T2-S6-003']) assert.ok(ids.has(id), id);
});
test('a mining model keeps them', () => {
  const cfg = loadExclusionConfig(() => {});
  assert.strictEqual(matchProfile(cfg, 'skill-mining.md', 'Open-pit gold mining project, 1.9Mtpa'), null);
});
test('reviewer-kept procedures stay in scope', () => {
  const cfg = loadExclusionConfig(() => {});
  const ids = new Set(explicitScopeTiers(matchProfile(cfg, 'skill-infrastructure.md', 'electricity system operator')).flatMap(t => t.ruleIds));
  for (const id of ['T2-S5-008', 'T2-S6-002', 'T2-S10-336', 'T2-S5-013']) assert.ok(!ids.has(id), id);
});

console.log(`\n${passed} check(s) passed${process.exitCode ? ' - WITH FAILURES' : ''}`);
