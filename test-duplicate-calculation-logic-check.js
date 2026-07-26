const { checkDuplicateCalculationLogic } = require('./src/utils/duplicate-calculation-logic-check.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inputs');
  const pl = wb.addWorksheet('P&L');
  const dash = wb.addWorksheet('Dashboard');

  // ── Case 1: the exact scenario described in real feedback — a detail
  // table with a local subtotal, referenced elsewhere via a bare link.
  // This is CORRECT, expected structure and must NOT be flagged: not
  // every individual line item needs to independently reach the
  // financial statements, only the aggregate does, and the aggregate
  // here is computed once and simply linked. ──
  ws.getCell('B5').value = 100000; ws.getCell('B6').value = 250000;
  ws.getCell('B7').value = 80000; ws.getCell('B8').value = 50000;
  ws.getCell('B9').value = { formula: 'SUM(B5:B8)', result: 480000 };
  pl.getCell('B1').value = { formula: "Inputs!B9", result: 480000 }; // a bare reference — the correct "link" pattern

  // ── Case 2: genuine duplication — the exact same aggregate
  // independently rebuilt on a second sheet, not linked to the first.
  // This IS the real risk (compute-once-then-link violated) and must
  // be flagged. ──
  dash.getCell('C1').value = { formula: "SUM(Inputs!B5:B8)", result: 480000 };

  // ── Case 3: the same aggregate repeated down a column on ONE sheet
  // (e.g. monthly totals, each with its own distinct range) — a
  // different, already-covered concern (column-pattern-consistency-
  // check.js), must NOT be flagged here. ──
  ws.getCell('D1').value = { formula: 'SUM(C1:C10)', result: 0 };
  ws.getCell('D2').value = { formula: 'SUM(C11:C20)', result: 0 };

  // ── Case 4: two unrelated SUM formulas with different ranges — must
  // NOT be flagged. ──
  pl.getCell('B2').value = { formula: 'SUM(Inputs!E1:E5)', result: 0 };
  dash.getCell('C2').value = { formula: 'SUM(Inputs!F1:F5)', result: 0 };

  // ── Case 5: the real finding confirmed on the actual uploaded model
  // — two differently-named diagnostic sheets ("Audit QA" and "Model
  // Checks") both independently compute the identical balance-sheet-
  // imbalance formula, character for character, neither linked to the
  // other. Reproduced here exactly as found. ──
  const aqa = wb.addWorksheet('Audit QA');
  const mc = wb.addWorksheet('Model Checks');
  const bs = wb.addWorksheet('Balance Sheet');
  bs.getCell('F50').value = 0; bs.getCell('S50').value = 0;
  aqa.getCell('B30').value = { formula: "MAX(MAX('Balance Sheet'!F50:S50),-MIN('Balance Sheet'!F50:S50))", result: 0 };
  mc.getCell('B5').value = { formula: "MAX(MAX('Balance Sheet'!F50:S50),-MIN('Balance Sheet'!F50:S50))", result: 0 };

  const result = checkDuplicateCalculationLogic(wb);
  console.log('Total findings:', result.flaggedCount);
  result.findings.forEach(f => console.log(`  ${f.fnName} | ${f.occurrences.join(', ')}`));
  console.log('');

  check('the exact real-feedback scenario (detail table + linked subtotal) is NOT flagged',
    !result.findings.some(f => f.occurrences.includes('P&L!B1')));
  check('genuine duplication (same SUM(Inputs!B5:B8) independently rebuilt, not linked) IS flagged',
    result.findings.some(f => f.occurrences.includes('Inputs!B9') && f.occurrences.includes('Dashboard!C1')));
  check('the same aggregate repeated down a column on one sheet, with different ranges, is NOT flagged',
    !result.findings.some(f => f.occurrences.includes('Inputs!D1') || f.occurrences.includes('Inputs!D2')));
  check('two unrelated SUM formulas with different ranges are NOT flagged',
    !result.findings.some(f => f.occurrences.includes('P&L!B2') || f.occurrences.includes('Dashboard!C2')));
  check('the real confirmed finding (Audit QA vs Model Checks, identical MAX formula) IS flagged',
    result.findings.some(f => f.occurrences.includes('Audit QA!B30') && f.occurrences.includes('Model Checks!B5')));

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
