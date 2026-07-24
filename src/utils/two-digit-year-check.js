// two-digit-year-check.js — sourced from Patrick O'Beirne's "Excel
// 2013 Spreadsheet Inquire" review (EuSpRIG 2013 Conference), found in
// a book-mining pass. The review's own table of Excel's built-in error-
// checking rules names "Cells containing years represented as 2
// digits" as one that is "Not reported" by ANY tool, including
// Microsoft's own Inquire add-in.
//
// Deliberately scoped to a precise, formula-based signal rather than
// guessing from raw values (a bare "99" could be anything — a
// percentage, a quantity, an ID — with no reliable way to tell it's a
// truncated year without genuine ambiguity). VALUE(RIGHT(x, 2)) is an
// unambiguous, narrow pattern: explicitly extracting the last two
// characters of something and converting them to a number. Found a
// real, concrete instance of exactly this on The Bend model during
// real-file testing: IFERROR(VALUE(RIGHT(C23,2))-VALUE(RIGHT(B23,2)),0)
// — extracting "30" from a "FY30"-style label and subtracting another
// such extraction. The real risk this check exists to flag: if the two
// extracted values ever span a century boundary (e.g. "99" from
// FY1999 vs "05" from FY2005), the arithmetic silently produces a
// wrong result (99-05=94, not the real 6-year difference) with no
// visible error — a classic Y2K-style century-wraparound bug.

const VALUE_RIGHT_2_RE = /VALUE\s*\(\s*RIGHT\s*\(\s*[^,)]+\s*,\s*2\s*\)\s*\)/gi;

// FIX: found via real-file testing — 197 of 199 raw matches on a real
// project file were the model EXPLICITLY restoring the century (e.g.
// 2000+VALUE(RIGHT(H$6,2)) or VALUE(RIGHT(H$6,2))+2000), which is
// exactly the safe, deliberate way to handle a 2-digit extraction and
// specifically avoids the century-wraparound risk this check exists to
// catch. Only 2 of 199 were the genuinely risky pattern (an unguarded
// subtraction/comparison between two raw extractions). Excludes any
// match immediately preceded or followed by an explicit century-adding
// literal (e.g. 1900+, 2000+, +1900, +2000).
const CENTURY_GUARD_RE = /(?:(?:19|20)\d{2}\s*\+\s*$)|(?:^\s*\+\s*(?:19|20)\d{2})/;

function isCenturyGuarded(formula, matchIndex, matchLength) {
  const before = formula.slice(Math.max(0, matchIndex - 10), matchIndex);
  const after = formula.slice(matchIndex + matchLength, matchIndex + matchLength + 10);
  return CENTURY_GUARD_RE.test(before) || CENTURY_GUARD_RE.test(after);
}

function checkTwoDigitYearExtraction(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        VALUE_RIGHT_2_RE.lastIndex = 0;
        const matches = [];
        let m;
        while ((m = VALUE_RIGHT_2_RE.exec(formula)) !== null) {
          if (isCenturyGuarded(formula, m.index, m[0].length)) continue;
          matches.push(m[0]);
        }
        if (matches.length === 0) return;

        findings.push({
          sheet: ws.name,
          cell: cell.address,
          formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
          extractionCount: matches.length,
          note: `${ws.name}!${cell.address} ("${formula.length > 100 ? formula.slice(0, 100) + '…' : formula}") extracts the last 2 characters of a value and converts it to a number — a common way to pull a 2-digit year out of a label like "FY30" — without an explicit century-restoring addition (e.g. 2000+) nearby. This is a pattern Excel's own error-checking rules don't catch, per EuSpRIG's own review of Microsoft's Inquire add-in. The real risk: if the two-digit values this feeds into ever span a century boundary (e.g. comparing "99" against "05"), any arithmetic on them silently produces a wrong result with no visible error. Confirm whether this model's date range could ever cross a century boundary, and if so, whether a full 4-digit year should be used instead.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags formulas using VALUE(RIGHT(x, 2)) — extracting the last 2 characters of a value and converting to a number, a common way to derive a 2-digit year from a label — specifically excluding cases where the century is explicitly restored nearby (e.g. 2000+VALUE(RIGHT(x,2))), which is the safe, deliberate way to handle this and was confirmed via real-file testing to be the overwhelming majority (197 of 199) of raw matches on one real model. Deliberately scoped to this precise formula pattern rather than guessing from raw values. The real risk is a silent, century-wraparound arithmetic error if two UNGUARDED extracted values ever span a century boundary.',
  };
}

module.exports = { checkTwoDigitYearExtraction };
