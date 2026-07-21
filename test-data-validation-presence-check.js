const ExcelJS = require('exceljs');
const { checkDataValidationPresence } = require('./src/utils/data-validation-presence-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inputs');

  const blue = { color: { argb: 'FF0000FF' } };

  const a1 = ws.getCell('A1'); a1.value = 100; a1.font = blue;
  a1.dataValidation = { type: 'decimal', operator: 'between', formulae: [0, 1000] };

  const a2 = ws.getCell('A2'); a2.value = 200; a2.font = blue; // no validation

  const a3 = ws.getCell('A3'); a3.value = { formula: 'A1*2', result: 200 }; a3.font = blue; // formula cell, must NOT count as input

  const a4 = ws.getCell('A4'); a4.value = 50; // black/default font, not blue -- must NOT count as input

  const result = checkDataValidationPresence(wb);
  console.log('applicable:', result.applicable, '| inputCells:', result.inputCells, '| withValidation:', result.withValidation);
  console.log('coverageFraction:', result.coverageFraction);
  console.log('examplesWithout:', result.examplesWithout);

  const pass = result.applicable && result.inputCells === 2 && result.withValidation === 1
    && result.examplesWithout.includes('Inputs!A2');
  console.log('\n' + (pass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!pass) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
