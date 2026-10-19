// T1-009 fallback: TRUE/FALSE rows labelled by historic/forecast period count as period flags.
const ExcelJS = require('exceljs'), assert = require('assert');
const { findLabelledPeriodFlagRow } = require('./src/validator-tier1');
const wrap = wb => ({ _raw: wb, _type: 'exceljs' });
const mk = rows => { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); rows.forEach((r, i) => ws.addRow(r)); return wrap(wb); };
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

ok(findLabelledPeriodFlagRow(mk([['Historic totex (FYI only)', null, 'text', true, true, false, false]])), 'logical row labelled Historic totex');
ok(findLabelledPeriodFlagRow(mk([['Historic year (regulatory year < AIP year)', null, null, true, false, false, false]])), 'logical row labelled Historic year');
ok(!findLabelledPeriodFlagRow(mk([['Actual capex', null, null, 42.3, 45.2, 43.9, 59.1]])), 'numbers are not flags');
ok(!findLabelledPeriodFlagRow(mk([['Actual capex', null, null, 0, 1, 0, 1]])), 'numeric 0/1 under a plain money label is not a flag');
ok(findLabelledPeriodFlagRow(mk([['Historical period flag', null, null, 1, 1, 0, 0]])), 'narrow numeric flag still works');
ok(!findLabelledPeriodFlagRow(mk([['Gearing test', null, null, true, false, true, false]])), 'logical row with an unrelated label');
console.log(n + ' check(s) passed');
