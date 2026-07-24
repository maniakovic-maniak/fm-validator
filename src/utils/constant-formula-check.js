// constant-formula-check.js — sourced from the Operis Analysis Kit
// manual's "Search | Constant formula cells" command (2.30), found in
// a book-mining pass. Operis's own description: "A constant formula
// does not reference any other cells; instead, for example, it reads
// '=10+40'." And the rationale: "The risk with constant formula cells
// is that what are really inputs are listed as formulas, and so may
// escape checking" — both Excel's own Goto Special and this project's
// own input-detection checks find genuine input CELLS (a plain number
// typed into a cell), but a numeric derivation buried inside a formula
// with no cell references at all looks like a calculation, not an
// input, and slips past both.
//
// Deliberately requires at least one numeric literal in the formula —
// a bare =TODAY() or =RAND() has zero cell references too, but there's
// no buried numeric assumption to surface; the concern this check
// exists for is specifically a hidden number standing in for what
// should be a visible input cell.

// Matches a cell-reference-shaped token, with or without a sheet
// qualifier — used only to confirm ABSENCE across the whole formula,
// not to extract anything.
const ANY_CELL_REF_RE = /(?:(?:'[^']+'|[A-Za-z_][\w ]*)!)?\$?[A-Z]{1,3}\$?\d+/g;
// FIX: found via real-file testing — a whole-row or whole-column
// reference (e.g. 5:5, A:A, $5:$5) has no column-letter+row-digit
// shape at all, so the regex above never matched it, causing a real
// formula like SUMIF(5:5,TRUE,38:38) to be incorrectly treated as
// having zero cell references. Matches a bare row number or column
// letter(s) immediately adjacent to a colon (the range-separator
// syntax whole-row/column references use), independent of the
// column+row shape above.
const WHOLE_ROW_OR_COL_RE = /(?:(?:'[^']+'|[A-Za-z_][\w ]*)!)?\$?(?:[A-Z]{1,3}|\d+)\s*:\s*\$?(?:[A-Z]{1,3}|\d+)/g;
const NUMERIC_LITERAL_RE = /\b\d+(?:\.\d+)?\b/g;
// FIX: found via real-file testing — a bare literal formula like "=0"
// (no operator, no function call, nothing else) was being flagged,
// even though it isn't combining or deriving anything the way
// Operis's own example (=10+40) does; it's functionally identical to a
// plain input cell already, not hiding a calculation. Requires at
// least one operator or a function call (a letter immediately followed
// by an opening parenthesis) to be present for this check to apply.
const HAS_OPERATION_RE = /[+\-*/^&]|[A-Za-z_][\w.]*\s*\(/;

function stripStringLiterals(formula) {
  return formula.replace(/"[^"]*"/g, m => ' '.repeat(m.length));
}

function hasAnyCellReference(formula) {
  ANY_CELL_REF_RE.lastIndex = 0;
  WHOLE_ROW_OR_COL_RE.lastIndex = 0;
  return ANY_CELL_REF_RE.test(formula) || WHOLE_ROW_OR_COL_RE.test(formula);
}

function hasNumericLiteral(formula) {
  NUMERIC_LITERAL_RE.lastIndex = 0;
  return NUMERIC_LITERAL_RE.test(formula);
}

function hasOperation(formula) {
  return HAS_OPERATION_RE.test(formula);
}

function checkConstantFormulaCells(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        const cleanFormula = stripStringLiterals(formula);

        if (hasAnyCellReference(cleanFormula)) return; // genuinely references something — not this check's concern
        if (!hasNumericLiteral(cleanFormula)) return;   // no buried number (e.g. bare =TODAY()) — nothing hidden to surface
        if (!hasOperation(cleanFormula)) return;         // a bare literal like =0 — not combining/deriving anything, functionally identical to a plain input cell already

        findings.push({
          sheet: ws.name,
          cell: cell.address,
          formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
          note: `${ws.name}!${cell.address} ("${formula}") is a "constant formula" — it references no other cells at all, computing its result purely from literal numbers. Per Operis's own guidance: what is really an input is listed as a formula here, and so may escape the checking that a genuine input cell would get (a documentation cross-check, Excel's own Goto Special constants list, etc.). Confirm whether the numbers in this formula should instead be split out onto the face of the worksheet as an explicit input.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a "constant formula" — one with zero cell references (including whole-row/whole-column references like 5:5 or A:A), combining literal numbers via an operator or function call (e.g. =10+40) — that may be functioning as a hidden input rather than a genuine calculation. A bare literal with no operation at all (e.g. =0, a common placeholder) is not flagged, since it isn\'t deriving anything and is functionally identical to a plain input cell already; nor is a bare =TODAY() or =RAND() with no numeric literal, since there\'s nothing buried to surface.',
  };
}

module.exports = { checkConstantFormulaCells };
