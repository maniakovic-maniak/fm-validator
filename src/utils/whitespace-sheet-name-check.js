// whitespace-sheet-name-check.js — sourced from Patrick O'Beirne's
// "Excel 2013 Spreadsheet Inquire" review (EuSpRIG 2013 Conference),
// found in a book-mining pass, listing sheet names with leading/
// trailing blanks among Inquire's own warning categories.
//
// Directly relevant given this session's own real bug: sheet-resolver.js
// needed a fix earlier this session because two different blank/
// whitespace-only sheet NAMES (not visible sheet content, the actual
// tab names) could incorrectly resolve as equal to each other. A
// leading/trailing space in a sheet name is invisible in the tab itself
// but can cause exactly this kind of subtle reference-matching failure
// — a formula referencing 'Sheet1' (no space) won't match a tab
// actually named 'Sheet1 ' (trailing space) the way a human would
// expect it to, and vice versa.

function checkWhitespaceSheetNames(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    const name = ws.name;
    if (typeof name !== 'string') return;
    const trimmed = name.trim();
    if (trimmed === name) return; // no leading/trailing whitespace at all
    if (trimmed === '') return; // an entirely blank/whitespace-only name is a different, already-covered concern (sheet-resolver.js's own __BLANK__ handling)

    const leading = name.length - name.trimStart().length;
    const trailing = name.length - name.trimEnd().length;

    findings.push({
      sheet: name,
      cell: 'A1',
      leadingSpaces: leading,
      trailingSpaces: trailing,
      note: `The sheet named "${name}" has ${leading > 0 ? `${leading} leading` : ''}${leading > 0 && trailing > 0 ? ' and ' : ''}${trailing > 0 ? `${trailing} trailing` : ''} space character(s) that are invisible on the tab itself. A formula or named range referencing "${trimmed}" (without the space) won't resolve to this sheet the way it visually appears it should, and vice versa — this is exactly the kind of subtle reference-matching failure that's easy to miss on a visual review.`,
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a sheet (tab) name with leading or trailing whitespace — invisible on the tab itself, but a real source of formula/named-range reference mismatches that a visual review would never catch.',
  };
}

module.exports = { checkWhitespaceSheetNames };
