const ExcelJS = require('exceljs');
const { detectRedundantInputs } = require('./src/utils/redundant-inputs.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

function buildSheet(wb, name, cells) {
  const ws = wb.addWorksheet(name);
  for (const [addr, value] of Object.entries(cells)) ws.getCell(addr).value = value;
  return ws;
}

// ══════════════════════════════════════════════════════════════════
// Fix 1: a traceability-mapping sheet (source/target column pattern)
// must be excluded from inputSheets entirely, not just from
// contributing references — confirmed directly that DATA MAP matched
// both isTraceabilityMappingSheet AND sheetHasInputTitleText, so its
// cross-reference-tracking values were being flagged as candidate
// assumptions in their own right.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  buildSheet(wb, 'DATA MAP', {
    A1: 'Source Cell', B1: 'Target Cell', C1: 'Input architecture and dependency controls',
    A2: 'B35', B2: 34400, C2: 'note',
  });
  const result = detectRedundantInputs(wb);
  check('a traceability-mapping sheet (source/target pattern) that ALSO happens to mention "input" text is excluded from inputSheets entirely',
    result.totalInputs === 0);
}

// ══════════════════════════════════════════════════════════════════
// Fix 2: self-labeled meta-statistics ("VISIBLE LINES", "BEND
// RECORDS", "ROWS COLLAPSED") must not be counted as candidate
// assumptions — confirmed directly on URWLD COMPANY INPUTS row 3.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  buildSheet(wb, 'COMPANY INPUTS', {
    A3: 'VISIBLE LINES', B3: 716, C3: 'BEND RECORDS', D3: 877,
    A13: 'Typical venue activities', C13: 'sqm', F13: 15000,
  });
  const result = detectRedundantInputs(wb);
  check('self-labeled meta-statistics (VISIBLE LINES/BEND RECORDS) are excluded from both the count and the redundant list',
    result.totalInputs === 1 && result.redundant.some(r => r.cell === 'F13'));
}

// ══════════════════════════════════════════════════════════════════
// Fix 3: a timing/milestone marker (label contains "start"/"begin",
// value is a small integer) must not be counted — confirmed directly:
// Summary!E11 "Analysis Start"=1, E12 "Construction Start"=1.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  buildSheet(wb, 'Summary Inputs', {
    B11: 'Analysis Start', E11: 1,
    B12: 'Construction Start', E12: 1,
    B20: 'Interest rate assumption', E20: 5.5,
  });
  const result = detectRedundantInputs(wb);
  check('timing-milestone markers (Analysis Start=1, Construction Start=1) are excluded, but a genuine rate assumption is still counted',
    result.totalInputs === 1 && result.redundant.some(r => r.cell === 'E20'));
}

// Confirms a genuine assumption that happens to contain "start" as
// part of a longer, unrelated word is NOT excluded — this pattern
// must not over-match on word fragments.
{
  const wb = new ExcelJS.Workbook();
  buildSheet(wb, 'Assumptions', { B5: 'Starting occupancy rate', E5: 92 });
  const result = detectRedundantInputs(wb);
  check('a genuine assumption ("Starting occupancy rate" = 92, well outside the small-integer timing-marker range) is correctly NOT excluded',
    result.totalInputs === 1 && result.redundant.length === 1);
}

// ══════════════════════════════════════════════════════════════════
// Fix 4: a value of exactly 0 sitting beside an all-caps, multi-word
// section header is a formatting/outline helper cell, not a genuine
// assumption — confirmed directly: Summary!A19 (0) beside B19's "KEY
// ASSUMPTIONS & RETURN METRICS".
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  buildSheet(wb, 'Section Inputs', {
    A19: 0, B19: 'KEY ASSUMPTIONS & RETURN METRICS',
    A20: 0, B20: 'Vacancy allowance',
  });
  const result = detectRedundantInputs(wb);
  check('a 0 beside an all-caps section header is excluded, but a genuine 0-value assumption beside an ordinary label is still counted',
    result.totalInputs === 1 && result.redundant.some(r => r.cell === 'A20'));
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against the real model — the specific
// examples the review cited must now be gone.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile('/mnt/user-data/uploads/The_Bend_FInancial_Model_3_8_2026.xlsx');
  const result = detectRedundantInputs(wb);
  check('end-to-end: DATA MAP no longer contributes any redundant-input findings at all',
    !result.redundant.some(r => r.sheet === 'DATA MAP'));
  check('end-to-end: the specific meta-statistic cells (VISIBLE LINES/BEND RECORDS/ROWS COLLAPSED) no longer appear',
    !result.redundant.some(r => ['VISIBLE LINES', 'BEND RECORDS', 'ROWS COLLAPSED'].includes(r.label)));
  check('end-to-end: the specific timing-flag cells (Analysis Start/Construction Start) no longer appear',
    !result.redundant.some(r => r.label === 'Analysis Start' || r.label === 'Construction Start'));
  check('end-to-end: the specific all-caps-header helper cells (A19/A37) no longer appear',
    !result.redundant.some(r => r.sheet === 'Summary' && (r.cell === 'A19' || r.cell === 'A37')));

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
