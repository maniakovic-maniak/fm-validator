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

function checkOverflowError(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        const v = cell.value;
        const result = v && typeof v === 'object' && 'result' in v ? v.result : null;
        if (!(result instanceof Date)) return;

        const shortFormula = formula.length > 100 ? formula.slice(0, 100) + '…' : formula;
        const truncatedFormula = formula.length > 150 ? formula.slice(0, 150) + '…' : formula;

        // FIX: found via a real crash during real-file testing — the
        // cached result can be a Date object that is itself invalid
        // (e.g. constructed from NaN), and .toISOString() throws on
        // that rather than returning anything. An invalid date result
        // is itself a genuinely meaningful finding — arguably a more
        // serious one than an implausible-but-valid date — so it's
        // handled explicitly here, not just guarded against crashing.
        if (isNaN(result.getTime())) {
          findings.push({
            sheet: ws.name,
            cell: cell.address,
            formula: truncatedFormula,
            resultDate: 'Invalid Date',
            note: `${ws.name}!${cell.address} ("${shortFormula}") evaluates to an actually invalid date value (not just an implausible one) — the underlying serial number is not a valid date at all. This is a stronger signal than a merely implausible date: the date arithmetic here has produced something Excel and this cell's formatting cannot represent as a real date at all, though it may still display without a visible #VALUE!/#NUM! error depending on context. Confirm the intended calculation.`,
          });
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
    findings,
    note: `Flags a formula cell whose cached result is a date falling outside ${PLAUSIBLE_MIN_YEAR}-${PLAUSIBLE_MAX_YEAR}, or is an actually invalid date value. Confirmed via real-file testing to have two distinct real causes: genuine date-arithmetic overflow (dates subtracted in the wrong order, a sign error), or a stale/incorrect date-style number format applied to a cell whose actual value is something else entirely (e.g. a dashboard cell pulling a dollar figure through a bare reference, still carrying a leftover date format). Both produce the same visible symptom on screen — a nonsensical date with no visible error — so both are flagged; the bound is deliberately wide to avoid false positives on genuinely long-dated infrastructure/project-finance models.`,
  };
}

module.exports = { checkOverflowError };
