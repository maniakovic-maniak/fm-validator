'use strict';
// Synthetic workbooks that mirror the patterns an independent review found in a licence model, small enough to be
// built in memory. Used by the acceptance baseline (cases 10-14) and by test-patch31.js.
// opts: breakKey (a focus key that exists nowhere in the source), dropYear (one year of an 8-year average becomes text),
//       dupSource (the duplicate-key source), fixSubtotal (the outer SUM no longer repeats the inner subtotal).
const fs = require('fs'), os = require('os'), path = require('path');
const ExcelJS = require('exceljs');

async function buildFixture(opts = {}) {
  const wb = new ExcelJS.Workbook();
  const data = wb.addWorksheet('Data'), calc = wb.addWorksheet('Calc'), avg = wb.addWorksheet('Avg');
  const rat = wb.addWorksheet('Ratios'), fin = wb.addWorksheet('Fin'), inp = wb.addWorksheet('Inputs'), out = wb.addWorksheet('Out');

  // lookups: four focus keys against one source, one duplicate-key source, one missing key
  ['alpha', 'beta', 'gamma', 'delta'].forEach((k, i) => { data.getCell(2 + i, 1).value = k; data.getCell(2 + i, 2).value = (i + 1) * 10; });
  ['dup', 'dup', 'x'].forEach((k, i) => { data.getCell(2 + i, 4).value = k; });
  ['alpha', 'beta', 'gamma', 'delta'].forEach((k, i) => {
    const key = opts.breakKey === k ? k + 'X' : k;
    calc.getCell(1 + i, 1).value = key;
    calc.getCell(1 + i, 2).value = opts.breakKey === k
      ? { formula: `INDEX(Data!$B$2:$B$5,MATCH(A${1 + i},Data!$A$2:$A$5,0))`, result: { error: '#N/A' } }
      : { formula: `INDEX(Data!$B$2:$B$5,MATCH(A${1 + i},Data!$A$2:$A$5,0))`, result: (i + 1) * 10 };
  });
  calc.getCell(5, 1).value = 'dup';
  calc.getCell(5, 2).value = { formula: 'MATCH(A5,Data!$D$2:$D$4,0)', result: 1 };

  // eight-year average
  for (let c = 1; c <= 8; c++) {
    const cell = avg.getCell(1, c + 1);
    if (opts.dropYear && c === 7) cell.value = { formula: 'IF(1=1,"n/a",5)', result: 'n/a' };
    else cell.value = 100 + c;
  }
  avg.getCell(1, 11).value = { formula: 'AVERAGE(B1:I1)', result: opts.dropYear ? (101 + 102 + 103 + 104 + 105 + 106 + 108) / 7 : 104.5 };

  // nested subtotal with two check rows, one of which cannot reach the total
  rat.getCell(1, 1).value = 'Total'; rat.getCell(40, 1).value = 'Checks';
  for (let r = 10; r <= 19; r++) rat.getCell(r, 2).value = 1;
  rat.getCell(20, 2).value = { formula: 'SUM(B10:B19)', result: 10 };
  for (let r = 21; r <= 37; r++) rat.getCell(r, 2).value = 0;
  if (opts.fixSubtotal) rat.getCell(38, 2).value = { formula: 'SUM(B20:B37)', result: 10 };
  else rat.getCell(38, 2).value = { formula: 'SUM(B10:B37)', result: 20 };
  rat.getCell(41, 1).value = 'Balance check'; rat.getCell(41, 2).value = { formula: 'B20-SUM(B10:B19)', result: 0 };
  rat.getCell(42, 1).value = 'Total check'; rat.getCell(42, 2).value = { formula: 'B38-B38', result: 0 };

  // double scaling by a named factor
  inp.getCell(1, 2).value = 0.8;
  wb.definedNames.add('Inputs!$B$1', 'ESOpf');
  fin.getCell(1, 1).value = -8; fin.getCell(2, 1).value = -4;
  out.getCell(1, 2).value = { formula: 'Fin!A1/ESOpf', result: -10 };
  out.getCell(2, 2).value = { formula: 'Fin!A2/ESOpf', result: -5 };
  out.getCell(3, 2).value = { formula: '(B1+B2)/ESOpf', result: -18.75 };
  out.getCell(4, 2).value = { formula: '(-B1/B2)/ESOpf', result: -2.5 };

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pathfx-')), 'fixture.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

async function runFixture(root, opts) {
  const { parseExcel } = require(path.join(root, 'src/parser'));
  const { runTier0 } = require(path.join(root, 'src/validator-tier0'));
  const pcm = require(path.join(root, 'src/utils/path-checks'));
  const { checkNestedSubtotals } = require(path.join(root, 'src/utils/nested-subtotal-check'));
  const { checkDoubleScaling } = require(path.join(root, 'src/utils/double-scaling-check'));
  const file = await buildFixture(opts);
  const parsed = await parseExcel(file);
  const t0 = await runTier0(parsed);
  const pc = pcm.runPathChecks(parsed._raw, t0.cellScoreIndex);
  const ns = checkNestedSubtotals(parsed._raw);
  pcm.addBypassedChecks(ns, parsed._raw, t0.cellScoreIndex);
  const ds = checkDoubleScaling(parsed._raw);
  return { pc, ns, ds, findings: pcm.buildPathCheckFindings(pc) };
}

module.exports = { buildFixture, runFixture };
