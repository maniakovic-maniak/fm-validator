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

// FIX (I-7): found via an independent review confirming several
// hardcoded QA-status cells were not caught — DATA MAP!C475/C490/
// C496/C497 are literal strings like "OK — 0 formula/name links" and
// "OK — calculation complete" in rows labelled "External workbook
// formula links" and "Workbook formula error scan". Broadened to
// cover this genuine gap, prevalence-tested against all reference
// files since both changes widen matching.
const CHECK_LABEL_RE = /\b(check|reconciliation|recon|validation|balance[\s-]?check|error[\s-]?check|model[\s-]?control|tie[\s-]?out|cross[\s-]?foot|formula\s+(?:error|links)|circular[\s-]?reference)\b/i;

// Text values that look like an actual check RESULT (pass/fail vocabulary),
// as opposed to a hardcoded threshold or input that merely happens to sit
// in a row whose label contains the word "check". A numeric 0 is included
// since "difference = 0" is the most common numeric check-passed pattern.
// Matches either a bare status word ("OK", "PASS") or that word
// followed by a dash/colon separator and explanatory detail (e.g.
// "OK — 0 formula/name links", "PASS: all references resolve") —
// deliberately requires the separator, not just any word boundary,
// so a casual sentence that happens to start with "No" or "Yes"
// without being a genuine status value is not falsely matched.
const CHECK_RESULT_VALUE_RE = /^(ok|pass(ed)?|fail(ed)?|error|true|false|balanced|yes|no|tie[sd]?|clean|reconciled)(\s*[-\u2013\u2014:]|$)/i;

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
      // Find the leftmost non-empty cell in the row as the candidate
      // label. FIX (I-7): a row can have a short ID code before the
      // genuine descriptive label (confirmed directly: this model uses
      // "CHK-050" in column A, with the real label "Defined names
      // contain no broken references" in column B) — checks up to the
      // first 3 non-empty string cells for one matching CHECK_LABEL_RE,
      // rather than assuming the very first non-empty cell is always
      // the genuine label.
      let labelCell = null;
      let labelColNumber = null;
      let candidatesChecked = 0;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (labelCell !== null || candidatesChecked >= 3) return;
        if (!cellHasContent(cell) || typeof cell.value !== 'string') return;
        candidatesChecked++;
        if (cell.value.length <= MAX_LABEL_LENGTH && CHECK_LABEL_RE.test(cell.value)) {
          labelCell = cell;
          labelColNumber = colNumber;
        }
      });
      if (!labelCell) return;

      // Scan the rest of the row (to the right of the label) for the
      // FIRST non-empty candidate "result" cell. FIX (I-7): found via
      // investigating over-matching on multi-column metadata/control-
      // register rows (Formula/Inputs/Source/Method/Weight-style
      // columns) — this loop's own comment always said "the first"
      // result cell, but the implementation never stopped after
      // finding one, pushing a separate finding for every qualifying
      // cell in the row instead of just the genuine result position.
      let resultCell = null, resultColNumber = null;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (resultCell !== null) return;
        if (colNumber <= labelColNumber) return;
        if (isMergeSlave(cell)) return;
        if (!cellHasContent(cell)) return;
        if (hasFormula(cell)) return; // real, recalculating check — fine
        resultCell = cell;
        resultColNumber = colNumber;
      });
      if (resultCell) {
        // Reached a non-empty, non-formula cell after a check-labeled
        // row — this is a false-assurance candidate. Confidence is high
        // when the value itself looks like check-result vocabulary
        // (pass/fail/ok/0), lower when it's some other hardcoded value
        // that could genuinely be a mislabeled input rather than a
        // static check result.
        findings.push({
          sheet: worksheet.name,
          cell: resultCell.address || `${colLetter(resultColNumber)}${rowNumber}`,
          label: String(labelCell.value).trim(),
          value: resultCell.value,
          confidence: looksLikeCheckResult(resultCell.value) ? 'high' : 'low',
        });
      }
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
