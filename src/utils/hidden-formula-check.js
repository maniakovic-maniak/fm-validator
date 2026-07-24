// hidden-formula-check.js — sourced from Patrick O'Beirne's "Excel
// 2013 Spreadsheet Inquire" review (EuSpRIG 2013 Conference), found in
// a book-mining pass, listing "Formula Hidden" among the cell-level
// checks worth surfacing.
//
// Distinct from row/column/sheet hiding (already covered elsewhere in
// this project) — this is Excel's own per-cell "Hidden" protection
// attribute, which specifically hides a formula from the FORMULA BAR
// once sheet protection is enabled, while the cell's computed value
// remains fully visible. A reviewer can see the cell exists and see
// its result, but can never inspect the logic that produced it — a
// genuine transparency concern distinct from ordinary structural
// hiding, and one this project's other checks don't cover.
//
// Only meaningful when sheet protection is actually enabled — the
// "hidden" attribute is inert and has no visible effect otherwise, so
// this check requires both: sheet protection on AND a formula cell
// with protection.hidden set.

function checkHiddenFormulas(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    const sheetProtected = !!(ws.sheetProtection && ws.sheetProtection.sheet);
    if (!sheetProtected) return; // the hidden attribute has no effect unless protection is actually on

    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (!cell.formula) return;
        if (!(cell.protection && cell.protection.hidden)) return;

        findings.push({
          sheet: ws.name,
          cell: cell.address,
          note: `${ws.name}!${cell.address} contains a formula whose logic is hidden from the formula bar under this sheet's active protection. Its computed value remains visible, but no reviewer — including one with full access to this file — can inspect the calculation that produced it. Confirm whether hiding this specific formula is genuinely intentional (e.g. a licensed IP concern) rather than a leftover protection setting.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a formula cell whose logic is hidden from the formula bar under active sheet protection (Excel\'s per-cell "Hidden" protection attribute) — the computed value stays visible, but the calculation itself can never be inspected by any reviewer. Only checked when sheet protection is actually enabled, since the attribute has no effect otherwise.',
  };
}

module.exports = { checkHiddenFormulas };
