// blank-cell-boundary-check.js — sourced from PwC Global Financial
// Modeling Guidelines (D1): avoid references to blank cells — the
// specific example given is an opening balance for the first period
// (t=-1), which should be explicitly zeroed rather than left to
// reference a genuinely blank cell. Excel treats a blank reference as 0
// in arithmetic, so this doesn't produce a visible error — but it's a
// fragile pattern: if a stray value later lands in that "blank" cell
// (a paste, a typo, an inserted column), the opening balance silently
// picks it up with no warning.

const OPENING_BALANCE_TERMS = ['opening balance', 'opening cash balance', 'beginning balance'];

const BARE_LINK_RE = /^(?:(?:'([^']+)'|([A-Za-z0-9_]+))!)?\$?([A-Z]{1,3})\$?(\d+)$/;
function parseBareLink(formula, currentSheet) {
  if (!formula) return null;
  const m = BARE_LINK_RE.exec(formula.trim());
  if (!m) return null;
  const [, quotedSheet, bareSheet, col, row] = m;
  const sheet = (quotedSheet || bareSheet || currentSheet).trim();
  return { sheet, col: col.toUpperCase(), row: parseInt(row, 10) };
}

function checkBlankCellBoundary(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const text = typeof cell.value === 'string' ? cell.value.toLowerCase() : '';
        if (!text || !OPENING_BALANCE_TERMS.some(t => text.includes(t))) return;

        // The first formula cell to the right of this label is the
        // first-period opening balance — the one PwC's example concerns.
        for (let c = colNum + 1; c <= colNum + 8; c++) {
          const valCell = row.getCell(c);
          if (!valCell.formula) {
            if (typeof valCell.value === 'number') break; // a plain input value here — not this check's concern, and not blank either
            continue;
          }
          const link = parseBareLink(valCell.formula, ws.name);
          if (!link) break; // a real calculation, not a bare reference — not this check's pattern

          const targetSheet = workbook.getWorksheet(link.sheet);
          if (!targetSheet) break;
          const targetCell = targetSheet.getCell(`${link.col}${link.row}`);
          const isBlank = targetCell.value === null || targetCell.value === undefined;
          if (isBlank) {
            findings.push({
              sheet: ws.name,
              cell: valCell.address,
              labelText: cell.value,
              referencedCell: `${link.sheet}!${link.col}${link.row}`,
              note: `${ws.name}!${valCell.address} ("${cell.value}") references ${link.sheet}!${link.col}${link.row}, which is genuinely blank rather than an explicit zero. Excel evaluates this as 0 today, but the reference is fragile — any stray value later placed in that cell would silently flow into this opening balance with no warning.`,
            });
          }
          break; // only the first formula cell in the row matters for this check
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a first-period opening-balance formula that references a genuinely blank cell rather than an explicit zero — evaluates correctly today, but is fragile against a future stray value landing in that cell. Only a bare single-cell-reference formula is checked; anything else is left alone.',
  };
}

module.exports = { checkBlankCellBoundary };
