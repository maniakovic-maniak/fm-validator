'use strict';
// Deterministic evidence for rules like "outputs are not manually overwritten" (T2-S13-008).
//
// The reviewer reads formula text and can see that output cells are formula-driven, but cannot be
// SURE no value was pasted over a formula somewhere, because that needs a full pass over every cell.
// That is exactly what code is good at. This scan produces facts only - it never decides a verdict:
// the facts go into the Tier 2 prompt (the same way the recalculation result does) and the reviewer
// concludes from them.
//
// What it looks for: a numeric CONSTANT sitting between FORMULA cells in the same row (a formula to its
// left and another to its right). That is the signature of a value pasted over a formula in a row of
// formulas. A constant at the start of a row (a start year, an opening balance followed by formulas)
// is normal and deliberately not counted.
//
// What it cannot see, and the note says so: whole rows pasted as values (no formulas left to compare
// against), values pasted into sheets it did not scan, and constants that are legitimate inputs.

const OUTPUT_NAME_RE = /output|summary|dashboard|kpi|rore|result|report|scorecard|ratio/i;
// Names that suggest a stored-results archive, which legitimately holds pasted values.
const ARCHIVE_NAME_RE = /scenariorun|saved|archive|snapshot|backup|history/i;

// grid: array of rows; each row is an array of 'f' (formula), 'n' (numeric constant) or other/undefined.
// Returns counts plus the interior constants as {row, col} (0-based) so callers can name the cells.
function analyseGrid(grid) {
  let formulas = 0, constants = 0;
  const between = [];
  grid.forEach((row, r) => {
    if (!row) return;
    let firstF = -1, lastF = -1;
    row.forEach((k, c) => {
      if (k === 'f') { formulas++; if (firstF < 0) firstF = c; lastF = c; }
      else if (k === 'n') constants++;
    });
    if (firstF < 0 || lastF === firstF) return;           // need formulas on BOTH sides of a constant
    row.forEach((k, c) => { if (k === 'n' && c > firstF && c < lastF) between.push({ row: r, col: c }); });
  });
  return { formulas, constants, between };
}

function colLetter(n) { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function classify(cell) {
  const v = cell.value;
  if (cell.type === 6) return 'f';                                   // ExcelJS ValueType.Formula
  if (v && typeof v === 'object' && !(v instanceof Date) && (v.formula !== undefined || v.sharedFormula !== undefined)) return 'f';
  if (typeof v === 'number') return 'n';
  return 'o';
}

function scanOutputSheets(parsed, { maxSheets = 8, maxSamples = 5 } = {}) {
  if (!parsed || !parsed._raw || parsed._type !== 'exceljs') return null;   // other parsers: say nothing rather than guess
  const wb = parsed._raw;
  const scanned = [], notScanned = [];
  wb.eachSheet(ws => {
    if (!OUTPUT_NAME_RE.test(ws.name)) return;
    if (ARCHIVE_NAME_RE.test(ws.name)) { notScanned.push(ws.name); return; }
    const grid = [];
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      const arr = [];
      row.eachCell({ includeEmpty: false }, (cell, cn) => { arr[cn - 1] = classify(cell); });
      grid[rn - 1] = arr;
    });
    const a = analyseGrid(grid);
    scanned.push({
      sheet: ws.name, formulaCells: a.formulas, numericConstants: a.constants, constantsBetweenFormulas: a.between.length,
      samples: a.between.slice(0, maxSamples).map(p => `${colLetter(p.col)}${p.row + 1}`)
    });
  });
  const shown = scanned.slice(0, maxSheets);
  const totalBetween = scanned.reduce((s, x) => s + x.constantsBetweenFormulas, 0);
  const lines = shown.map(x => `${x.sheet}: ${x.formulaCells.toLocaleString()} formula cells, ${x.numericConstants.toLocaleString()} numeric constants, ${x.constantsBetweenFormulas} constant(s) sitting between formulas in the same row${x.samples.length ? ' (e.g. ' + x.samples.join(', ') + ')' : ''}`);
  const note = scanned.length === 0
    ? 'No sheet with an output-style name (Output, Summary, Dashboard, KPI, RoRE, Results, Report, Ratios) was found, so no output sheet was scanned. This is not evidence either way about overwritten outputs.'
    : `Every cell of ${scanned.length} output-style sheet(s) was checked for values pasted over formulas, meaning a numeric constant with a formula on both sides of it in the same row. ${lines.join('; ')}${scanned.length > shown.length ? `; and ${scanned.length - shown.length} more sheet(s)` : ''}.` +
      (notScanned.length ? ` Not scanned (names suggest stored-results archives, which legitimately hold pasted values): ${notScanned.join(', ')}.` : '') +
      ` A count of 0 means no pasted-over value of that kind exists in the scanned sheets. It does not cover whole rows pasted as values, other sheets, or whether a flagged constant is a legitimate input.`;
  return { scanned, notScanned, totalBetween, note, summaryLine: `${scanned.length} output sheet(s) scanned, ${totalBetween} constant(s) between formulas${notScanned.length ? `, ${notScanned.length} archive-style sheet(s) skipped` : ''}` };
}

module.exports = { scanOutputSheets, analyseGrid, OUTPUT_NAME_RE, ARCHIVE_NAME_RE };
