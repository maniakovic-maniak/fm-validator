const ExcelJS = require('exceljs');
const { checkCustomFormatUnitHiding } = require('./src/utils/custom-format-unit-hiding-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // RISK CASES
  const a1 = ws.getCell('A1'); a1.value = 1500000; a1.numFmt = '#,##0,'; // thousands scale
  const a2 = ws.getCell('A2'); a2.value = { formula: 'B2*2', result: 25000000 }; a2.numFmt = '#,##0.0,,'; // millions scale

  // CLEAN CASES
  const b1 = ws.getCell('B1'); b1.value = 1500000; b1.numFmt = '#,##0'; // no scaling
  const b2 = ws.getCell('B2'); b2.value = 1500000; b2.numFmt = 'General';
  const b3 = ws.getCell('B3'); b3.value = 0.15; b3.numFmt = '0.0%'; // percent, no scaling commas

  // CLEAN CASE (the real false-positive class found on The Bend): a
  // scaling format with an embedded unit label baked in -- must NOT be
  // flagged, since the format itself already documents the scale.
  const b4 = ws.getCell('B4'); b4.value = 25000000; b4.numFmt = '$0,,"M"';
  const b5 = ws.getCell('B5'); b5.value = 1500000; b5.numFmt = '"($"#,##0,,"M)";"($"#,##0,,"M)"';

  const result = checkCustomFormatUnitHiding(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet + '!' + f.cell, f.numFmt, '->', f.scaleLabel, 'raw=' + f.rawValue));

  const flaggedCells = result.findings.map(f => f.cell).sort();
  const expected = ['A1', 'A2'].sort();
  const pass = JSON.stringify(flaggedCells) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedCells)})`);
  if (!pass) process.exit(1);
  console.log('ALL TESTS PASSED');
}
main().catch(e => { console.error(e); process.exit(1); });
