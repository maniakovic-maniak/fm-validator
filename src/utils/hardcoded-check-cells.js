// hardcoded-check-cells.js — G1: detect check/reconciliation cells that
// are hardcoded rather than formula-driven — a false-assurance risk
// distinct from generic hardcode counting.
//
// The distinguishing signal is deliberately NOT what value the cell shows
// — a real check like =IF(A1=B1,"OK","ERROR") displaying "OK" is fine,
// it recalculates. The problem is specifically a check-labeled cell with
// no formula at all: it will show the same result forever regardless of
// what the underlying numbers actually do. A simple link like =A1 still
// counts as "has a formula" here (it does update), so it is correctly
// NOT flagged — only a genuinely static, typed-in value in a check
// position is a false-assurance risk.
//
// Raised from the audit-gap review: identified as a distinct pattern
// from generic hardcode detection (workbookStats.totalHardcodes), which
// counts embedded numeric literals inside calculation formulas — this
// check is about the ABSENCE of a formula entirely in a cell whose whole
// job is to verify something.

const CHECK_LABEL_RE = /\b(check|reconciliation|recon|validation|balance[\s-]?check|error[\s-]?check|model[\s-]?control|tie[\s-]?out|cross[\s-]?foot)\b/i;

// Text values that look like an actual check RESULT (pass/fail vocabulary),
// as opposed to a hardcoded threshold or input that merely happens to sit
// in a row whose label contains the word "check". A numeric 0 is included
// since "difference = 0" is the most common numeric check-passed pattern.
const CHECK_RESULT_VALUE_RE = /^(ok|pass(ed)?|fail(ed)?|error|true|false|balanced|yes|no|tie[sd]?|clean|reconciled)$/i;

function looksLikeCheckResult(value) {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return value === 0;
  if (typeof value === 'string') return CHECK_RESULT_VALUE_RE.test(value.trim());
  return false;
}

// Cells inside a merge report content on every cell within the merged
// range in this ExcelJS version, not just the anchor — without this
// check, a single merged label would be counted as N separate findings,
// one per cell in the range. Only the master (anchor) cell is genuine
// content; everything else is a duplicate view of the same cell.
function isMergeSlave(cell) {
  return cell.isMerged && cell.master && cell.master.address !== cell.address;
}

// A genuine row-label check ("Balance Sheet Check", "Debt Schedule
// Reconciliation") is short. Long descriptive prose that happens to
// mention "check" or "validation" in passing — a README paragraph, an
// instructional note — is not a check-row label and must not match,
// even though the keyword regex alone would catch it.
const MAX_LABEL_LENGTH = 60;

function hasFormula(cell) {
  return cell.formula !== undefined && cell.formula !== null && cell.formula !== '';
}

function cellHasContent(cell) {
  return cell.value !== null && cell.value !== undefined && cell.value !== '';
}

function checkHardcodedCheckCells(workbook) {
  const findings = [];

  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      // Find the leftmost non-empty cell in the row as the candidate label.
      let labelCell = null;
      let labelColNumber = null;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (labelCell === null && cellHasContent(cell) && typeof cell.value === 'string') {
          labelCell = cell;
          labelColNumber = colNumber;
        }
      });
      if (!labelCell || labelCell.value.length > MAX_LABEL_LENGTH || !CHECK_LABEL_RE.test(labelCell.value)) return;

      // Scan the rest of the row (to the right of the label) for the
      // first non-empty candidate "result" cell.
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber <= labelColNumber) return;
        if (isMergeSlave(cell)) return;
        if (!cellHasContent(cell)) return;
        if (hasFormula(cell)) return; // real, recalculating check — fine

        // Reached a non-empty, non-formula cell after a check-labeled
        // row — this is a false-assurance candidate. Confidence is high
        // when the value itself looks like check-result vocabulary
        // (pass/fail/ok/0), lower when it's some other hardcoded value
        // that could genuinely be a mislabeled input rather than a
        // static check result.
        findings.push({
          sheet: worksheet.name,
          cell: cell.address || `${colLetter(colNumber)}${rowNumber}`,
          label: String(labelCell.value).trim(),
          value: cell.value,
          confidence: looksLikeCheckResult(cell.value) ? 'high' : 'low',
        });
      });
    });
  });

  return { applicable: true, flaggedCount: findings.length, findings };
}

function colLetter(colNumber) {
  let letter = '';
  let n = colNumber;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

module.exports = { checkHardcodedCheckCells };
