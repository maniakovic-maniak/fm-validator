const ExcelJS = require('exceljs');
const { checkAutoSumHeaderInclusion } = require('./src/utils/autosum-header-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // RISK CASE: B10 is a plain literal year (2024), B11/B12 are real data,
  // B13 sums B10:B12 — sweeping the header year into the total.
  ws.getCell('B10').value = 2024; // plain literal, not a formula
  ws.getCell('B11').value = { formula: 'C11*2', result: 500 };
  ws.getCell('B12').value = { formula: 'C12*2', result: 600 };
  ws.getCell('B13').value = { formula: 'SUM(B10:B12)', result: 3124 };

  // STRONGER RISK CASE, with corroborating second-year signal: C10=2024,
  // C11=2025 (both plain literals, ascending), C12 real data, C13 sums all.
  ws.getCell('C10').value = 2024;
  ws.getCell('C11').value = 2025;
  ws.getCell('C12').value = { formula: 'D12*2', result: 700 };
  ws.getCell('C13').value = { formula: 'SUM(C10:C12)', result: 4749 };

  // CLEAN CASE: D20:D22 are genuine data (not year-like), D23 sums them —
  // must NOT be flagged.
  ws.getCell('D20').value = { formula: 'E20*2', result: 100 };
  ws.getCell('D21').value = { formula: 'E21*2', result: 200 };
  ws.getCell('D22').value = { formula: 'E22*2', result: 300 };
  ws.getCell('D23').value = { formula: 'SUM(D20:D22)', result: 600 };

  // CLEAN CASE: top value is a formula result that happens to equal a
  // plausible year (e.g. a genuine calculation producing 2024) — must NOT
  // be flagged, since it's not a pasted-in literal header.
  ws.getCell('E30').value = { formula: 'F30+1', result: 2024 };
  ws.getCell('E31').value = { formula: 'F31*2', result: 400 };
  ws.getCell('E32').value = { formula: 'SUM(E30:E31)', result: 2424 };

  // CLEAN CASE: not a SUM() formula at all.
  ws.getCell('F40').value = 2024;
  ws.getCell('F41').value = { formula: 'AVERAGE(G40:G41)', result: 100 };

  const result = checkAutoSumHeaderInclusion(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '| header:', f.headerCell, '=', f.headerValue, '| corroborated:', f.corroborated));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['B13', 'C13'].sort();
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);

  // Confirm the corroboration signal specifically fired for C13, not B13.
  const c13 = result.findings.find(f => f.cell === 'C13');
  const b13 = result.findings.find(f => f.cell === 'B13');
  const corrobPass = c13 && c13.corroborated === true && b13 && b13.corroborated === false;
  console.log('Corroboration signal correct:', corrobPass ? 'PASS' : 'FAIL');

  if (!pass || !corrobPass) process.exit(1);
  console.log('\nALL TESTS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
