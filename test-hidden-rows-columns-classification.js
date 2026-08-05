const ExcelJS = require('exceljs');
const { checkHiddenRowsColumns } = require('./src/utils/fast-standard-checks.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// Synthetic: a hidden row containing a genuine formula must be
// classified as "with logic", separately from a hidden row/column
// containing only text/metadata.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getRow(5).hidden = true;
  ws.getCell('A5').value = { formula: 'SUM(B1:B10)' };
  ws.getColumn(10).hidden = true;
  ws.getCell('J1').value = 'Metadata note';
  ws.getCell('J2').value = 'Source: URWLD register';

  const result = checkHiddenRowsColumns(wb);
  check('a hidden row with a genuine formula is correctly counted in hiddenRowsWithLogicCount',
    result.findings[0].hiddenRowsWithLogicCount === 1);
  check('a hidden column with only text content (no formula) is correctly NOT counted in hiddenColsWithLogicCount',
    result.findings[0].hiddenColsWithLogicCount === 0 && result.findings[0].hiddenColCount === 1);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a sheet with a MIX of live-logic and metadata-only hidden
// content correctly reports both counts distinctly, not blended.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Mixed');
  ws.getRow(3).hidden = true;
  ws.getCell('A3').value = { formula: 'A1+A2' };
  ws.getRow(4).hidden = true;
  ws.getCell('A4').value = 'Just a label';

  const result = checkHiddenRowsColumns(wb);
  check('a sheet with both a live-logic hidden row and a metadata-only hidden row reports both counts distinctly (1 with logic, 2 total)',
    result.findings[0].hiddenRowsWithLogicCount === 1 && result.findings[0].hiddenRowCount === 2);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against the real model — the exact
// contrast the review's claim was built on.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/user-data/uploads/The_Bend_FInancial_Model_3_8_2026.xlsx');
  const result = checkHiddenRowsColumns(wb);

  const valuation = result.findings.find(f => f.sheet === 'VALUATION & RETURNS');
  check('end-to-end: VALUATION & RETURNS\' hidden rows 66-73 (a live scenario-sensitivity calculation) are correctly classified as containing live formula logic',
    valuation && valuation.hiddenRowsWithLogicCount === valuation.hiddenRowCount && valuation.hiddenRowCount > 0);

  const urwld = result.findings.find(f => f.sheet === 'URWLD COMPANY INPUTS');
  check('end-to-end: URWLD COMPANY INPUTS\' hidden columns (pure provenance/metadata headers) are correctly classified as containing NO formula logic',
    urwld && urwld.hiddenColsWithLogicCount === 0 && urwld.hiddenColCount > 0);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
