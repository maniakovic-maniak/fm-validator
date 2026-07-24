// blank-cell-reference-check.js — sourced from three independent
// corroborating sources found in a book-mining pass: Clermont, Hanin &
// Mittermeir's field-audit paper "A Spreadsheet Auditing Tool Evaluated
// in an Industrial Context" (EuSpRIG, "reference to empty cell" was one
// of five named error categories found in real client spreadsheets,
// 78 error instances); Patrick O'Beirne's "Excel 2013 Spreadsheet
// Inquire" review (EuSpRIG 2013), which lists "Formulas referring to
// empty cells" as one of Excel's own built-in error-checking rules; and
// the Operis Analysis Kit manual's "Search | References to blank cell"
// command, whose own rationale is quoted directly in this check's note.
//
// This is deliberately a BROADER, general-purpose sibling to
// blank-cell-boundary-check.js, which only covers the narrow
// first-period opening-balance case. Scoped specifically to bare
// single-cell reference TERMS within a formula (e.g. the A1 in
// =A1+B1), never to a cell that's part of a multi-cell range argument
// (e.g. the D125 in =SUM(D5:D125)) — all three sources explicitly warn
// that intentionally padding a SUM range past current data is a common,
// legitimate pattern, and flagging it would be pure noise.

// Functions whose entire purpose is to test for or tolerate blankness —
// a formula containing any of these is explicitly blank-aware by
// design, not accidentally referencing a blank cell.
const BLANK_AWARE_RE = /\b(ISBLANK|COUNT|COUNTA|COUNTBLANK|N|T)\s*\(/i;
// A formula that explicitly compares a reference to "" is also already
// handling the blank case on purpose (e.g. IF(A1="","",A1*2)).
const EMPTY_STRING_COMPARISON_RE = /=\s*""|""\s*=/;

// Matches a bare single-cell reference term: an optional sheet
// qualifier (quoted or bare) followed by a column/row address, with no
// surrounding colon (which would make it part of a range instead).
const CELL_TOKEN_RE = /(?:(?:'([^']+)'|([A-Za-z_][\w ]*))!)?\$?([A-Z]{1,3})\$?(\d+)/g;

function stripStringLiterals(formula) {
  // Replace the contents of "..." string literals with spaces (same
  // length, so match indices for the colon-adjacency check below stay
  // valid) so a coincidental cell-reference-shaped substring inside a
  // literal string is never mistaken for a real reference.
  return formula.replace(/"[^"]*"/g, m => ' '.repeat(m.length));
}

// FIX: found via real-file testing — a real workbook's "Debt Dashboard"
// sheet referenced a P&L cell in column G, which turned out to be a
// structural spacer/label column (33% populated across the sheet,
// vs. 82% for the actual data column H right next to it) rather than
// an accidental gap in real data. A column that's mostly blank by
// design shouldn't have every reference into it flagged. Computed once
// per sheet (a Map from column number to density) rather than
// re-scanning the column for every individual finding.
const SPARSE_COLUMN_THRESHOLD = 0.5; // a column populated less than half the time is treated as structural, not a data column

function computeColumnDensity(sheet) {
  const dims = sheet.dimensions && sheet.dimensions.model;
  const density = new Map();
  if (!dims || !dims.bottom || !dims.right) return density; // an empty or dimensionless sheet — nothing to compute
  const populatedByCol = new Map();
  for (let r = dims.top || 1; r <= dims.bottom; r++) {
    const row = sheet.getRow(r);
    for (let c = dims.left || 1; c <= dims.right; c++) {
      const cell = row.getCell(c);
      if (cell.value !== null && cell.value !== undefined) {
        populatedByCol.set(c, (populatedByCol.get(c) || 0) + 1);
      }
    }
  }
  const totalRows = dims.bottom - (dims.top || 1) + 1;
  for (let c = dims.left || 1; c <= dims.right; c++) {
    density.set(c, (populatedByCol.get(c) || 0) / totalRows);
  }
  return density;
}

function colLettersToNum(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function checkBlankCellReferences(workbook) {
  const findings = [];
  const MAX_FINDINGS = 200; // this check can fire often on a large, sparse model — cap and note rather than flood the report
  const densityCache = new Map(); // sheet name -> Map(colNum -> density), built lazily per sheet

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (findings.length >= MAX_FINDINGS) return;
        const formula = cell.formula;
        if (!formula) return;
        if (BLANK_AWARE_RE.test(formula) || EMPTY_STRING_COMPARISON_RE.test(formula)) return; // formula is deliberately blank-aware — skip entirely

        const cleanFormula = stripStringLiterals(formula);
        let m;
        CELL_TOKEN_RE.lastIndex = 0;
        while ((m = CELL_TOKEN_RE.exec(cleanFormula))) {
          if (findings.length >= MAX_FINDINGS) break;
          const [full, quotedSheet, bareSheet, col, row2] = m;
          const before = cleanFormula[m.index - 1];
          const after = cleanFormula[m.index + full.length];
          if (before === ':' || after === ':') continue; // part of a range — the exact case every source warns against flagging

          const targetSheetName = (quotedSheet || bareSheet || ws.name).trim();
          const targetSheet = workbook.getWorksheet(targetSheetName);
          if (!targetSheet) continue; // external or unresolved sheet reference — not this check's concern

          const targetCell = targetSheet.getCell(`${col}${row2}`);
          const isBlank = targetCell.value === null || targetCell.value === undefined;
          if (!isBlank) continue;

          // Skip references into a structurally sparse column (a
          // label/spacer area by design), computed once per sheet.
          if (!densityCache.has(targetSheetName)) densityCache.set(targetSheetName, computeColumnDensity(targetSheet));
          const density = densityCache.get(targetSheetName);
          const colNum = colLettersToNum(col);
          if ((density.get(colNum) ?? 1) < SPARSE_COLUMN_THRESHOLD) continue;

          findings.push({
            sheet: ws.name,
            cell: cell.address,
            referencedCell: `${targetSheetName}!${col}${row2}`,
            formula,
            note: `${ws.name}!${cell.address} ("${formula}") contains a bare reference to ${targetSheetName}!${col}${row2}, which is genuinely blank. Excel evaluates a blank reference as 0 in arithmetic, so this doesn't produce a visible error today — but per Operis's own guidance: "Either the reference itself is not required and should be deleted, or the cell should contain another formula or some input data." A stray value later landing in that cell would silently flow into this calculation with no warning.`,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: `Flags formulas containing a bare single-cell reference to a genuinely blank cell — never a cell that's part of a multi-cell range argument (e.g. the D125 in SUM(D5:D125)), since intentionally padding a range past current data is common and legitimate. Formulas that are already explicitly blank-aware (ISBLANK, COUNT/COUNTA/COUNTBLANK, or a ="" comparison) are skipped entirely, since the blank case is being handled on purpose. References into a structurally sparse column (populated less than ${Math.round(SPARSE_COLUMN_THRESHOLD*100)}% of the time, e.g. a label/spacer column before real data starts) are also excluded, confirmed necessary via real-file testing.${findings.length >= MAX_FINDINGS ? ` Capped at ${MAX_FINDINGS} findings — this workbook has more than that many, so the true count is understated.` : ''}`,
  };
}

module.exports = { checkBlankCellReferences };
