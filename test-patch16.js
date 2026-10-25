#!/usr/bin/env node
// test-patch16.js - every Tier 2 finding gets an honest location.
'use strict';
const assert = require('assert');
const fs = require('fs');
const { repairLocations, sheetsMentioned } = require('./src/utils/location-repair');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const SHEETS = ['Cover', 'UserInterface', 'Model Map', 'FinancialStatements', 'FinancialRatios', 'FinRatios RoRE decomposition', 'RoRE ranges', 'Tables', 'SystemOperator'];
const row = (o) => Object.assign({ sheet: '', cell: 'A1', condition: '' }, o);

console.log('Location repair');
test('a valid sheet is kept (case fixed to the real name)', () => {
  const r = row({ sheet: 'financialstatements', cell: 'D14' }); repairLocations([r], SHEETS);
  assert.strictEqual(r.sheet, 'FinancialStatements'); assert.strictEqual(r.cell, 'D14');
});
test('Sheet!Cell in the text sets both sheet and cell', () => {
  const r = row({ sheet: 'A1', condition: 'Row 121 on FinancialRatios!D121 is hardcoded.' }); repairLocations([r], SHEETS);
  assert.strictEqual(r.sheet, 'FinancialRatios'); assert.strictEqual(r.cell, 'D121'); assert.strictEqual(r.location_basis, 'sheet_cell_from_text');
});
test('a finding quoting two sheets has no single location (Fm-00047 T2-S10-789 case)', () => {
  const r = row({ sheet: 'A1', condition: "'Model Map'!AQ76 = OFFSET(...); the same pattern recurs in SystemOperator!AP84 and elsewhere." }); repairLocations([r], SHEETS);
  assert.strictEqual(r.sheet, 'Workbook'); assert.strictEqual(r.location_basis, 'workbook_level');
});
test('quoted sheet name with a space works', () => {
  const r = row({ condition: "See 'Model Map'!B4 for the list." }); repairLocations([r], SHEETS);
  assert.strictEqual(r.sheet, 'Model Map'); assert.strictEqual(r.cell, 'B4');
});
test('exactly one sheet named gives that sheet, cell left alone', () => {
  const r = row({ sheet: 'None', condition: 'No cell on Cover states the accounting basis.' }); repairLocations([r], SHEETS);
  assert.strictEqual(r.sheet, 'Cover'); assert.strictEqual(r.location_basis, 'sheet_from_text');
});
test('a list of sheets is workbook-level (the Fm-00047 T2-S9-001 case)', () => {
  const r = row({ sheet: 'A1', condition: 'Sheet list is Cover, UserInterface, Model Map, FinancialStatements, FinancialRatios.' }); repairLocations([r], SHEETS);
  assert.strictEqual(r.sheet, 'Workbook'); assert.strictEqual(r.location_basis, 'workbook_level');
});
test('VBA or named-range findings with no sheet are workbook-level', () => {
  const rs = [row({ sheet: 'A1', condition: "vbaSummary.findingSummary lists 'T0-VBA-005'; Module10 has setsCalculation=true." }), row({ sheet: '', condition: 'namedRangeSummary.totalNamedRanges=170, unusedCount=107.' })];
  repairLocations(rs, SHEETS); assert.ok(rs.every(r => r.sheet === 'Workbook'));
});
test('a name found only inside a longer sheet name is not counted twice', () => {
  assert.deepStrictEqual(sheetsMentioned('Uses FinRatios RoRE decomposition for the split.', SHEETS), ['FinRatios RoRE decomposition']);
});
test('ordinary words do not match a sheet name (case-sensitive, whole word)', () => {
  assert.deepStrictEqual(sheetsMentioned('The stable tables in the appendix', SHEETS), []);
});
test('the reviewer\'s own "Workbook" is kept and counted as workbook-level', () => {
  const r = row({ sheet: 'Workbook', condition: 'FAST review not conducted.' }); repairLocations([r], SHEETS);
  assert.strictEqual(r.sheet, 'Workbook');
});

console.log('Wiring');
const t2 = fs.readFileSync(__dirname + '/src/validator-tier2.js', 'utf8');
const br = fs.readFileSync(__dirname + '/src/build_report.py', 'utf8');
test('repair runs before the unusable-location count', () => {
  assert.ok(t2.indexOf("require('./utils/location-repair')") > 0 && t2.indexOf("require('./utils/location-repair')") < t2.indexOf('const a1CellCount'));
});
test('"Workbook" gets no View link in the Issue Log', () => { assert.ok(br.includes("('—','N/A','Multiple','Workbook')")); });
test('absences ("Not present...") with a real sheet are an honest A1, not unusable', () => { assert.ok(t2.includes('not present|not found|not applicable')); });
console.log('Mandatory procedure wording');
test('build_report names "not concluded" and "raised issue" separately and no longer says incomplete', () => {
  assert.ok(br.includes('not concluded') && br.includes('with a raised issue'));
  assert.ok(!/incomplete mandatory critical procedure\(s\)'/.test(br));
});
test('the wording split is driven by the rule statuses (uncertain vs any non-pass status)', () => {
  assert.ok(br.includes("_mand_with_issue") && br.includes("_mand_not_concluded"));
});
console.log(`\n${passed} passed`);
