const ExcelJS = require('exceljs');
const { checkRevenueDoubleCounting } = require('./src/utils/revenue-double-counting-check');

async function main() {
  console.log('=== Case 1: genuine double-count (risk case) ===');
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('P&L');
  // Revenue source lines
  ws1.getCell('B10').value = 500; // Merchandise Revenue
  ws1.getCell('B11').value = 300; // Ticket Revenue
  ws1.getCell('B12').value = 200; // F&B Revenue
  // Two SEPARATE "Total Revenue" aggregations that both include B10
  ws1.getCell('A20').value = 'Total Revenue (Segment A)';
  ws1.getCell('B20').value = { formula: 'SUM(B10:B11)', result: 800 };
  ws1.getCell('A21').value = 'Total Revenue (Group)';
  ws1.getCell('B21').value = { formula: 'SUM(B10:B12)', result: 1000 }; // B10 double-counted here too

  const r1 = checkRevenueDoubleCounting(wb1);
  console.log('applicable:', r1.applicable, '| flaggedCount:', r1.flaggedCount);
  r1.findings.forEach(f => console.log('  ', f.note));

  console.log('\n=== Case 2: no overlap (clean case) ===');
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('P&L');
  ws2.getCell('B10').value = 500;
  ws2.getCell('B11').value = 300;
  ws2.getCell('B12').value = 200;
  ws2.getCell('B13').value = 100;
  ws2.getCell('A20').value = 'Total Revenue (Segment A)';
  ws2.getCell('B20').value = { formula: 'SUM(B10:B11)', result: 800 };
  ws2.getCell('A21').value = 'Total Revenue (Segment B)';
  ws2.getCell('B21').value = { formula: 'SUM(B12:B13)', result: 300 }; // no overlap
  const r2 = checkRevenueDoubleCounting(wb2);
  console.log('applicable:', r2.applicable, '| flaggedCount:', r2.flaggedCount);

  console.log('\n=== Case 3: pass-through link between totals -- must NOT be flagged ===');
  const wb3 = new ExcelJS.Workbook();
  const ws3 = wb3.addWorksheet('P&L');
  ws3.getCell('B10').value = 500;
  ws3.getCell('B11').value = 300;
  ws3.getCell('A20').value = 'Total Revenue';
  ws3.getCell('B20').value = { formula: 'SUM(B10:B11)', result: 800 };
  const ws3b = wb3.addWorksheet('Dashboard');
  ws3b.getCell('A5').value = 'Total Revenue';
  ws3b.getCell('B5').value = { formula: "'P&L'!B20", result: 800 }; // simple link, not a re-SUM
  const r3 = checkRevenueDoubleCounting(wb3);
  console.log('applicable:', r3.applicable, '| flaggedCount:', r3.flaggedCount);

  console.log('\n=== Case 4: only one revenue total found -- nothing to compare ===');
  const wb4 = new ExcelJS.Workbook();
  const ws4 = wb4.addWorksheet('P&L');
  ws4.getCell('B10').value = 500;
  ws4.getCell('A20').value = 'Total Revenue';
  ws4.getCell('B20').value = { formula: 'SUM(B10:B10)', result: 500 };
  const r4 = checkRevenueDoubleCounting(wb4);
  console.log('applicable:', r4.applicable, '| flaggedCount:', r4.flaggedCount, '| note:', r4.note);

  const pass = r1.applicable && r1.flaggedCount === 1
    && r2.applicable && r2.flaggedCount === 0
    && r3.applicable && r3.flaggedCount === 0
    && r4.flaggedCount === 0;
  console.log('\n' + (pass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!pass) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
