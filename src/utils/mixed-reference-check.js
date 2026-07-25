// mixed-reference-check.js — sourced from the Operis Analysis Kit
// manual's "Cell reference profligacy" section (4.8), found in a
// book-mining pass. Operis's own example: "References that mix
// absolute and relative elements, for example =SUM($A1:C1), evaluate
// to ranges of different size as they are copied." And the explicit
// risk: "A cell that is a copy of its neighbour has a reasonable
// chance of being correct if its neighbour is known to be correct. But
// this is not so true for cells using mixed references, as their
// meaning changes as they are copied."
//
// Detects a range reference (X:Y) where the two endpoints disagree on
// whether their COLUMN is dollar-anchored, or disagree on whether
// their ROW is dollar-anchored — either mismatch means the range's
// effective width or height changes depending on where the formula is
// copied to, unlike a fully-relative or fully-absolute range which
// behaves consistently.

const RANGE_RE = /(\$?)([A-Z]{1,3})(\$?)(\d+)\s*:\s*(\$?)([A-Z]{1,3})(\$?)(\d+)/g;

function stripStringLiterals(formula) {
  return formula.replace(/"[^"]*"/g, m => ' '.repeat(m.length));
}

function checkMixedReferences(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        const cleanFormula = stripStringLiterals(formula);

        RANGE_RE.lastIndex = 0;
        let m;
        while ((m = RANGE_RE.exec(cleanFormula)) !== null) {
          const [full, colDollar1, col1, rowDollar1, row1, colDollar2, col2, rowDollar2, row2] = m;
          const colMismatch = !!colDollar1 !== !!colDollar2;
          const rowMismatch = !!rowDollar1 !== !!rowDollar2;
          if (!colMismatch && !rowMismatch) continue;

          const dimension = colMismatch && rowMismatch ? 'both column and row'
            : colMismatch ? 'column' : 'row';
          const direction = colMismatch && rowMismatch ? 'copied in either direction'
            : colMismatch ? 'copied horizontally' : 'copied vertically';

          findings.push({
            sheet: ws.name,
            cell: cell.address,
            formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
            rangeText: full,
            note: `${ws.name}!${cell.address} ("${formula.length > 100 ? formula.slice(0, 100) + '…' : formula}") contains a range reference (${full}) that mixes absolute and relative addressing between its two endpoints in the ${dimension} dimension. Per Operis's own guidance, this means the range's effective size changes when ${direction}. This is often a deliberate pattern — a running or cumulative total, where one boundary is anchored to a fixed starting point (e.g. $H78) while the other grows as the formula is copied across periods — rather than a mistake. Even so, Operis's own view is that a mixed reference "merits careful examination" precisely because, unlike an ordinary copied formula, its correctness can't be inferred just from its neighbour being correct. Confirm this range is growing (or shrinking) as intended.`,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a range reference (X:Y) where the two endpoints disagree on whether their column or row is dollar-anchored (e.g. =SUM($A1:C1)) — the range\'s effective width or height changes depending on where the formula is copied to. Real-file testing found this is very often a deliberate pattern (a running/cumulative total with one boundary anchored to a fixed starting point), not a mistake — but per Operis\'s own guidance, even a deliberate mixed reference "merits careful examination" since its correctness can\'t be inferred from a neighbouring cell being correct the way an ordinary copied formula\'s can.',
  };
}

module.exports = { checkMixedReferences };
