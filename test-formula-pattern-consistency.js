const ExcelJS = require('exceljs');
const { checkFormulaPatternConsistency, normalizeFormula } = require('./src/utils/formula-pattern-consistency-check');

function unitTests() {
  console.log('=== normalizeFormula unit tests ===');
  let allPass = true;

  const cases = [
    // [formula, baseRow, baseCol, expectedTemplate, description]
    ['=A1+B1', 5, 3, '=R[-4]C[-2]+R[-4]C[-1]', 'basic relative refs'],
    ['=$A$1+B1', 5, 3, '=R1C1+R[-4]C[-1]', 'absolute ref stays literal row/col, relative ref shifts'],
    ["=Timing!C7", 10, 3, '=Timing!R[-3]C[0]', 'sheet-qualified ref normalizes its cell portion (this is THE fix)'],
    ["=Timing!D7", 10, 4, '=Timing!R[-3]C[0]', 'same relative shift on the next column -> SAME template as above'],
    ["=SUM(A1:A5)", 10, 3, '=SUM(R[-9]C[-2]:R[-5]C[-2])', 'range within a function'],
  ];

  for (const [formula, baseRow, baseCol, expected, desc] of cases) {
    const got = normalizeFormula(formula, baseRow, baseCol);
    const pass = got === expected;
    if (!pass) allPass = false;
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) {
      console.log(`  formula: ${formula} @ (row ${baseRow}, col ${baseCol})`);
      console.log(`  expected: ${expected}`);
      console.log(`  got:      ${got}`);
    }
  }

  // The actual bug this was built to catch: confirm no corruption from
  // re-matching a letter+digit substring inside an already-normalized
  // sheet token (e.g. "t1" inside "Sheet1").
  const corruption = normalizeFormula("=Sheet1!B5", 10, 3);
  const noCorruption = corruption === '=Sheet1!R[-5]C[-1]';
  console.log(`${noCorruption ? 'PASS' : 'FAIL'}: no corruption from re-matching inside "Sheet1!..." token (got: ${corruption})`);
  if (!noCorruption) allPass = false;

  return allPass;
}

async function integrationTest() {
  console.log('\n=== checkFormulaPatternConsistency integration test ===');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // Row 20: 5 consistent formula cells (B20:F20, each = 2x the cell above)
  // plus ONE outlier (D20 uses a different structure) — D20 should be
  // the only flagged cell.
  for (const col of ['B', 'C', 'D', 'E', 'F']) {
    ws.getCell(`${col}19`).value = 100;
  }
  ws.getCell('B20').value = { formula: 'B19*2', result: 200 };
  ws.getCell('C20').value = { formula: 'C19*2', result: 200 };
  ws.getCell('D20').value = { formula: 'D19+D19', result: 200 }; // structurally DIFFERENT (add, not multiply)
  ws.getCell('E20').value = { formula: 'E19*2', result: 200 };
  ws.getCell('F20').value = { formula: 'F19*2', result: 200 };

  // Row 30: a legitimate Timing-sheet-referencing row (the exact pattern
  // the sheet-qualified fix exists for) — must NOT be flagged at all.
  for (const [col, letter] of [['B', 'C'], ['C', 'D'], ['D', 'E'], ['E', 'F']]) {
    ws.getCell(`${col}30`).value = { formula: `Timing!${letter}7`, result: 1 };
  }

  // Row 40: only 3 formula cells — below MIN_ROW_LENGTH, must be skipped
  // entirely regardless of consistency.
  ws.getCell('B40').value = { formula: 'B39*2', result: 1 };
  ws.getCell('C40').value = { formula: 'C39+C39', result: 1 };
  ws.getCell('D40').value = { formula: 'D39-D39', result: 1 };

  // Row 50: genuinely heterogeneous — no real majority pattern (5 formulas,
  // all different structures) — must NOT be flagged, since there's no
  // established "the pattern" to deviate from.
  ws.getCell('B50').value = { formula: 'B49*2', result: 1 };
  ws.getCell('C50').value = { formula: 'C49+1', result: 1 };
  ws.getCell('D50').value = { formula: 'D49-1', result: 1 };
  ws.getCell('E50').value = { formula: 'D49*E49', result: 1 };
  ws.getCell('F50').value = { formula: 'AVERAGE(B49:E49)', result: 1 };

  // Row 60: a real row-total pattern — B60:E60 consistent period cells,
  // F60 a SUM() total of the row itself — must NOT be flagged (this is
  // the exact false-positive class found against real The Bend data and
  // fixed before shipping).
  ws.getCell('B60').value = { formula: 'B59*2', result: 1 };
  ws.getCell('C60').value = { formula: 'C59*2', result: 1 };
  ws.getCell('D60').value = { formula: 'D59*2', result: 1 };
  ws.getCell('E60').value = { formula: 'E59*2', result: 1 };
  ws.getCell('F60').value = { formula: 'SUM(B60:E60)', result: 1 };

  const result = checkFormulaPatternConsistency(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '-', f.formula));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['D20'];
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);
  return pass;
}

async function main() {
  const unitPass = unitTests();
  const intPass = await integrationTest();
  if (!unitPass || !intPass) {
    console.log('\nSOME TESTS FAILED');
    process.exit(1);
  }
  console.log('\nALL TESTS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
