// test-formula-logic-checks.js — real ExcelJS-workbook test for
// formula-logic-checks.js. Builds actual cells with actual formulas and
// actual cached values (not just formula text) so both rules are
// genuinely exercised, not just assumed correct from reading the code.

const ExcelJS = require('exceljs');
const { checkNpvPeriodZeroRisk, checkIrrNegativeCashFlowRisk } = require('./src/utils/formula-logic-checks');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // ── NPV test cases ──────────────────────────────────────────────
  // Row 1: RISK CASE — bare "=NPV(...)", nothing added outside it.
  ws.getCell('A1').value = { formula: 'NPV(B1,C1:C10)', result: 1000 };
  // Row 2: CORRECT PATTERN — period-0 investment added separately after.
  ws.getCell('A2').value = { formula: 'NPV(B1,C1:C10)+D2', result: 1000 };
  // Row 3: CORRECT PATTERN — added before.
  ws.getCell('A3').value = { formula: 'D3+NPV(B1,C1:C10)', result: 1000 };
  // Row 4: bare NPV wrapped in an outer function — left alone (out of
  // this narrow check's declared scope), not asserted either way.
  ws.getCell('A4').value = { formula: 'ROUND(NPV(B1,C1:C10),2)', result: 1000 };
  // Row 5: not an NPV formula at all — must never appear in findings.
  ws.getCell('A5').value = { formula: 'SUM(C1:C10)', result: 500 };

  // ── IRR test cases ──────────────────────────────────────────────
  // Deliberately use FORMULA cells for the range values (matching real
  // files — every IRR range sampled from Carlsberg/The Bend was built
  // entirely from formula cells), not plain literal numbers. This is
  // what caught a real bug: a formula cell's .value in ExcelJS is an
  // object ({formula, result} or {sharedFormula, result}), and an
  // earlier version of this check used typeof v === 'number', which
  // silently treated every formula cell as non-numeric.
  // Row 10: RISK CASE — IRR range with no negative value, all formula cells.
  ws.getCell('A10').value = { formula: 'IRR(C10:C15)', result: 0.15 };
  for (let r = 10; r <= 15; r++) {
    ws.getCell(`C${r}`).value = { formula: `B${r}*2`, result: 100 * (r - 9) };
  }
  // Row 20: CLEAN — IRR range DOES contain a negative, via formula cells,
  // including a SHARED formula (a distinct ExcelJS value shape from a
  // plain formula cell — {sharedFormula, result}, no .formula of its own).
  ws.getCell('A20').value = { formula: 'IRR(C20:C25)', result: 0.15 };
  ws.getCell('C20').value = { formula: '-B20', result: -1000 };
  for (let r = 21; r <= 25; r++) {
    ws.getCell(`C${r}`).value = { sharedFormula: 'C20', result: 300 };
  }
  // Row 30: cross-sheet range — out of this check's scope, must be
  // silently skipped, not flagged.
  ws.getCell('A30').value = { formula: "IRR(Other!C1:C10)", result: 0.1 };
  // Row 31: not an IRR formula at all.
  ws.getCell('A31').value = { formula: 'AVERAGE(C1:C10)', result: 50 };

  console.log('=== NPV period-0 risk check ===');
  const npvResult = checkNpvPeriodZeroRisk(wb);
  console.log('flaggedCount:', npvResult.flaggedCount);
  npvResult.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '-', f.formula));

  console.log('\n=== IRR negative-cash-flow risk check ===');
  const irrResult = checkIrrNegativeCashFlowRisk(wb);
  console.log('flaggedCount:', irrResult.flaggedCount);
  irrResult.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '-', f.formula, '| range:', f.range));

  // ── Assertions ──────────────────────────────────────────────────
  const npvFlaggedCells = npvResult.findings.map(f => f.cell).sort();
  const npvExpected = ['A1']; // ONLY the bare, unwrapped NPV case
  const npvPass = JSON.stringify(npvFlaggedCells) === JSON.stringify(npvExpected);

  const irrFlaggedCells = irrResult.findings.map(f => f.cell).sort();
  const irrExpected = ['A10']; // ONLY the no-negative case
  const irrPass = JSON.stringify(irrFlaggedCells) === JSON.stringify(irrExpected);

  console.log('\n=== Results ===');
  console.log('NPV check:', npvPass ? 'PASS' : `FAIL (expected ${JSON.stringify(npvExpected)}, got ${JSON.stringify(npvFlaggedCells)})`);
  console.log('IRR check:', irrPass ? 'PASS' : `FAIL (expected ${JSON.stringify(irrExpected)}, got ${JSON.stringify(irrFlaggedCells)})`);

  if (!npvPass || !irrPass) process.exit(1);
  console.log('\nALL TESTS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
