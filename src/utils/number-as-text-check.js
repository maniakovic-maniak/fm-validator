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

// FIX (found via real testing on a property/development model): a bare
// 4-digit value with NO formatting at all (no $, %, comma, decimal,
// sign) in a plausible calendar-year range is very likely an
// intentional year label stored as text — this project's own `xlsx`
// skill explicitly documents this as correct, recommended practice
// ("years as text ('2024', never 2,024)"), specifically to avoid Excel
// rendering a year with a thousands separator. Confirmed directly:
// "2030" flagged on a real file was exactly this case, not a defect.
// Deliberately narrow — only a BARE year with nothing else is excluded;
// "$2,030" or "2030.00" or "2030%" are not plausible year labels and
// are still flagged.
const BARE_YEAR_RE = /^\s*(\d{4})\s*$/;
const PLAUSIBLE_YEAR_MIN = 1990;
const PLAUSIBLE_YEAR_MAX = 2100;

function isBarePlausibleYear(text) {
  const m = BARE_YEAR_RE.exec(text);
  if (!m) return false;
  const year = parseInt(m[1], 10);
  return year >= PLAUSIBLE_YEAR_MIN && year <= PLAUSIBLE_YEAR_MAX;
}

function looksLikeNumber(text) {
  if (isBarePlausibleYear(text)) return false; // an intentional year label, not a broken number
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
    note: 'Flags plain (non-formula) cells whose value is a string that reads as a number (e.g. "1,234.56", "(500)", "42%") rather than a real numeric value — a common result of pasting from a PDF or web page. These are silently excluded from SUM() and most arithmetic without producing a visible error. A bare 4-digit value in a plausible calendar-year range (1990-2100) with no other formatting is excluded — this project\'s own conventions treat a year stored as text as correct, deliberate practice, not a defect.',
  };
}

module.exports = { checkNumbersStoredAsText };
