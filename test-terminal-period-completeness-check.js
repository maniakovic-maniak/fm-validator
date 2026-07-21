const ExcelJS = require('exceljs');
const { checkTerminalPeriodCompleteness } = require('./src/utils/terminal-period-completeness-check');

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');

  // RISK CASE: row 10, columns B-K (10 periods). Stable ~1000 for 8
  // periods, then a SUDDEN drop to zero in the last 2 -- the genuine
  // omission pattern.
  const cols = ['B','C','D','E','F','G','H','I','J','K'];
  const riskVals = [1000,1020,980,1010,995,1005,990,1000,0,0];
  riskVals.forEach((v,i) => {
    ws.getCell(cols[i]+'10').value = { formula: `${cols[i]}9*1.0`, result: v };
  });

  // CLEAN CASE: row 20, a genuine gradual wind-down -- declining
  // smoothly toward zero over the WHOLE established window too, not a
  // sudden cliff. Must NOT be flagged.
  const windDownVals = [1000,800,600,500,400,300,20,5];
  windDownVals.forEach((v,i) => {
    ws.getCell(cols[i]+'20').value = { formula: `${cols[i]}19*0.8`, result: v };
  });

  // CLEAN CASE: row 30, consistently healthy values all the way through,
  // no terminal drop at all.
  const healthyVals = [1000,1010,1005,995,1002,998,1001,1003,999,1000];
  healthyVals.forEach((v,i) => {
    ws.getCell(cols[i]+'30').value = { formula: `${cols[i]}29*1.0`, result: v };
  });

  // CLEAN CASE: row 40, too short a series to evaluate (< 8 periods).
  ['B','C','D','E'].forEach((c,i) => {
    ws.getCell(c+'40').value = { formula: `${c}39*1.0`, result: 1000 };
  });

  // CLEAN CASE: row 50, a sparse one-time cost row (mostly zero, one
  // spike) -- the exact false-positive class found against real
  // Construction Timeline data. Must NOT be flagged.
  const sparseVals = [0,0,0,0,10000,0,0,0,0,0];
  sparseVals.forEach((v,i) => {
    ws.getCell(cols[i]+'50').value = { formula: `${cols[i]}49*1.0`, result: v };
  });

  // CLEAN CASE (the real false-positive class found on a real
  // property/development model): a labelled construction-cost
  // aggregate that stays stable then genuinely drops to zero at
  // project completion -- must NOT be flagged, even though the raw
  // values look identical to the genuine risk case (row 10).
  ws.getCell('A60').value = 'TOTAL USES';
  riskVals.forEach((v,i) => {
    ws.getCell(cols[i]+'60').value = { formula: `${cols[i]}59*1.0`, result: v };
  });

  const result = checkTerminalPeriodCompleteness(wb);
  console.log('flaggedCount:', result.flaggedCount);
  result.findings.forEach(f => console.log(' ', f.sheet, 'row', f.row, '-', f.terminalCells, 'avg was', f.establishedAvg));

  const flaggedRows = result.findings.map(f => f.row).sort();
  const expected = [10];
  const pass = JSON.stringify(flaggedRows) === JSON.stringify(expected);
  console.log('\nResult:', pass ? 'PASS' : `FAIL (expected ${JSON.stringify(expected)}, got ${JSON.stringify(flaggedRows)})`);
  if (!pass) process.exit(1);
  console.log('ALL TESTS PASSED');
}
main().catch(e => { console.error(e); process.exit(1); });
