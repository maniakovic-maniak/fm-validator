// autosum-header-check.js — L7 (fm-validator book-mining: "Excel for
// Auditors", Jelen & Dowell): AutoSum's auto-suggested range can silently
// include a numeric header row directly above the data (e.g. year labels
// 2004, 2005, 2006, 2007) when there's no blank row separating the header
// from the data block — the total looks plausible but is inflated by
// header values masquerading as data.
//
// Deliberately narrow in scope, matching total-range-check.js's own
// discipline: only simple, single-column, contiguous SUM() ranges. The
// signal is the TOP cell of the range being a plain (non-formula) integer
// in a plausible calendar-year range (1990-2100) — genuine financial data
// essentially never lands exactly in that narrow band, so this is a real,
// low-noise signal, not a coincidence detector. Documented honestly: this
// cannot achieve zero false positives (a line item whose value genuinely
// happens to fall in 1990-2100 would still be flagged), so it's framed as
// a verification prompt, not an assertion of error.

const SUM_RANGE_RE = /\bSUM\s*\(\s*([A-Z]+)(\d+)\s*:\s*([A-Z]+)(\d+)\s*\)/i;
const PLAUSIBLE_YEAR_MIN = 1990;
const PLAUSIBLE_YEAR_MAX = 2100;

function checkAutoSumHeaderInclusion(workbook) {
  const found = [];
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        const m = SUM_RANGE_RE.exec(formula);
        if (!m) return;

        const [, col1, row1Str, col2, row2Str] = m;
        if (col1.toUpperCase() !== col2.toUpperCase()) return;
        const rowStart = parseInt(row1Str, 10);
        const rowEnd = parseInt(row2Str, 10);
        if (rowEnd - rowStart < 1) return;

        const colLetter = col1.toUpperCase();
        const topCell = ws.getCell(`${colLetter}${rowStart}`);
        const topVal = topCell.value;

        // Must be a plain literal number, not a formula result object —
        // a formula-derived value at the top of the range is a normal
        // calculation, not a pasted-in header label.
        if (typeof topVal !== 'number') return;
        if (!Number.isInteger(topVal)) return;
        if (topVal < PLAUSIBLE_YEAR_MIN || topVal > PLAUSIBLE_YEAR_MAX) return;

        // Extra corroborating signal (reduces false positives without
        // requiring it): the SECOND cell in the range is also a
        // plausible, ascending year — i.e. a genuine multi-year header
        // run, not a single coincidental value.
        let corroborated = false;
        if (rowEnd - rowStart >= 2) {
          const secondCell = ws.getCell(`${colLetter}${rowStart + 1}`);
          const secondVal = secondCell.value;
          if (typeof secondVal === 'number' && Number.isInteger(secondVal) &&
              secondVal > topVal && secondVal - topVal <= 5 &&
              secondVal >= PLAUSIBLE_YEAR_MIN && secondVal <= PLAUSIBLE_YEAR_MAX) {
            corroborated = true;
          }
        }

        found.push({
          sheet: ws.name,
          cell: cell.address,
          formula: formula.length > 100 ? formula.slice(0, 100) + '…' : formula,
          headerCell: `${colLetter}${rowStart}`,
          headerValue: topVal,
          corroborated,
          note: `${ws.name}!${cell.address} sums ${colLetter}${rowStart}:${colLetter}${rowEnd}, and the top cell of that range (${colLetter}${rowStart}) is a plain numeric value of ${topVal} — a plausible calendar year. If this is a header label (e.g. a year heading) rather than genuine data, it is being silently included in the total.${corroborated ? ' The following cell is also an ascending plausible-year value, strengthening this signal.' : ''} Confirm ${colLetter}${rowStart} is real data, not a header row swept into the range.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: found.length,
    findings: found,
    note: 'Flags SUM() ranges whose top cell is a plain integer in a plausible calendar-year range (1990-2100) — a common symptom of AutoSum including a header row directly above a data block with no blank-row separator. This cannot achieve zero false positives (a genuine line-item value could coincidentally fall in this range) — framed as a verification prompt, not a confirmed error. Only single-column, contiguous SUM() ranges are evaluated.',
  };
}

module.exports = { checkAutoSumHeaderInclusion };
