'use strict';
// Patch 51: (1) T1-013 says where the hidden live content is; (2) a labelled rate row of constant zeros used as a multiplier is raised as a Query.
const fs = require('fs');
const ExcelJS = require('exceljs');
const { checkZeroRateMultipliers, usedAsScaler, refsIn } = require('./src/utils/zero-rate-multiplier-check');
const icaew = require('./src/utils/validator-tier1-icaew-additions');
let fails = 0;
const check = (n, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${n}`); if (!ok) fails++; };
const rule = { id: 'T1-013', label: 'x', severity: 'high', fix_instruction: 'x' };

function rateBook(opts = {}) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Rates');
  ws.getCell('B5').value = opts.label || 'Corporation tax rate'; ws.getCell('C5').value = '%';
  const vals = opts.values || [0, 0, 0, 0, 0];
  vals.forEach((v, i) => { ws.getCell(5, 4 + i).value = v; });
  ws.getCell('B9').value = 'Incentives';
  for (let i = 0; i < 5; i++) {
    const col = String.fromCharCode(68 + i);
    ws.getCell(`${col}8`).value = 100;
    if (!opts.noUse) ws.getCell(`${col}9`).value = { formula: opts.formula ? opts.formula(col) : `${col}$8*(1-${col}$5)` };
  }
  return wb;
}

// --- zero-rate check
let r = checkZeroRateMultipliers(rateBook());
check('an all-zero tax-rate row used in (1 - rate) is raised once', r.flaggedCount === 1 && r.findings[0].cell === 'D5' && r.findings[0].userCount === 5 && r.findings[0].uses[0] === '(1 - rate)');
check('the finding names the label, the range and an example user', /Rates!B5 "Corporation tax rate"/.test(r.findings[0].note) && /D5:H5/.test(r.findings[0].note) && /Rates!D9/.test(r.findings[0].note));
r = checkZeroRateMultipliers(rateBook({ values: [0, 0, 0.3, 0, 0] }));
check('a row with any non-zero value is not flagged', r.flaggedCount === 0);
r = checkZeroRateMultipliers(rateBook({ noUse: true }));
check('a zero rate nothing uses is not flagged', r.flaggedCount === 0);
r = checkZeroRateMultipliers(rateBook({ values: [0, 0] }));
check('fewer than three zero cells is not a series', r.flaggedCount === 0);
r = checkZeroRateMultipliers(rateBook({ label: 'Effective tax rate' }));
check('a computed ("effective") rate is skipped', r.flaggedCount === 0);
r = checkZeroRateMultipliers(rateBook({ label: 'Base rate' }));
check('base rates are left to the existing base-rate check', r.flaggedCount === 0);
r = checkZeroRateMultipliers(rateBook({ formula: c => `${c}8*${c}5` }));
check('a plain multiplier is flagged', r.flaggedCount === 1 && r.findings[0].uses[0] === 'multiplier');
r = checkZeroRateMultipliers(rateBook({ formula: c => `${c}8/${c}5` }));
check('a divisor is flagged', r.flaggedCount === 1 && r.findings[0].uses[0] === 'divisor');
r = checkZeroRateMultipliers(rateBook({ formula: c => `SUM(${c}5:${c}5)+${c}8` }));
check('a reference that is only summed is not a multiplier', r.flaggedCount === 0);
r = checkZeroRateMultipliers(rateBook({ values: [0.1, 0.1, 0.1, 0.1, 0.1] }));
check('a real rate is never flagged', r.flaggedCount === 0);
{
  const wb = rateBook(); const o = wb.addWorksheet('Other'); o.getCell('A1').value = { formula: "Rates!D8*(1-Rates!D5)" };
  const rr = checkZeroRateMultipliers(wb);
  check('a use from another sheet is counted', rr.findings[0].userCount === 6);
}
check('scaler detection reads the text around the reference', usedAsScaler('A1*(1 - B2)', refsIn('A1*(1 - B2)')[1]) === '(1 - rate)' && usedAsScaler('SUM(B2)', refsIn('SUM(B2)')[0]) === null);

// --- hidden content message
{
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Calc');
  for (let i = 1; i <= 12; i++) { ws.getCell(`A${i}`).value = i; ws.getCell(`B${i}`).value = { formula: `A${i}*2` }; }
  for (const n of [3, 4, 5, 9]) ws.getRow(n).hidden = true;
  ws.getColumn(2).hidden = true;
  const res = icaew.hidden_rows_columns_present(wb, rule);
  check('T1-013 still fails and keeps one finding per hidden row or column', res.status === 'fail' && res.findings.length === 5);
  check('the message gives formula and constant counts', /contain live content: \d+ formula cell\(s\) and \d+ constant\(s\) on 1 sheet\(s\)/.test(res.message));
  check('the message gives the sheet and the ranges', /Calc: rows 3-5, 9; column B/.test(res.message));
  const wb2 = new ExcelJS.Workbook(); const w2 = wb2.addWorksheet('Plain'); w2.getCell('A1').value = 1; w2.getRow(50).hidden = true;
  check('a hidden empty row beyond the data is still not flagged', icaew.hidden_rows_columns_present(wb2, rule).status === 'pass');
}

for (const f of ['server.js', 'index.js']) {
  const src = fs.readFileSync(f, 'utf8');
  check(`${f} runs the zero-rate scan and raises it as a Query`, /checkZeroRateMultipliers\(parsed\._raw\)/.test(src) && /T0-ZERORATE-/.test(src) && /record_type: 'Query'/.test(src.slice(src.indexOf('T0-ZERORATE-'), src.indexOf('T0-ZERORATE-') + 2500)));
}

const eso = '/mnt/user-data/uploads/Final_Determinations_-_ESO_Licence_Model.xlsm';
if (fs.existsSync(eso)) {
  (async () => {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(eso);
    const z = checkZeroRateMultipliers(wb);
    check('ESO: RoRE ranges row 52 (Corporation tax rate, AP52:AT52) is found with its formula users', z.flaggedCount === 1 && z.findings[0].sheet === 'RoRE ranges' && z.findings[0].range === 'AP52:AT52' && z.findings[0].userCount >= 5);
    const h = icaew.hidden_rows_columns_present(wb, rule);
    check('ESO: T1-013 keeps its 397 count and now lists where', h.findings.length === 397 && /SystemOperator: columns K-AO/.test(h.message));
    console.log(fails ? `${fails} FAILED` : 'All Patch 51 checks passed'); process.exit(fails ? 1 : 0);
  })();
} else { console.log('skip: ESO model not on this machine'); console.log(fails ? `${fails} FAILED` : 'All Patch 51 checks passed'); process.exit(fails ? 1 : 0); }
