'use strict';
// sum-range-scan.js - Patch 26. A deterministic pass over every simple SUM / SUMIFS range, because the reviewer
// (which sees a sample) cannot say whether the ranges "cover the full time series without gaps or double counts".
//
// What it does, from the formulas alone and with no labels:
//   1. Reads every cell whose formula holds SUM(<range>) or SUMIFS(<sum range>, ...) (the first such call; the rest of
//      the formula, for example "- SUM($AO363:AO363) * AP360", is ignored).
//   2. Groups them by sheet and row (a time series is one row copied across the period columns) and gives each cell a
//      shape: which columns the range starts and ends on (fixed with $, or relative to the cell) and which rows.
//   3. Names the modal shape of each row: FIXED (same cells every period), RUNNING TOTAL (starts at a fixed column,
//      ends at the current one - a cumulative sum, which is correct for e.g. an allowance on cumulative cost) or
//      ROLLING (moves with the cell).
//   4. Flags a cell in the MIDDLE of a row whose shape differs from the rest in the same direction (a vertical total
//      that points at a neighbouring column in one period, a range that stops short or starts late). A sum in the
//      other direction, such as a yearly total among monthly columns, is expected and is not flagged. The first two cells of a row are the series boundary and are not flagged.
//
// What it does not do: it does not know what a range should cover. A range that is wrong in every period looks
// consistent. It reports what it scanned so a reader can see the limits, and it skips anything more elaborate than
// one range (multi-area sums, SUM of several arguments), and a formula that holds more than one SUM is read by its
// first one only.

const REF = "(?:(?:'[^']+'|[A-Za-z0-9_.]+)!)?(\\$?)([A-Z]{1,3})(\\$?)(\\d+)";
const RANGE_RE = new RegExp('\\b(SUMIFS|SUM)\\s*\\(\\s*' + REF + '\\s*:\\s*' + REF + '\\s*([),])', 'i');
const MIN_CELLS_PER_ROW = 4;
const BOUNDARY_CELLS = 2;
const MAX_FINDINGS = 200;

function colNum(c) { let n = 0; for (const ch of c.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

function shapeOf(m, colN) {
  const fn = m[1].toUpperCase();
  const tail = m[10];
  if (fn === 'SUM' && tail !== ')') return null;            // SUM(range, more...) is not a simple range
  const c1 = colNum(m[3]), r1 = +m[5], c2 = colNum(m[7]), r2 = +m[9];
  const abs1 = m[2] === '$', abs2 = m[6] === '$';
  if (r1 === r2 && c1 === c2) return null;                  // a single cell is not a range
  const start = abs1 ? 'A' + c1 : 'r' + (c1 - colN);
  const end = abs2 ? 'A' + c2 : 'r' + (c2 - colN);
  const kind = abs1 && abs2 ? 'fixed' : abs1 && !abs2 ? 'running' : !abs1 && !abs2 ? 'rolling' : 'other';
  const orient = c1 === c2 ? 'v' : r1 === r2 ? 'h' : 'b';
  return { orient, sig: start + '|' + r1 + '|' + end + '|' + r2, kind, c1, r1, c2, r2, abs1, abs2 };
}

function rangeText(s, colN) {
  // Rebuild the range text a person would read, for the sample.
  return `${s.abs1 ? '$' : ''}${colName(s.c1)}${s.r1}:${s.abs2 ? '$' : ''}${colName(s.c2)}${s.r2}`;
}

function scanSumRanges(workbook) {
  const rows = new Map();   // "sheet|row" -> { sheet, row, cells: [{col, shape}] }
  let cellsSeen = 0;

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colN) => {
        const f = cell.formula || (cell.value && cell.value.formula);
        if (!f) return;
        const text = String(f);
        if (text.length > 400 || !/SUM/i.test(text)) return;
        const m = RANGE_RE.exec(text);
        if (!m) return;
        const shape = shapeOf(m, colN);
        if (!shape) return;
        cellsSeen++;
        const key = ws.name + '|' + rowNum;
        let g = rows.get(key);
        if (!g) { g = { sheet: ws.name, row: rowNum, cells: [] }; rows.set(key, g); }
        g.cells.push({ col: colN, shape });
      });
    });
  });

  const kinds = { fixed: 0, running: 0, rolling: 0, other: 0, irregular: 0, tooShort: 0 };
  const runningRows = [];
  const findings = [];
  let rowsScanned = 0;

  for (const g of rows.values()) {
    if (g.cells.length < MIN_CELLS_PER_ROW) { kinds.tooShort++; continue; }
    rowsScanned++;
    g.cells.sort((a, b) => a.col - b.col);
    const counts = new Map();
    for (const c of g.cells) counts.set(c.shape.sig, (counts.get(c.shape.sig) || 0) + 1);
    let modal = null, modalN = 0;
    for (const [sig, n] of counts) if (n > modalN) { modal = sig; modalN = n; }
    if (modalN / g.cells.length < 0.5) { kinds.irregular++; continue; }
    const first = g.cells.find(c => c.shape.sig === modal);
    kinds[first.shape.kind]++;
    if (first.shape.kind === 'running' && runningRows.length < 30) {
      runningRows.push({ sheet: g.sheet, row: g.row, sample: `${colName(first.col)}${g.row} =SUM(${rangeText(first.shape, first.col)})`, cells: g.cells.length });
    }
    // Mid-row deviants only: the first cells are where a series starts and often differ on purpose.
    // A period total in the same row (a horizontal sum among vertical ones, or the reverse) differs on purpose.
    const deviants = g.cells.slice(BOUNDARY_CELLS).filter(c => c.shape.sig !== modal && c.shape.orient === first.shape.orient);
    if (deviants.length && deviants.length <= Math.max(3, Math.floor(g.cells.length * 0.2)) && findings.length < MAX_FINDINGS) {
      const d = deviants[0];
      findings.push({
        sheet: g.sheet, row: g.row, cell: colName(d.col) + g.row, instanceCount: deviants.length, rowCells: g.cells.length,
        kind: first.shape.kind,
        usual: `${colName(first.col)}${g.row} =SUM(${rangeText(first.shape, first.col)})`,
        different: `${colName(d.col)}${g.row} =SUM(${rangeText(d.shape, d.col)})`,
        note: `In ${g.sheet} row ${g.row}, ${deviants.length} of ${g.cells.length} period formula(s) cover a different range from the rest of the row.`
      });
    }
  }

  return {
    applicable: cellsSeen > 0,
    cellsScanned: cellsSeen,
    rowsScanned,
    kinds,
    runningRows,
    flaggedCount: findings.length,
    findings,
    note: 'Simple SUM and SUMIFS ranges only. A range that is wrong in every period of a row looks consistent and is not found here.'
  };
}

module.exports = { scanSumRanges, shapeOf, RANGE_RE };
