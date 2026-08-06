// error-scan-coverage-check.js
//
// Found via an independent review (MR-005): the model's own "no Excel
// errors" control does not scan the full used range on several sheets.
// Confirmed directly against the real model: DATA MAP!C170's control
// ("No Excel errors in target workbook") is a SUMPRODUCT(--ISERROR(...))
// formula spanning 12 sheet!range references — but 8 of those 12 ranges
// are narrower than the sheet's actual used range (FUNDING & CAP
// TABLE is the most dramatic: covers only 38 rows of a 200-row used
// range), and 2 entire sheets (DATA MAP — the very sheet the control
// itself lives on — and MODEL GUIDE) are missing from the scan
// entirely. The control could report "OK" while genuine #REF!/#VALUE!
// errors sit undetected in any of these gaps.
//
// This is the same category of defect as I-6's release-gate-coverage
// check — a control formula whose own tested scope doesn't cover what
// it claims to — applied specifically to whole-workbook error-scan
// patterns (SUMPRODUCT/ISERROR combinations) rather than exception-
// count gates.

function colToNum(col) {
  let n = 0;
  for (let i = 0; i < col.length; i++) n = n * 26 + (col.charCodeAt(i) - 64);
  return n;
}

// Matches a sheet!$Col$Row:$Col$Row range reference, quoted or
// unquoted sheet name — the exact shape SUMPRODUCT(--ISERROR(...))
// scan formulas use for each sheet they cover.
const RANGE_REF_RE = /(?:'([^']+)'|\b([A-Za-z][A-Za-z0-9]*))!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)/g;

// A formula is a plausible "whole-workbook error scan" if it contains
// ISERROR and references at least 3 distinct sheets — a single- or
// two-sheet ISERROR check is an ordinary, narrowly-scoped formula, not
// a workbook-wide control this check is meant to evaluate.
const MIN_SHEETS_FOR_SCAN_PATTERN = 3;

function checkErrorScanCoverage(workbook) {
  const findings = [];

  // Precompute each sheet's actual used range and whether it has any
  // formula content at all — a sheet with zero formulas can never
  // produce a formula-level error value, so its absence from the scan
  // genuinely doesn't matter and shouldn't be flagged.
  // FIX: found via a failing synthetic test — ExcelJS's actualRowCount
  // / actualColumnCount count non-empty rows/columns, not the maximum
  // populated index (confirmed directly: a sheet with only A1 and C10
  // populated reports actualRowCount=2, actualColumnCount=2, not 10
  // and 3). Real, dense financial-model content made this
  // indistinguishable from the correct measure in earlier testing,
  // but it is the wrong measure in general — computes the true max
  // row/col index directly while scanning for formula content, which
  // this loop is already iterating through anyway.
  const sheetInfo = new Map();
  workbook.eachSheet(ws => {
    let hasFormula = false;
    let maxRow = 0, maxCol = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (cell.formula) hasFormula = true;
        if (rowNum > maxRow) maxRow = rowNum;
        if (colNum > maxCol) maxCol = colNum;
      });
    });
    sheetInfo.set(ws.name, { maxRow, maxCol, hasFormula });
  });

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const formula = cell.formula;
        if (!formula || !/ISERROR/i.test(formula)) return;

        RANGE_REF_RE.lastIndex = 0;
        const covered = new Map(); // sheetName -> { maxRow, maxCol }
        let m;
        while ((m = RANGE_REF_RE.exec(formula))) {
          const sheetName = (m[1] || m[2]).trim();
          const endCol = colToNum(m[5]);
          const endRow = parseInt(m[6], 10);
          const existing = covered.get(sheetName);
          if (!existing || endRow > existing.maxRow || endCol > existing.maxCol) {
            covered.set(sheetName, { maxRow: endRow, maxCol: endCol });
          }
        }
        if (covered.size < MIN_SHEETS_FOR_SCAN_PATTERN) return; // not a whole-workbook scan pattern

        const insufficientRanges = [];
        for (const [sheetName, range] of covered) {
          const info = sheetInfo.get(sheetName);
          if (!info) continue; // referenced sheet doesn't exist in this workbook — a different, separate concern
          if (range.maxRow < info.maxRow || range.maxCol < info.maxCol) {
            insufficientRanges.push({ sheet: sheetName, coveredRows: range.maxRow, coveredCols: range.maxCol, actualRows: info.maxRow, actualCols: info.maxCol });
          }
        }

        const missingSheets = [];
        for (const [sheetName, info] of sheetInfo) {
          if (covered.has(sheetName)) continue;
          if (!info.hasFormula) continue; // no formula content — cannot produce a formula-level error, safe to exclude
          missingSheets.push(sheetName);
        }

        if (insufficientRanges.length === 0 && missingSheets.length === 0) return; // genuinely full coverage — nothing to flag

        findings.push({
          sheet: ws.name, cell: cell.address,
          insufficientRanges, missingSheets,
          note: buildNote(ws.name, cell.address, insufficientRanges, missingSheets),
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} whole-workbook error-scan control(s) have incomplete coverage.`
      : 'No whole-workbook error-scan control was found with incomplete coverage.',
  };
}

function buildNote(sheet, cell, insufficientRanges, missingSheets) {
  const parts = [`${sheet}!${cell} is a whole-workbook error-scan control ("no Excel errors"-style), but its coverage is incomplete.`];
  if (missingSheets.length > 0) {
    parts.push(`${missingSheets.length} sheet(s) with genuine formula content are entirely missing from the scan: ${missingSheets.slice(0, 8).join(', ')}${missingSheets.length > 8 ? ', and others' : ''}.`);
  }
  if (insufficientRanges.length > 0) {
    const sample = insufficientRanges.slice(0, 5).map(r => `${r.sheet} (checks ${r.coveredRows}x${r.coveredCols}, actual used range is ${r.actualRows}x${r.actualCols})`).join('; ');
    parts.push(`${insufficientRanges.length} covered sheet(s) have a narrower checked range than their actual used range: ${sample}${insufficientRanges.length > 5 ? ', and others' : ''}.`);
  }
  parts.push('The control could report "OK"/no exceptions while a genuine Excel error value sits undetected in any of these gaps.');
  return parts.join(' ');
}

module.exports = { checkErrorScanCoverage };
