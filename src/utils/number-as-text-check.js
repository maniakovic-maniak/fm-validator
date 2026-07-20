// number-as-text-check.js — sourced from ICAEW's "How to Review a
// Spreadsheet" (D6): a numeric-looking value stored as TEXT rather than
// a real number silently drops out of SUM/arithmetic formulas that
// reference it — a well-known, common Excel gotcha.
//
// Only checks NON-FORMULA cells (plain input values) — a formula
// producing a text-that-looks-like-a-number result is a different,
// separate concern (and typically deliberate, e.g. a formatted display
// string), not this check's target. This is specifically about a raw
// input that SHOULD have been typed/pasted as a number but landed as
// text instead — commonly from a paste-from-PDF or paste-from-web
// operation.

// Matches a string that, once trimmed, is unambiguously a number in
// common financial formatting: optional leading/trailing whitespace,
// optional $ prefix, optional thousands commas, optional decimal,
// optional trailing %, and either a leading minus or full parentheses
// for a negative value (not both — genuine numbers don't mix the two).
const NUMBER_LIKE_TEXT_RE = /^\s*(-?\$?[\d,]+\.?\d*%?|\(\$?[\d,]+\.?\d*%?\))\s*$/;

function looksLikeNumber(text) {
  if (!NUMBER_LIKE_TEXT_RE.test(text)) return false;
  // Must contain at least one digit — guards against a bare "-" or "()"
  // matching the pattern with no actual number in it.
  return /\d/.test(text);
}

function checkNumbersStoredAsText(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.formula) return; // only plain input cells are this check's concern
        const v = cell.value;
        if (typeof v !== 'string') return;
        if (!looksLikeNumber(v)) return;
        findings.push({
          sheet: ws.name,
          cell: cell.address,
          textValue: v,
          note: `${ws.name}!${cell.address} contains "${v}" stored as text rather than a number. Any SUM(), arithmetic, or comparison formula referencing this cell will silently treat it as zero or exclude it entirely, rather than raising a visible error.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags plain (non-formula) cells whose value is a string that reads as a number (e.g. "1,234.56", "(500)", "42%") rather than a real numeric value — a common result of pasting from a PDF or web page. These are silently excluded from SUM() and most arithmetic without producing a visible error.',
  };
}

module.exports = { checkNumbersStoredAsText };
