'use strict';
// Patch 30 checks: exact formula identity and complete formula text.
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const ExcelJS = require('exceljs');
const { normalizeFormula, runTier0 } = require('./src/validator-tier0');
const { FormulaStore, fullFormula, getStore } = require('./src/utils/formula-store');
const circ = require('./src/utils/circular-reference-detector');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };
const n = normalizeFormula;

// identity
check('a formula filled across keeps one key', n('A1+B1', 'C1') === n('B1+C1', 'D1'));
check('a formula filled down keeps one key', n('A1*2', 'B1') === n('A2*2', 'B2'));
check('absolute vs relative anchor are different', n('A1+B1', 'C1') !== n('A1+$B$1', 'C1'));
check('a different offset is different', n('A1+B1', 'C1') !== n('A2+B1', 'C1'));
check('without an address, references stay as written and stay distinct', n('A1+B1') !== n('A1+$B$1') && n('A1+B1') !== n('A2+B1') && n('A1+B1') === 'A1+B1');
check('text constants that look like cells are not cells', n('IF(X1="AB12",1,0)', 'Z9') !== n('IF(X1="CD99",1,0)', 'Z9'));
check('a text constant is kept exactly', n('IF(X1="C99",1,0)', 'Z9').includes('"C99"'));
check('doubled quotes inside text are handled', n('"a""A1"&B1', 'C1').includes('"a""A1"'));
check('sheet names that contain cell-like text do not collide', n("'Data A1'!B1", 'C3') !== n("'Data B2'!C2", 'D4'));
check('the sheet in a reference is part of the key', n('S1!A1', 'B1') !== n('S2!A1', 'B1'));
check('ranges keep their size', n('SUM(A1:A9)', 'B1') !== n('SUM(A1:A10)', 'B1') && n('SUM(A1:A9)', 'C1') === n('SUM(B1:B9)', 'D1'));
check('whole column and row references are handled', n('SUM(A:A)', 'C1') === n('SUM(B:B)', 'D1') && n('SUM(A:A)', 'C1') !== n('SUM(A:B)', 'C1'));
check('function names that look like cells are left alone', n('LOG10(A1)', 'B1').startsWith('LOG10('));
check('numbers are part of the key', n('A1*0.1', 'B1') !== n('A1*0.2', 'B1'));
check('empty formula gives an empty key', n('') === '' && n(null) === '');

// store
const st = new FormulaStore();
const long = '=SUM(' + Array.from({ length: 200 }, (_, i) => 'A' + (i + 1)).join(',') + ')';
st.put('S!A1', long); st.put('S!A2', 'é' + long);
check('the store returns the exact text', st.get('S!A1') === long && st.get('S!A2') === 'é' + long);
check('a key never stored is undefined', st.get('S!Z9') === undefined);
check('the store keeps only offsets in memory', st.mode === 'disk' && st.size === 2);
const bigN = 20000; for (let i = 0; i < bigN; i++) st.put('B!' + i, long + i);
check('thousands of entries read back in any order', st.get('B!19999') === long + 19999 && st.get('B!0') === long + 0 && st.get('S!A1') === long);
st.close();
const idx = { 'S!A1': { formulaText: 'short', formulaTruncated: false } };
check('fullFormula returns short text from the index', fullFormula(idx, 'S!A1') === 'short');

// the cycle behind the 300-character cut
(async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
  const pad = Array.from({ length: 150 }, () => 'B1').join('+');   // about 450 characters: the reference to C1 sits past character 300
  ws.getCell('A1').value = { formula: 'SUM(' + pad + ')+C1' };
  ws.getCell('C1').value = { formula: 'A1' };
  ws.getCell('B1').value = 1;
  ws.getCell('A3').value = { formula: pad + '+' + 'B2+'.repeat(5) + 'B1' };
  const t0 = await runTier0({ _raw: wb, _type: 'exceljs', sheetNames: ['S'] });
  const info = t0.cellScoreIndex['S!A1'];
  check('the display copy is cut at 300 characters', info.formulaText.length <= 303 && info.formulaTruncated === true);
  check('the complete formula is still available', fullFormula(t0.cellScoreIndex, 'S!A1') === 'SUM(' + pad + ')+C1');
  check('the store is not part of the index when listed or serialised', !Object.keys(t0.cellScoreIndex).includes('__formulaStore') && !JSON.stringify(t0.cellScoreIndex).includes('fmstore'));
  check('the store is attached to the index', !!getStore(t0.cellScoreIndex));
  const cycles = circ.findCycles(circ.buildDependencyGraph(t0.cellScoreIndex, ['S']));
  check('a cycle whose reference sits past character 300 is found', cycles.length >= 1);
  const truncatedOnly = {}; for (const [k, v] of Object.entries(t0.cellScoreIndex)) truncatedOnly[k] = { formulaText: v.formulaText };
  check('the same cycle is invisible in the 300-character copy alone (the defect this patch fixes)', circ.findCycles(circ.buildDependencyGraph(truncatedOnly, ['S'])).length === 0);

  // families
  const wb2 = new ExcelJS.Workbook(); const w2 = wb2.addWorksheet('S');
  for (let c = 2; c <= 6; c++) { w2.getCell(2, c).value = { formula: `${String.fromCharCode(64 + c - 1)}2+1` }; }   // filled across
  w2.getCell('B4').value = { formula: 'A4+$A$1' }; w2.getCell('C4').value = { formula: 'B4+$A$1' };               // filled across, anchor kept
  w2.getCell('B5').value = { formula: 'A5+A1' };                                                               // same text, relative anchor
  w2.getCell('B6').value = { formula: 'IF(A6="AB12",1,0)' }; w2.getCell('C6').value = { formula: 'IF(B6="CD99",1,0)' };
  const t2 = await runTier0({ _raw: wb2, _type: 'exceljs', sheetNames: ['S'] });
  const fam = t2.cellScoreIndex;
  check('cells filled across share a family', new Set(['S!B2', 'S!C2', 'S!D2', 'S!E2', 'S!F2'].map(k => fam[k].ufi)).size === 1);
  check('an absolute anchor stays in the family it was filled with', fam['S!B4'].ufi === fam['S!C4'].ufi);
  check('the relative version of that formula is a different family', fam['S!B5'].ufi !== fam['S!B4'].ufi);
  check('formulas that differ only in a text constant are different families', fam['S!B6'].ufi !== fam['S!C6'].ufi);
  check('the family count follows', t2.stats.uniqueFormulaCount === 5);

  // regression
  for (const t of ['test-patch27.js', 'test-patch28.js', 'test-patch29.js', 'test-risk-scoring.js']) {
    let ok = true; try { execFileSync('node', [t], { stdio: 'pipe', timeout: 600000 }); } catch (e) { ok = false; }
    check(t + ' still passes', ok);
  }
  if (fails) { console.log(`\n${fails} check(s) FAILED`); process.exit(1); }
  console.log('\nAll Patch 30 checks pass.');
})();
