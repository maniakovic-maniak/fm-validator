// overflow-error-check.js — sourced from Patrick O'Beirne's "Excel
// 2013 Spreadsheet Inquire" review (EuSpRIG 2013 Conference), found in
// a book-mining pass: "An overflow error, such as a negative or
// excessive date value, is not reported in this sheet but in 'All
// Formulas' as a real date (eg 14/04/1791 01:17:02) rather than the
// ##### error value." Named explicitly by the review as a gap in
// Excel's own Inquire add-in.
//
// Excel stores dates as serial numbers (1 = 1 January 1900). Date
// arithmetic gone wrong — subtracting two dates in the wrong order, a
// sign error, a stray multiplication — can produce a serial number far
// outside any plausible range, which Excel then happily renders AS A
// DATE (since the cell is formatted that way) rather than as a visible
// error. The result looks like ordinary, if unusual, content — "14
// April 1791" reads as a typo or a data artefact, not as the numeric
// overflow it actually is.
//
// Deliberately conservative on the plausible-range bound: financial
// models in this project's own experience span from historical data
// (rarely before 1990) to long-horizon infrastructure/project-finance
// projections (confirmed real cases running to 2100+). A wide,
// generous window (1980-2200) is used specifically to avoid false
// positives on genuinely long-dated models, while still catching a
// serial-number overflow, which typically lands wildly outside any
// remotely plausible window (a negative serial number renders as a
// date in the 1800s or earlier; a large positive overflow can land
// centuries in the future).

const PLAUSIBLE_MIN_YEAR = 1980;
const PLAUSIBLE_MAX_YEAR = 2200;

// A number format is a real date format only if, once quoted text, escaped
// characters, bracketed sections ([Red], [=1], [$-409]) and literals are
// removed, it still contains a date/time code (d m y h s). A custom format
// that displays words for codes, e.g. [=1]"Company proposal";[=2]"Ofgem DD",
// contains the letters d/m/y inside the quoted text only; a naive date test
// treats the cell as a date and reports the small integer code (1, 2) as a
// 1900 date. Found via an independent review of a licence model (109 flagged
// cells that displayed scenario names).
function isRealDateFormat(numFmt) {
  if (!numFmt || typeof numFmt !== 'string') return true;   // unknown: keep the old behaviour
  const stripped = numFmt
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/_./g, '')
    .replace(/\*./g, '');
  return /[dmyhs]/i.test(stripped);
}

function checkOverflowError(workbook) {
  const findings = [];
  let textResultUnderDateFormat = 0;

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        const v = cell.value;
        const result = v && typeof v === 'object' && 'result' in v ? v.result : null;
        if (!(result instanceof Date)) return;
        let _fmt = null;
        try { _fmt = cell.numFmt || (cell.style && cell.style.numFmt) || null; } catch (_) { _fmt = null; }
        if (!isRealDateFormat(_fmt)) return;

        const shortFormula = formula.length > 100 ? formula.slice(0, 100) + '…' : formula;
        const truncatedFormula = formula.length > 150 ? formula.slice(0, 150) + '…' : formula;

        // An Invalid Date result means the cached value was not a number at all: the cell has a date number format
        // but holds TEXT (a scenario or period name), and the parser turned that text into an invalid Date. It is not a
        // date overflow. Found by running the licence-model twin of an independent review's file: all 359 'Invalid
        // Date' hits were scenario-name cells such as 'Company proposal' under a "dd mmm yyyy" format. (An earlier
        // version of this check reported them as 'actually invalid date values'.)
        if (isNaN(result.getTime())) {
          textResultUnderDateFormat++;
          return;
        }

        const year = result.getUTCFullYear();
        if (year >= PLAUSIBLE_MIN_YEAR && year <= PLAUSIBLE_MAX_YEAR) return;

        findings.push({
          sheet: ws.name,
          cell: cell.address,
          formula: truncatedFormula,
          resultDate: result.toISOString(),
          note: `${ws.name}!${cell.address} ("${shortFormula}") evaluates to ${result.toISOString().slice(0, 10)} — a date far outside any plausible range for this kind of model. Per EuSpRIG's own review of Excel's Inquire add-in, this pattern ("an overflow error, such as a negative or excessive date value") is not reported by Excel's own error-checking. Two real causes were confirmed via testing: (1) date arithmetic gone wrong (dates subtracted in the wrong order, a sign error), which genuinely overflows the underlying serial number; or (2) a stale or incorrect date-style number format applied to a cell whose actual value is something else entirely (e.g. a dashboard cell pulling a dollar figure through a bare reference, but still carrying a leftover date format from earlier in the sheet) — the cell shows an absurd date on screen even though nothing about the calculation itself is wrong. Either way, this is worth a quick look: confirm whether the formula/value is correct, or whether the cell's number format simply needs correcting.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    textResultUnderDateFormat,
    findings,
    note: `Flags a formula cell whose cached result is a date falling outside ${PLAUSIBLE_MIN_YEAR}-${PLAUSIBLE_MAX_YEAR}, (a text result under a date format is not a date and is not flagged). Confirmed via real-file testing to have two distinct real causes: genuine date-arithmetic overflow (dates subtracted in the wrong order, a sign error), or a stale/incorrect date-style number format applied to a cell whose actual value is something else entirely (e.g. a dashboard cell pulling a dollar figure through a bare reference, still carrying a leftover date format). Both produce the same visible symptom on screen — a nonsensical date with no visible error — so both are flagged; the bound is deliberately wide to avoid false positives on genuinely long-dated infrastructure/project-finance models.`,
  };
}

module.exports = { checkOverflowError, isRealDateFormat };
