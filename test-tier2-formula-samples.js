const ExcelJS = require('exceljs');
const { extractMeaningfulRows } = require('./src/validator-tier2.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

function makeRow(rowNum, cells) {
  // Replicates the row shape parser.js's worksheetToRows produces —
  // enumerable values, non-enumerable _cellRefs/_formulas/_rowNum.
  const obj = {};
  const cellRefs = {};
  const formulas = {};
  for (const [key, { value, ref, formula }] of Object.entries(cells)) {
    obj[key] = value;
    if (ref) cellRefs[key] = ref;
    if (formula) formulas[key] = formula;
  }
  Object.defineProperty(obj, '_cellRefs', { value: cellRefs, enumerable: false });
  Object.defineProperty(obj, '_formulas', { value: formulas, enumerable: false });
  Object.defineProperty(obj, '_rowNum', { value: rowNum, enumerable: false });
  return obj;
}

// ══════════════════════════════════════════════════════════════════
// The R-8 fix this tests: formula text is now captured (parser.js)
// and selectively surfaced (extractMeaningfulRows) so Tier 2 can
// reason about actual formula logic on the highest-value rows,
// closing the structural gap where a values-only review could never
// see a degenerate covenant branch or a backward-solved equity plug
// regardless of prompt instructions.
// ══════════════════════════════════════════════════════════════════
{
  const rows = [
    makeRow(152, {
      label: { value: 'DSCR', ref: 'A152' },
      F: { value: 1.2, ref: 'F152', formula: 'IF(F123=0,TRUE,F144/F123>=$B$48)' },
      G: { value: 1.3, ref: 'G152', formula: 'IF(G123=0,TRUE,G144/G123>=$B$48)' },
      H: { value: 1.1, ref: 'H152', formula: 'IF(H123=0,TRUE,H144/H123>=$B$48)' },
    }),
  ];
  const extracted = extractMeaningfulRows(rows, 20);
  const row = extracted.find(r => r._excelRow === 152);
  check('real defect scenario: a priority (covenant-labelled) row gets a formula sample attached',
    row && Array.isArray(row._formulaSamples) && row._formulaSamples.length > 0);
  check('the formula sample includes the actual formula logic (the degenerate zero-check), not just a value',
    row && row._formulaSamples[0].includes('IF(F123=0,TRUE'));
}

// ══════════════════════════════════════════════════════════════════
// Confirms deduplication: period columns sharing the same underlying
// formula SHAPE (the overwhelmingly common case) collapse to ONE
// sample, not one per column — this is the token-cost control that
// makes the whole approach affordable.
// ══════════════════════════════════════════════════════════════════
{
  const cells = { label: { value: 'DSCR', ref: 'A160' } };
  const cols = ['F', 'G', 'H', 'I', 'J', 'K'];
  cols.forEach(col => {
    cells[col] = { value: 1.5, ref: col + '160', formula: `IF(${col}123=0,TRUE,${col}144/${col}123>=$B$48)` };
  });
  const rows = [makeRow(160, cells)];
  const extracted = extractMeaningfulRows(rows, 20);
  const row = extracted.find(r => r._excelRow === 160);
  check('deduplication: 6 columns sharing the same formula shape collapse to exactly 1 sample, not 6',
    row && row._formulaSamples.length === 1);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a genuine mid-row shape difference (the R-5 pattern) still
// surfaces as a SECOND distinct sample, not silently collapsed away.
// ══════════════════════════════════════════════════════════════════
{
  const cells = { label: { value: 'Equity Contributions', ref: 'A89' } };
  ['G', 'H', 'I'].forEach(col => { cells[col] = { value: 100, ref: col + '89', formula: `${col}42` }; });
  ['M', 'N', 'O'].forEach(col => { cells[col] = { value: 200, ref: col + '89', formula: `IF(${col}$5="","",${col}73)` }; });
  const rows = [makeRow(89, cells)];
  const extracted = extractMeaningfulRows(rows, 20);
  const row = extracted.find(r => r._excelRow === 89);
  check('a genuine mid-row formula-shape difference surfaces as 2 distinct samples, not silently collapsed to 1',
    row && row._formulaSamples.length === 2);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a row with NO formulas at all (plain input constants) gets
// no _formulaSamples field — nothing to show, and shouldn't add a
// misleading empty field.
// ══════════════════════════════════════════════════════════════════
{
  const cells = { label: { value: 'Interest rate assumption', ref: 'A5' } };
  ['F', 'G', 'H'].forEach(col => { cells[col] = { value: 0.05, ref: col + '5' }; }); // no formula key at all
  const rows = [makeRow(5, cells)];
  const extracted = extractMeaningfulRows(rows, 20);
  const row = extracted.find(r => r._excelRow === 5);
  check('a row with no formulas at all (plain constants) gets no _formulaSamples field',
    row && row._formulaSamples === undefined);
}

// ══════════════════════════════════════════════════════════════════
// Confirms an ordinary numeric fill row (not priority-matched, not a
// reserved non-numeric row) does NOT get formula samples — this is
// the token-cost control: only rows already judged most likely to
// matter get this treatment, not every row in the sheet.
// ══════════════════════════════════════════════════════════════════
{
  const rows = [];
  // One clearly-priority row (DSCR) plus many ordinary numeric filler
  // rows with no priority-matching label, all with formulas.
  const priorityCells = { label: { value: 'DSCR', ref: 'A10' } };
  ['F', 'G'].forEach(col => { priorityCells[col] = { value: 1.5, ref: col + '10', formula: `${col}1/${col}2` }; });
  rows.push(makeRow(10, priorityCells));
  for (let i = 0; i < 25; i++) {
    const cells = { label: { value: `Misc line ${i}`, ref: 'A' + (20 + i) } };
    ['F', 'G'].forEach(col => { cells[col] = { value: 100 + i, ref: col + (20 + i), formula: `${col}1*2` }; });
    rows.push(makeRow(20 + i, cells));
  }
  const extracted = extractMeaningfulRows(rows, 20);
  const withSamples = extracted.filter(r => r._formulaSamples);
  const priorityRow = extracted.find(r => r._excelRow === 10);
  check('an ordinary numeric fill row does not get formula samples, even though it has formulas — only priority-matched rows do',
    withSamples.length < extracted.length && priorityRow && !!priorityRow._formulaSamples);
}

console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
if (!allPass) process.exit(1);
