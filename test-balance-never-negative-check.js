const ExcelJS = require('exceljs');
const { checkBalanceNeverNegative } = require('./src/utils/balance-never-negative-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // RISK CASE: a cash balance time series that starts at zero (the
  // opening period — the exact case that defeated the single-nearest-
  // value approach earlier), stays positive for a while, then goes
  // negative mid-series.
  ws.getCell('A10').value = 'Closing Cash Balance';
  ws.getCell('B10').value = 0; // opening period, genuinely zero
  ws.getCell('C10').value = { formula: 'B10+100', result: 100 };
  ws.getCell('D10').value = { formula: 'C10+50', result: 150 };
  ws.getCell('E10').value = { formula: 'D10-300', result: -150 }; // THE negative period, buried mid-series
  ws.getCell('F10').value = { formula: 'E10+400', result: 250 };

  // CLEAN CASE: a revolver balance series, always non-negative — must
  // NOT be flagged.
  ws.getCell('A20').value = 'Revolver Balance';
  ws.getCell('B20').value = 0;
  ws.getCell('C20').value = { formula: 'B20+500', result: 500 };
  ws.getCell('D20').value = { formula: 'C20-200', result: 300 };

  // CLEAN CASE: an unrelated label — must NOT be picked up.
  ws.getCell('A30').value = 'Revenue';
  ws.getCell('B30').value = { formula: 'C30*2', result: -50 }; // even a negative revenue value must not match, wrong label

  const result = checkBalanceNeverNegative(wb);
  console.log('flaggedCount (total negative instances):', result.flaggedCount);
  result.results.forEach(r => console.log(' ', r.label, '-> flagged:', r.flagged, '| count:', r.negativeCount));
  result.results.forEach(r => r.negativeInstances.forEach(n => console.log('    ', n.sheet + '!' + n.cell, '=', n.value)));

  const cashFlagged = result.results.find(r => r.label === 'Cash balance');
  const revolverFlagged = result.results.find(r => r.label === 'Revolver balance');
  const pass = cashFlagged && cashFlagged.negativeCount === 1 && cashFlagged.negativeInstances[0].cell === 'E10'
    && !revolverFlagged; // revolver group should have NO entry at all — always non-negative

  console.log('\nResult:', pass ? 'PASS' : 'FAIL');
  if (!pass) process.exit(1);
  console.log('ALL TESTS PASSED');
}

main().catch(e => { console.error(e); process.exit(1); });
