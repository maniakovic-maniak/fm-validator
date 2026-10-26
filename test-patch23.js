#!/usr/bin/env node
// test-patch23.js - double-scaling check (Tier 0) and the complete-visibility record for full-parse runs.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');
const { checkDoubleScaling, parseScaled } = require('./src/utils/double-scaling-check');
const { ranAsCompleteFullParse, buildCompleteVisibility } = require('./src/utils/full-parse-visibility');
const { buildRootCauseFields } = require('./src/utils/root-cause-consolidation');
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }

function wbWith(rows, sheet = 'OutputSummary') {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(sheet);
  for (const [addr, f, result] of rows) ws.getCell(addr).value = f === null ? result : { formula: f, result };
  return wb;
}

(async () => {
  console.log('Parsing');
  await test('whole-formula "<operand> / NAME" shapes are recognised; other shapes are skipped', () => {
    assert.deepStrictEqual(parseScaled('=(AP125+AP126)/ESOpf').name, 'ESOpf');
    assert.strictEqual(parseScaled('=FinancialRatios!AP110/ESOpf').op, '/');
    assert.strictEqual(parseScaled('=AP5*ESOpf').op, '*');
    assert.strictEqual(parseScaled('=A1+B1/ESOpf'), null, 'the factor divides only B1: ambiguous, skipped');
    assert.strictEqual(parseScaled('=A1/B1'), null, 'a cell address is not a factor');
    assert.strictEqual(parseScaled('=A1/1000'), null, 'a literal is not a named factor');
    assert.strictEqual(parseScaled('=SUM(A1:A5)/COUNT(B1:B5)'), null);
  });

  console.log('Detection');
  await test('the ESO pattern: a sum of deflated lines deflated again, and a ratio of deflated lines deflated again', () => {
    const wb = wbWith([['AP125', 'FinancialRatios!AP110/ESOpf', -0.689], ['AP126', 'FinancialRatios!AP111/ESOpf', -3.721],
      ['AP127', '(AP125+AP126)/ESOpf', -4.13], ['AP128', '(-AP125/AP126)/ESOpf', -0.173],
      ['AQ125', 'FinancialRatios!AQ110/ESOpf', -1.873], ['AQ126', 'FinancialRatios!AQ111/ESOpf', -4.079], ['AQ127', '(AQ125+AQ126)/ESOpf', -5.46]]);
    const r = checkDoubleScaling(wb);
    assert.strictEqual(r.flaggedCount, 2);
    const sum = r.findings.find(f => f.row === 127); const ratio = r.findings.find(f => f.row === 128);
    assert.strictEqual(sum.instanceCount, 2); assert.deepStrictEqual(sum.cells, ['AP127', 'AQ127']);
    assert.ok(!sum.ratio && ratio.ratio);
    assert.ok(/applied twice/.test(sum.note) && /ESOpf/.test(sum.note) && /-4.13/.test(sum.note));
    assert.ok(/unit-free/.test(ratio.note));
  });
  await test('a factor applied once is not flagged', () => {
    const wb = wbWith([['A1', null, 100], ['B1', 'A1/ESOpf', 90], ['C1', 'B1+B1', 180], ['D1', 'FinancialStatements!A9/ESOpf', 5]]);
    assert.strictEqual(checkDoubleScaling(wb).flaggedCount, 0);
  });
  await test('a divide followed by the matching multiply (convert back) is not flagged', () => {
    const wb = wbWith([['B1', 'A1/ESOpf', 90], ['C1', 'B1*ESOpf', 100]]);
    assert.strictEqual(checkDoubleScaling(wb).flaggedCount, 0);
  });
  await test('two different factors are not flagged', () => {
    const wb = wbWith([['B1', 'A1/ESOpf', 90], ['C1', 'B1/FXrate', 45]]);
    assert.strictEqual(checkDoubleScaling(wb).flaggedCount, 0);
  });
  await test('a range input is not treated as a scaled single cell', () => {
    const wb = wbWith([['B1', 'A1/ESOpf', 90], ['B2', 'A2/ESOpf', 80], ['C1', 'SUM(B1:B2)/ESOpf', 170]]);
    assert.strictEqual(checkDoubleScaling(wb).flaggedCount, 0);
  });
  await test('cross-sheet inputs are followed, and the same name with * is caught', () => {
    const wb = new ExcelJS.Workbook();
    const a = wb.addWorksheet('Calc'); a.getCell('A1').value = { formula: 'Inputs!A1*Infl', result: 10 };
    const b = wb.addWorksheet('Out'); b.getCell('A1').value = { formula: 'Calc!A1*Infl', result: 12 };
    const r = checkDoubleScaling(wb); assert.strictEqual(r.flaggedCount, 1); assert.strictEqual(r.findings[0].sheet, 'Out');
  });
  await test('a workbook with no scaled cells is not applicable and does not fail', () => {
    const r = checkDoubleScaling(wbWith([['A1', null, 1], ['B1', 'A1+1', 2]])); assert.strictEqual(r.applicable, false); assert.strictEqual(r.flaggedCount, 0);
  });
  await test('the result fits buildRootCauseFields as the server calls it', () => {
    const r = checkDoubleScaling(wbWith([['B1', 'A1/ESOpf', 90], ['C1', 'B1/ESOpf', 80]]));
    const f = buildRootCauseFields('T0-DOUBLESCALE-001', r, { commonRemediationAction: 'x' });
    assert.ok(f && typeof f === 'object');
  });
  await test('server.js and index.js both run the check and register T0-DOUBLESCALE-001', () => {
    for (const f of ['server.js', 'index.js']) {
      const s = fs.readFileSync(path.join(__dirname, f), 'utf8');
      assert.ok(/checkDoubleScaling\(parsed\._raw\)/.test(s) && /id: 'T0-DOUBLESCALE-001'/.test(s), f);
    }
  });

  console.log('Complete visibility record');
  const sheets = { OutputSummary: ['AP125: =FinancialRatios!AP110/ESOpf', 'AP127: =(AP125+AP126)/ESOpf', 'A3: £m 18/19 prices'], Cover: ['C4: Model Version'] };
  await test('a record covers every exported cell in the shape the curated route writes', () => {
    const r = buildCompleteVisibility(sheets);
    assert.deepStrictEqual(r.OutputSummary.rowNumbers, [3, 125, 127]); assert.deepStrictEqual(r.Cover.cellAddresses, ['C4']);
    assert.deepStrictEqual(r.OutputSummary.batches, ['full_parse']);
    JSON.parse(JSON.stringify(r));
  });
  await test('a stored reviewCoverage decides: full_parse + complete_workbook only', () => {
    assert.strictEqual(ranAsCompleteFullParse({ reviewCoverage: { route: 'full_parse', coverage: 'complete_workbook' } }, null), true);
    assert.strictEqual(ranAsCompleteFullParse({ reviewCoverage: { route: 'full_parse', coverage: 'partial_view' } }, null), false);
    assert.strictEqual(ranAsCompleteFullParse({ reviewCoverage: { route: 'curated' } }, null), false);
    assert.strictEqual(ranAsCompleteFullParse(null, null), false);
  });
  await test('an older order is recognised from its run log (the two lines every full-parse run writes)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'));
    fs.writeFileSync(path.join(dir, 'a.txt'), 'Funnel routing: FULL-PARSE route (~275,583)\n   Static text index: full (441,338 chars); coverage: complete_workbook\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'Funnel routing: CURATED route (~900,000)\n');
    fs.writeFileSync(path.join(dir, 'c.txt'), 'Funnel routing: FULL-PARSE route\n   coverage: partial_view\n');
    assert.strictEqual(ranAsCompleteFullParse({ runLogFilename: 'a.txt' }, dir), true);
    assert.strictEqual(ranAsCompleteFullParse({ runLogFilename: 'b.txt' }, dir), false);
    assert.strictEqual(ranAsCompleteFullParse({ runLogFilename: 'c.txt' }, dir), false);
    assert.strictEqual(ranAsCompleteFullParse({ runLogFilename: '../../etc/passwd' }, dir), false);
  });
  await test('server.js stores reviewCoverage; the export script uses the new record', () => {
    assert.ok(/reviewCoverage: t2Results\._evidence/.test(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8')));
    assert.ok(/ranAsCompleteFullParse\(order/.test(fs.readFileSync(path.join(__dirname, 'scripts', 'export-for-partner-review.js'), 'utf8')));
  });

  console.log('Skill text');
  await test('label_matches_formula_behaviour tells the reviewer to check units and not to pass on "no mismatch found"', () => {
    const s = fs.readFileSync(path.join(__dirname, 'config', 'skill.md'), 'utf8'); const i = s.indexOf('### test: label_matches_formula_behaviour');
    const sec = s.slice(i, s.indexOf('### test:', i + 10));
    assert.ok(/already divided/.test(sec) && /not a pass/.test(sec));
  });
  console.log(`\n${passed} passed`);
})();
