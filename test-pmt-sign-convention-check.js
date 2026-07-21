const ExcelJS = require('exceljs');
const { checkPmtSignConsistency } = require('./src/utils/pmt-sign-convention-check');

async function main() {
  console.log('=== Case 1: inconsistent signs (risk case) ===');
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('Debt');
  ws1.getCell('A1').value = { formula: 'PMT(B1/12,C1*12,D1)', result: -5000 }; // positive pv
  ws1.getCell('A2').value = { formula: 'PMT(B2/12,C2*12,-D2)', result: 5000 }; // negative pv
  const r1 = checkPmtSignConsistency(wb1);
  console.log('applicable:', r1.applicable, '| flaggedCount:', r1.flaggedCount);
  if (r1.findings[0]) console.log(' ', r1.findings[0].note);

  console.log('\n=== Case 2: consistent signs (clean case) ===');
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('Debt');
  ws2.getCell('A1').value = { formula: 'PMT(B1/12,C1*12,D1)', result: -5000 };
  ws2.getCell('A2').value = { formula: 'IPMT(B2/12,1,C2*12,D2)', result: -1000 };
  const r2 = checkPmtSignConsistency(wb2);
  console.log('applicable:', r2.applicable, '| flaggedCount:', r2.flaggedCount);

  console.log('\n=== Case 3: no PMT-family calls at all ===');
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('Debt');
  ws3.getCell('A1').value = { formula: 'SUM(B1:C1)', result: 10 };
  const r3 = checkPmtSignConsistency(wb3);
  console.log('applicable:', r3.applicable);

  const pass = r1.applicable && r1.flaggedCount === 1
    && r2.applicable && r2.flaggedCount === 0
    && r3.applicable === false;
  console.log('\n' + (pass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!pass) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
