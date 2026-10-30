'use strict';
// Synthetic workbook for Patch 35: check rows that can and cannot fail, a placeholder row of zeros, a NOW() run stamp.
const fs = require('fs'), os = require('os'), path = require('path');
const ExcelJS = require('exceljs');

async function buildCheckWorkbook() {
  const wb = new ExcelJS.Workbook();
  const m = wb.addWorksheet('M');
  m.getCell('B2').value = 100; m.getCell('B3').value = 7; m.getCell('B4').value = 3; m.getCell('B5').value = 4;
  for (const [r, f, v] of [[5, 'B2*1.1', 110], [6, 'B2*2', 200], [7, 'B2*3', 300]]) m.getCell('C' + r).value = { formula: f, result: v };
  // same cell: both sides read C5:C7
  m.getCell('A20').value = 'Total A'; m.getCell('C20').value = { formula: 'C5+C6+C7', result: 610 };
  m.getCell('A21').value = 'Total B'; m.getCell('C21').value = { formula: 'SUM(C5:C7)', result: 610 };
  m.getCell('A22').value = 'Check'; m.getCell('C22').value = { formula: '(C5+C6)-SUM(C5:C6)', result: 0 };
  m.getCell('A23').value = 'Check'; m.getCell('C23').value = { formula: 'C20-C21', result: 0 };      // two totals of the same cells
  // shared chain: B is built from A
  m.getCell('A30').value = 'Equity'; m.getCell('C30').value = { formula: 'C5+C6', result: 310 };
  m.getCell('A31').value = 'Equity restated'; m.getCell('C31').value = { formula: 'C30*2', result: 620 };
  m.getCell('A32').value = 'Check'; m.getCell('C32').value = { formula: 'C30*2-C31', result: 0 };
  // independent: two different inputs
  m.getCell('A40').value = 'Cash from statements'; m.getCell('C40').value = { formula: 'B3*2', result: 14 };
  m.getCell('A41').value = 'Cash from balance sheet'; m.getCell('C41').value = { formula: 'B4+B5', result: 7 };
  m.getCell('A42').value = 'Check'; m.getCell('C42').value = { formula: 'ROUND(C40-C41*2,2)', result: 0 };
  // not a plain difference
  m.getCell('A50').value = 'Check'; m.getCell('C50').value = { formula: 'IF(C40>0,0,1)', result: 0 };

  const o = wb.addWorksheet('Out');
  const rows = [['Revenue', 10, 11, 12], ['EBITDA', 4, 5, 6], ['Debt', 50, 49, 48], ['Total debt / Capitalisation', 'Formulae to be provided by X', 0, 0], ['Total debt / RAV', 0.5, 0.4, 0.3], ['Interest', 2, 2, 2], ['Tax', 1, 1, 1], ['Dividend', 3, 3, 3], ['Note row', 'TBC', 1, 2]];
  rows.forEach((r, i) => r.forEach((v, j) => { o.getCell(i + 1, j + 1).value = v; }));
  o.getCell('E1').value = 1; o.getCell('F1').value = 1;                          // the Note row's neighbours hold content too

  const r = wb.addWorksheet('Run');
  r.getCell('A1').value = 'Run time'; r.getCell('B1').value = { formula: 'NOW()', result: new Date('2020-12-07T13:08:40Z') };
  r.getCell('A2').value = 1; r.getCell('B2').value = { formula: 'NOW()-A2', result: 46000 };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'checkfx-')), 'fixture.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}
module.exports = { buildCheckWorkbook };

// Patch 36: text labels in date-formatted formula cells (exceljs reads the saved text back as an Invalid Date), and lookups
// whose keys are small calculations.
async function buildLabelWorkbook() {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('P');
  s.getCell('A1').value = 'Label';
  ['FY26', 'FY27', 'FY28'].forEach((t, i) => {
    const c = s.getCell(1, 3 + i);
    c.value = { formula: `"FY"&(${26 + i})`, result: t };
    c.numFmt = 'mmm-yy';                                                    // a date format on a text result
  });
  s.getCell('A2').value = 'Year';
  [2026, 2027, 2028].forEach((y, i) => { s.getCell(2, 3 + i).value = y; });
  s.getCell('A3').value = 'Date'; s.getCell('C3').value = new Date(Date.UTC(2028, 5, 30));
  s.getCell('A4').value = 'Value';
  [10, 20, 30].forEach((v, i) => { s.getCell(4, 3 + i).value = v; });
  // lookups: a label key, a calculated year key, the prior year from a date
  s.getCell('A6').value = 'by label'; s.getCell('C6').value = { formula: 'INDEX($C$4:$E$4,MATCH(D1,$C$1:$E$1,0))', result: 20 };
  s.getCell('A7').value = 'by year from label'; s.getCell('C7').value = { formula: 'INDEX($C$4:$E$4,MATCH(2000+VALUE(RIGHT(E1,2)),$C$2:$E$2,0))', result: 30 };
  s.getCell('A8').value = 'prior year'; s.getCell('C8').value = { formula: 'INDEX($C$4:$E$4,MATCH(YEAR($C$3)-1,$C$2:$E$2,0))', result: 20 };
  s.getCell('A9').value = 'year of range'; s.getCell('C9').value = { formula: 'MATCH(2027,YEAR($C$11:$E$11),0)', result: 2 };
  [new Date(Date.UTC(2026, 5, 30)), new Date(Date.UTC(2027, 5, 30)), new Date(Date.UTC(2028, 5, 30))].forEach((d, i) => { s.getCell(11, 3 + i).value = d; });
  s.getCell('A12').value = 'wrong key'; s.getCell('C12').value = { formula: 'INDEX($C$4:$E$4,MATCH(2000+VALUE(RIGHT(E1,2))+5,$C$2:$E$2,0))', result: 10 };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'labelfx-')), 'labels.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}
module.exports.buildLabelWorkbook = buildLabelWorkbook;
