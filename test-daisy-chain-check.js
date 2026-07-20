const ExcelJS = require('exceljs');
const { checkDaisyChains } = require('./src/utils/daisy-chain-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');
  const ws2 = wb.addWorksheet('Timing');

  // RISK CASE: a 2-hop same-sheet daisy chain where the intermediate
  // cell (C10) is used by NOBODY except D10 -- fan-in of 1, genuinely no
  // reuse value. D10 is the cell that should be flagged.
  ws.getCell('B10').value = { formula: 'X10*2', result: 100 };
  ws.getCell('C10').value = { formula: 'B10', result: 100 };
  ws.getCell('D10').value = { formula: 'C10', result: 100 };

  // RISK CASE: a longer, 3-hop same-sheet chain, unused at every
  // intermediate step -- confirms hop-counting and ultimate-source
  // resolution still work under the new fan-in rule.
  ws.getCell('B20').value = { formula: 'Y20+1', result: 5 };
  ws.getCell('C20').value = { formula: 'B20', result: 5 };
  ws.getCell('D20').value = { formula: 'C20', result: 5 };
  ws.getCell('E20').value = { formula: 'D20', result: 5 };

  // CLEAN CASE: a single link to a real calculation -- must NOT be
  // flagged (this is the CORRECT pattern, not a chain at all).
  ws.getCell('B30').value = { formula: 'Z30*3', result: 30 };
  ws.getCell('C30').value = { formula: 'B30', result: 30 };

  // CLEAN CASE: a single link to a plain input value (no formula at
  // all) -- must NOT be flagged.
  ws.getCell('B40').value = 42;
  ws.getCell('C40').value = { formula: 'B40', result: 42 };

  // RISK CASE (post-fix): a CROSS-sheet daisy chain where the
  // intermediate cell (Timing!B6) is used by NOBODY except C50 -- fan-in
  // of 1. Confirms the fix isn't just "ignore all cross-sheet chains" --
  // a genuinely unused cross-sheet chain must still be caught.
  ws2.getCell('A6').value = { formula: 'V6+1', result: 7 };
  ws2.getCell('B6').value = { formula: 'A6', result: 7 };
  ws.getCell('C50').value = { formula: 'Timing!B6', result: 7 };

  // CLEAN CASE (the real false-positive pattern this fix targets): a
  // local call-up cell (Timing!B7) that is reused by SEVERAL other
  // formulas, not just the one being tested -- real fan-in, a
  // legitimate, deliberate local-reference pattern. Model!C60 links to
  // it, but so do D60 and E60 (via a real calculation, not another bare
  // link) -- must NOT be flagged for C60.
  ws2.getCell('A7').value = { formula: 'W7+1', result: 9 };
  ws2.getCell('B7').value = { formula: 'A7', result: 9 };
  ws.getCell('C60').value = { formula: 'Timing!B7', result: 9 };
  ws.getCell('D60').value = { formula: 'IF(Timing!B7>0,1,0)', result: 1 };
  ws.getCell('E60').value = { formula: 'Timing!B7*2', result: 18 };

  // CLEAN CASE: a real calculation (not a bare link at all) -- must NOT
  // be flagged. Deliberately does not reference C10/B20/etc. above, to
  // avoid accidentally giving those cells real fan-in and invalidating
  // their own test cases.
  ws.getCell('D70').value = { formula: 'Z70*5', result: 200 };

  const result = checkDaisyChains(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, '-> chain to', f.immediateTarget, '(', f.hopCount, 'hops) ultimate source:', f.ultimateSource));

  const flaggedCells = result.findings.map(f => f.sheet + '!' + f.cell).sort();
  const expected = ['Model!D10', 'Model!D20', 'Model!E20', 'Model!C50'].sort();
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);

  const c60Flagged = result.findings.some(f => f.cell === 'C60');
  console.log('C60 (legitimate, reused local call-up) correctly NOT flagged:', !c60Flagged ? 'PASS' : 'FAIL');

  const e20 = result.findings.find(f => f.cell === 'E20');
  const ultimateSourceCorrect = e20 && e20.ultimateSource === 'Model!B20' && e20.hopCount === 3;
  console.log('E20 ultimate source resolves to B20 with 3 hops:', ultimateSourceCorrect ? 'PASS' : `FAIL (got ${e20 ? e20.ultimateSource + ', ' + e20.hopCount + ' hops' : 'not found'})`);

  if (!pass || c60Flagged || !ultimateSourceCorrect) process.exit(1);
  console.log('\nALL TESTS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
