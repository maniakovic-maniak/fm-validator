const ExcelJS = require('exceljs');
const { checkPeriodSequenceGaps } = require('./src/utils/period-sequence-gap-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // RISK CASE: monthly sequence with March skipped (Feb -> Apr).
  const riskMonths = [
    new Date(2024,0,31), new Date(2024,1,29), new Date(2024,3,30), // Feb->Apr, skips March
    new Date(2024,4,31), new Date(2024,5,30), new Date(2024,6,31),
    new Date(2024,7,31),
  ];
  const cols = ['B','C','D','E','F','G','H'];
  riskMonths.forEach((d,i) => { ws.getCell(cols[i]+'10').value = d; });

  // CLEAN CASE: regular monthly sequence, no gaps.
  const cleanMonths = [
    new Date(2024,0,31), new Date(2024,1,29), new Date(2024,2,31),
    new Date(2024,3,30), new Date(2024,4,31), new Date(2024,5,30),
  ];
  cleanMonths.forEach((d,i) => { ws.getCell(cols[i]+'20').value = d; });

  // CLEAN CASE: regular quarterly sequence (different periodicity,
  // should still establish its own modal spacing correctly).
  const cleanQuarters = [
    new Date(2024,0,31), new Date(2024,3,30), new Date(2024,6,31),
    new Date(2024,9,31), new Date(2025,0,31), new Date(2025,3,30),
  ];
  cleanQuarters.forEach((d,i) => { ws.getCell(cols[i]+'30').value = d; });

  // CLEAN CASE: too short a sequence to evaluate.
  [new Date(2024,0,31), new Date(2024,2,31), new Date(2024,4,31)].forEach((d,i) => {
    ws.getCell(cols[i]+'40').value = d;
  });

  const result = checkPeriodSequenceGaps(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet, f.beforeCell, '->', f.afterCell, '|', f.gapDays, 'days vs modal', f.modalGapDays));

  const flaggedRows = result.findings.map(f => f.beforeCell.match(/\d+$/)[0]).sort();
  const expected = ['10'];
  const pass = JSON.stringify(flaggedRows) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedRows)})`);
  if (!pass) process.exit(1);
  console.log('ALL TESTS PASSED');
}
main().catch(e => { console.error(e); process.exit(1); });
