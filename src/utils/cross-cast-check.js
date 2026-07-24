// cross-cast-check.js — sourced from "Spreadsheet Modelling Best
// Practice" (ICAEW-published, Business Dynamics / Coopers & Lybrand,
// 1999), found in a book-mining pass. The book's own worked example:
// a grid with monthly columns and a "Total" row at the bottom, plus a
// revenue-category breakdown with its own "Total" column on the right.
// Cross-casting verifies these two independently-computed grand totals
// agree — =IF(SUM(totals_row)<>SUM(totals_column),"Warning: totals do
// not match","") is the book's own literal formula. In the book's
// example, a missing "Other revenue" line in the totals row broke
// exactly this check, catching a real incomplete-aggregation error
// that neither total alone would reveal.
//
// Deliberately conservative: only fires when a "Total" row label and a
// "Total" column header can both be confidently identified on the same
// sheet, within a bounded, plausible distance of each other, and only
// compares CACHED VALUES (matching this project's established
// "read cached results, don't re-evaluate formulas" approach) with a
// rounding tolerance, per the book's own recommendation to guard
// against Excel's floating-point display-vs-storage mismatch.

const TOTAL_LABEL_RE = /\btotal\b/i;
const MAX_TABLE_SPAN = 100; // rows/columns — a table larger than this is unlikely to be a single cross-castable grid; avoid pathological scans
const ROUNDING_TOLERANCE = 0.5; // absolute; matches the book's own guidance to round before comparing, avoiding Excel's stored-vs-displayed precision mismatch

// FIX: caught before shipping — a naive String.fromCharCode(64+n)
// column-letter conversion only works for single-letter columns (A-Z);
// a financial model with monthly columns across many years commonly
// has columns well past Z (AA, AB, ...), which would have produced
// garbage characters in the finding's cell references.
function numToCol(n) {
  let s = '';
  while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function isNumeric(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function cellNumericValue(cell) {
  const v = cell.value;
  if (isNumeric(v)) return v;
  if (v && typeof v === 'object' && isNumeric(v.result)) return v.result; // a formula cell's cached result
  return null;
}

function checkCrossCasting(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    // Find candidate "Total" row labels: a label-shaped cell in the
    // sheet's leftmost few columns containing the word "total".
    const totalRows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      for (let c = 1; c <= 3; c++) {
        const cell = row.getCell(c);
        if (typeof cell.value === 'string' && TOTAL_LABEL_RE.test(cell.value)) {
          totalRows.push({ rowNum, labelCol: c, labelText: cell.value });
          break;
        }
      }
    });

    // Find candidate "Total" column headers: a label-shaped cell in
    // the sheet's topmost few rows containing the word "total".
    const totalCols = [];
    for (let r = 1; r <= 5; r++) {
      const row = ws.getRow(r);
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (typeof cell.value === 'string' && TOTAL_LABEL_RE.test(cell.value)) {
          totalCols.push({ colNum, headerRow: r, headerText: cell.value });
        }
      });
    }

    if (totalRows.length === 0 || totalCols.length === 0) return;

    for (const tr of totalRows) {
      for (const tc of totalCols) {
        if (Math.abs(tr.rowNum - tc.headerRow) > MAX_TABLE_SPAN) continue;
        if (tc.colNum <= tr.labelCol) continue; // the total column must be to the right of the row's own label, not overlapping it

        const grandCell = ws.getRow(tr.rowNum).getCell(tc.colNum);
        const grandValue = cellNumericValue(grandCell);
        if (grandValue === null) continue; // no plausible grand-total value at the intersection — not a real cross-cast candidate

        // Sum across the Total row, from just after its own label to
        // just before the grand-total cell — these are the individual
        // column totals.
        let sumAcrossRow = 0, countAcrossRow = 0;
        const rowObj = ws.getRow(tr.rowNum);
        for (let c = tr.labelCol + 1; c < tc.colNum; c++) {
          const v = cellNumericValue(rowObj.getCell(c));
          if (v !== null) { sumAcrossRow += v; countAcrossRow++; }
        }

        // Sum down the Total column, from just after its own header to
        // just before the grand-total row — these are the individual
        // row totals.
        let sumDownCol = 0, countDownCol = 0;
        for (let r = tc.headerRow + 1; r < tr.rowNum; r++) {
          const v = cellNumericValue(ws.getRow(r).getCell(tc.colNum));
          if (v !== null) { sumDownCol += v; countDownCol++; }
        }

        // Need genuine, non-trivial data on both sides to be a
        // meaningful cross-cast candidate at all.
        if (countAcrossRow < 2 || countDownCol < 2) continue;

        const diff = Math.abs(sumAcrossRow - sumDownCol);
        if (diff > ROUNDING_TOLERANCE) {
          findings.push({
            sheet: ws.name,
            cell: grandCell.address,
            rowLabelCell: `${ws.name}!${numToCol(tr.labelCol)}${tr.rowNum}`,
            colHeaderCell: `${ws.name}!${numToCol(tc.colNum)}${tc.headerRow}`,
            sumAcrossRow, sumDownCol, diff,
            note: `${ws.name}!${grandCell.address}, at the intersection of the "${tr.labelText.trim()}" row and "${tc.headerText.trim()}" column, has two independently-computed grand totals that disagree: summing across the totals row gives ${sumAcrossRow.toLocaleString()}, but summing down the totals column gives ${sumDownCol.toLocaleString()} — a difference of ${diff.toLocaleString()}. Per this pattern's own rationale: two paths to the same grand total that don't agree usually means one aggregation range is missing a line item or column.`,
          });
        }
      }
    }
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a grid whose "Total" row and "Total" column arrive at different grand totals when summed independently — a classic cross-casting check. Deliberately conservative: only fires when both a Total row label and a Total column header are confidently identified within a bounded, plausible distance of each other, with at least 2 real data points on each side, comparing cached values with a rounding tolerance.',
  };
}

module.exports = { checkCrossCasting };
