'use strict';
// Synthetic workbooks for the query resolver and the cell-list remedy check (test-patch37.js). Mirrors the ESO case:
// a tax-rate row typed once, with later rows that link to it, and a reviewer who names a column that is empty.
const fs = require('fs'), os = require('os'), path = require('path');
const ExcelJS = require('exceljs');

const COLS = ['AP', 'AQ', 'AR'];
async function write(wb) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'queryfx-')), 'fixture.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

// variant: 'linked' (all rows link, row 724 through row 653), 'typed' (one typed value in row 694),
//          'calc' (one cell is a calculation), 'colI' (the cited column I holds links)
async function buildTaxWorkbook(variant = 'linked') {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('SystemOperator');
  for (const r of [78, 165, 653, 694, 724]) { s.getCell('E' + r).value = 'Corporation tax rate'; s.getCell('G' + r).value = '%'; }
  for (const c of COLS) {
    s.getCell(c + 78).value = 0.19;
    s.getCell(c + 165).value = { formula: c + '78', result: 0.19 };
    s.getCell(c + 653).value = { formula: c + '78', result: 0.19 };
    s.getCell(c + 694).value = { formula: c + '78', result: 0.19 };
    s.getCell(c + 724).value = { formula: c + '653', result: 0.19 };
  }
  if (variant === 'typed') s.getCell('AQ694').value = 0.2;
  if (variant === 'calc') s.getCell('AR165').value = { formula: 'AR78*1', result: 0.19 };
  if (variant === 'colI') {
    s.getCell('I78').value = 0.19;
    for (const r of [165, 653, 694]) s.getCell('I' + r).value = { formula: 'I78', result: 0.19 };
    s.getCell('I724').value = { formula: 'I653', result: 0.19 };
  }
  return write(wb);
}

const CQ = o => Object.assign({
  id: 'T2-S3-005', record_type: 'Critical Query', sheet: 'SystemOperator', cell: 'I78',
  condition: "SystemOperator rows 78, 165, 653, 694 and 724 all carry the label 'Corporation tax rate' and the stored digest shows 0.190 for all of them.",
  fix_instruction: 'Confirm in Excel that SystemOperator!I165, I653, I694 and I724 are formula references to I78 (or a single named cell), not independently typed values.',
}, o);

module.exports = { buildTaxWorkbook, CQ };
