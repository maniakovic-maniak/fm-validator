#!/usr/bin/env node
// test-nested-subtotal-and-placeholder.js - the two checks added after the ESO review: a SUM that counts a subtotal's
// components twice, and an output row that holds only a "to be provided" note.
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { checkNestedSubtotals } = require('./src/utils/nested-subtotal-check');
const { checkPlaceholderText } = require('./src/utils/placeholder-text-check');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const F = (f, r) => ({ formula: f, result: r });

console.log('Nested subtotal');
function eso() {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('RoRE');
  // rows 10:19 are components; row 20 = SUM(10:19); rows 21:37 more components; row 38 = SUM(10:37)
  for (const col of ['AP', 'AQ', 'AR']) {
    for (let r = 10; r <= 19; r++) ws.getCell(`${col}${r}`).value = 24.4156858;
    ws.getCell(`${col}20`).value = F(`SUM(${col}10:${col}19)`, 244.156858);
    for (let r = 21; r <= 37; r++) ws.getCell(`${col}${r}`).value = r === 21 ? -248.865866 : 0;
    ws.getCell(`${col}38`).value = F(`SUM(${col}10:${col}37)`, 239.44785);
  }
  return wb;
}
test('the ESO pattern is found once for the repeated columns, with the numeric effect', () => {
  const r = checkNestedSubtotals(eso());
  assert.strictEqual(r.flaggedCount, 1);
  const f = r.findings[0];
  assert.strictEqual(f.cell, 'AP38'); assert.strictEqual(f.innerCell, 'AP20'); assert.strictEqual(f.instanceCount, 3);
  assert.ok(/-4\.709008/.test(f.note), f.note);
});
test('a total that sums the components only, or sums subtotals only, is clean', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('M');
  for (let r = 1; r <= 4; r++) ws.getCell(`A${r}`).value = 5;
  ws.getCell('A5').value = F('SUM(A1:A4)', 20);
  for (let r = 6; r <= 9; r++) ws.getCell(`A${r}`).value = 5;
  ws.getCell('A10').value = F('SUM(A6:A9)', 20);
  ws.getCell('A11').value = F('SUM(A5,A10)', 40);                 // adds the subtotals only
  ws.getCell('A12').value = F('A5+A10', 40);
  assert.strictEqual(checkNestedSubtotals(wb).flaggedCount, 0);
});
test('a grand total over a block that holds a subtotal is flagged, whatever the labels say', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('M');
  ws.getCell('A1').value = 1; ws.getCell('A2').value = 2; ws.getCell('A3').value = F('SUM(A1:A2)', 3); ws.getCell('A4').value = 4;
  ws.getCell('A5').value = F('SUM(A1:A4)', 10);
  const r = checkNestedSubtotals(wb);
  assert.strictEqual(r.flaggedCount, 1); assert.strictEqual(r.findings[0].cell, 'A5');
});
test('a row-wise version is found too', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('M');
  ws.getCell('A1').value = 1; ws.getCell('B1').value = 2; ws.getCell('C1').value = F('SUM(A1:B1)', 3); ws.getCell('D1').value = 4;
  ws.getCell('E1').value = F('SUM(A1:D1)', 10);
  const r = checkNestedSubtotals(wb);
  assert.strictEqual(r.flaggedCount, 1); assert.strictEqual(r.findings[0].cell, 'E1');
});
test('two independent sums over the same range are not nested', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('M');
  for (let r = 1; r <= 3; r++) ws.getCell(`A${r}`).value = r;
  ws.getCell('A4').value = F('SUM(A1:A3)', 6); ws.getCell('A5').value = F('SUM(A1:A3)', 6);
  assert.strictEqual(checkNestedSubtotals(wb).flaggedCount, 0);
});

console.log('Placeholder text');
test('a "Formulae to be provided" note alone in its row beside finished rows is flagged', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('FinancialRatios');
  for (const r of [127, 128, 130, 131]) for (const c of ['AP', 'AQ', 'AR', 'AS']) ws.getCell(`${c}${r}`).value = F('1+1', 2);
  ws.getCell('AP129').value = 'Formulae to be provided by ESO';
  const r = checkPlaceholderText(wb);
  assert.strictEqual(r.flaggedCount, 1); assert.strictEqual(r.findings[0].cell, 'AP129');
});
test('TBC in a notes cell on a finished row, or on a documentation sheet, is not flagged', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Calc');
  for (const c of ['B', 'C', 'D', 'E']) { ws.getCell(`${c}1`).value = F('1+1', 2); ws.getCell(`${c}2`).value = F('1+1', 2); ws.getCell(`${c}3`).value = F('1+1', 2); }
  ws.getCell('F2').value = 'rate TBC';
  const cover = wb.addWorksheet('Cover notes'); cover.getCell('A1').value = 'Approval to be confirmed';
  const r = checkPlaceholderText(wb);
  assert.strictEqual(r.flaggedCount, 0); assert.ok(r.mentionsIgnored >= 1);
});
test('a lone note with no finished rows around it is not flagged', () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Scratch'); ws.getCell('A1').value = 'TODO';
  assert.strictEqual(checkPlaceholderText(wb).flaggedCount, 0);
});

console.log('Screening record types');
const { classifyRecordType, assignRecordTypes } = require('./src/utils/record-type-classifier');
test('pattern screens are a Query or an Observation, never a P-ranked Confirmed Finding', () => {
  const base = { severity: 'medium', confidence: 85, urgency: 'Before next reliance' };
  assert.strictEqual(classifyRecordType({ id: 'T0-FMLPATTERN-001', ...base }), 'Query');
  assert.strictEqual(classifyRecordType({ id: 'T0-COLPATTERN-001', ...base }), 'Query');
  assert.strictEqual(classifyRecordType({ id: 'T0-REGIMECHANGE-OutputSummary-170', ...base }), 'Query');
  assert.strictEqual(classifyRecordType({ id: 'T0-REGIMECHANGE (49 instances)', ...base }), 'Query');
  for (const id of ['T0-MIXEDREF-001', 'T0-DAISYCHAIN-001', 'T0-NESTEDIF-001', 'T0-COMPLEXFML-001', 'T0-HIDDEN-002']) assert.strictEqual(classifyRecordType({ id, ...base }), 'Observation', id);
});
test('a real defect check and an explicit record_type are untouched', () => {
  assert.strictEqual(classifyRecordType({ id: 'T0-NESTEDSUM-001', severity: 'high', confidence: 85 }), 'Confirmed Finding');
  assert.strictEqual(classifyRecordType({ id: 'T0-HIDDEN-001', severity: 'medium', confidence: 85 }), 'Confirmed Finding');
  assert.strictEqual(classifyRecordType({ id: 'T0-FMLPATTERN-001', severity: 'medium', record_type: 'Confirmed Finding' }), 'Confirmed Finding');
  const arr = assignRecordTypes([{ id: 'T0-DAISYCHAIN-001', severity: 'low', confidence: 90 }]);
  assert.strictEqual(arr[0].record_type, 'Observation');
});

console.log('Related findings');
const { linkRelatedFindings } = require('./src/utils/related-findings');
test('findings from different checks that name the same cells are cross-referenced, nothing is dropped', () => {
  const fs = [
    { id: 'T0-ERRLITERAL-001', condition: '10 formula(s) contain #REF!', affected_cells: ['FinancialRatios!AP138', 'FinancialRatios!AQ138', 'FinancialRatios!AP139'] },
    { id: 'T2-S4-006', condition: 'IFERROR masks an error at FinancialRatios!AP138:AT139 and returns zero' },
    { id: 'T2-S1-002', condition: 'Unrelated naming point on Cover!B2' },
    { id: 'T0-FMLPATTERN-001', condition: 'pattern screen', affected_cells: Array.from({ length: 500 }, (_, i) => `FinancialRatios!AP${i + 1}`) },
  ];
  const linked = linkRelatedFindings(fs);
  assert.strictEqual(linked.length, 1);
  assert.deepStrictEqual(linked[0].ids.sort(), ['T0-ERRLITERAL-001', 'T2-S4-006']);
  assert.deepStrictEqual(fs[0].related_ids, ['T2-S4-006']);
  assert.ok(/also reported by T0-ERRLITERAL-001/.test(fs[1].condition));
  assert.strictEqual(fs[2].related_ids, undefined);
  assert.strictEqual(fs[3].related_ids, undefined);        // a 500-cell screen is not linked to anything
  assert.strictEqual(fs.length, 4);
});
test('linking twice does not repeat the note, and sheets with spaces and quotes are read', () => {
  const fs = [
    { id: 'A-1', condition: "'FinRatios RoRE decomposition'!AP38 double counts" },
    { id: 'B-1', condition: 'see FinRatios RoRE decomposition AP38', affected_cells: ["FinRatios RoRE decomposition!AP38"] },
  ];
  linkRelatedFindings(fs); linkRelatedFindings(fs);
  assert.strictEqual((fs[0].condition.match(/Same cell\(s\)/g) || []).length, 1);
  assert.deepStrictEqual(fs[0].related_ids, ['B-1']);
});
test('two findings on different cells of one sheet are not linked', () => {
  const fs = [{ id: 'X-1', condition: 'Model!A1:A3 is wrong' }, { id: 'Y-1', condition: 'Model!B1:B3 is wrong' }];
  assert.strictEqual(linkRelatedFindings(fs).length, 0);
});

console.log(`\n${passed} check(s) passed${process.exitCode ? ' - WITH FAILURES' : ''}`);
