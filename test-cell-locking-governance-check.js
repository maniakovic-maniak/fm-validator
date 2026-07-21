const ExcelJS = require('exceljs');
const { checkCellLockingGovernance } = require('./src/utils/cell-locking-governance-check');

async function main() {
  console.log('=== Case 1: protection enabled, with inconsistencies (risk case) ===');
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('Inputs');
  const blue = { color: { argb: 'FF0000FF' } };

  const a1 = ws1.getCell('A1'); a1.value = 100; a1.font = blue; a1.protection = { locked: true }; // RISK: input locked
  const a2 = ws1.getCell('A2'); a2.value = { formula: 'A1*2', result: 200 }; a2.protection = { locked: false }; // RISK: formula unlocked
  const a3 = ws1.getCell('A3'); a3.value = 300; a3.font = blue; a3.protection = { locked: false }; // CLEAN: input correctly unlocked
  const a4 = ws1.getCell('A4'); a4.value = { formula: 'A3*2', result: 600 }; a4.protection = { locked: true }; // CLEAN: formula correctly locked

  ws1.sheetProtection = { sheet: true };

  const r1 = checkCellLockingGovernance(wb1);
  console.log('applicable:', r1.applicable, '| flaggedCount:', r1.flaggedCount);
  r1.findings.forEach(f => console.log('  ', f.cell, f.issue));

  console.log('\n=== Case 2: no protection enabled anywhere -- not applicable ===');
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Inputs');
  ws2.getCell('A1').value = 100; ws2.getCell('A1').font = blue;
  const r2 = checkCellLockingGovernance(wb2);
  console.log('applicable:', r2.applicable, '| note:', r2.note);

  const pass = r1.applicable && r1.flaggedCount === 2
    && r1.findings.some(f => f.cell === 'A1' && f.issue === 'input-locked')
    && r1.findings.some(f => f.cell === 'A2' && f.issue === 'formula-unlocked')
    && r2.applicable === false;
  console.log('\n' + (pass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!pass) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
