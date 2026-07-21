// revolver-cash-crosscheck.js — sourced from FMI's "Checking and
// Reviewing a Model" (D2): "if the revolver has a zero balance, cash
// should be positive, and vice versa." A working revolver/cash sweep
// mechanism should never leave a period with BOTH an undrawn revolver
// AND non-positive cash (nothing covering a shortfall), nor a period
// with a meaningfully drawn revolver AND ample cash sitting alongside
// it (no reason to have drawn).
//
// Column-alignment technique matches dscr-gated-distributions-check.js.
// Framed as a verification prompt: real models can have legitimate
// reasons for a period to look unusual (a minimum-cash covenant, a
// timing artifact) — this flags the pattern, not a confirmed defect.

const { findLabeledRowSeries } = require('./find-labeled-value');

const REVOLVER_TERMS = ['revolver balance', 'revolving credit facility balance', 'revolver drawn balance', 'revolver'];
const CASH_TERMS = ['cash balance', 'closing cash', 'cash and cash equivalents'];

// A revolver draw is only "meaningful" above this floor, and cash is
// only "ample" above this floor — avoids flagging on rounding-level
// noise near zero on either side.
const MEANINGFUL_FLOOR = 1000;

function colLetterOf(cellAddr) {
  const m = /^([A-Z]+)\d+$/.exec(cellAddr);
  return m ? m[1] : null;
}
function seriesByColumn(series) {
  const map = {};
  for (const point of series) {
    const col = colLetterOf(point.cell);
    if (col) map[col] = point.value;
  }
  return map;
}

function checkRevolverCashCrosscheck(workbook) {
  const revolverRows = findLabeledRowSeries(workbook, REVOLVER_TERMS, { maxDistance: 60 });
  const cashRows = findLabeledRowSeries(workbook, CASH_TERMS, { maxDistance: 60 });

  if (revolverRows.length === 0 || cashRows.length === 0) {
    return {
      applicable: false, flaggedCount: 0, findings: [],
      note: `Missing labelled ${revolverRows.length === 0 ? 'revolver balance' : 'cash balance'} — this check requires both an explicitly labelled revolver balance and cash balance time series.`,
    };
  }

  const findings = [];
  for (const revRow of revolverRows) {
    const sameSheetCash = cashRows.filter(r => r.sheet === revRow.sheet);
    const cashRow = (sameSheetCash.length > 0 ? sameSheetCash : cashRows)[0];
    const cashByCol = seriesByColumn(cashRow.series);

    for (const point of revRow.series) {
      const col = colLetterOf(point.cell);
      if (!col) continue;
      const cashVal = cashByCol[col];
      if (typeof cashVal !== 'number') continue;

      if (point.value === 0 && cashVal <= 0) {
        findings.push({
          sheet: revRow.sheet, revolverCell: point.cell, cashCell: null,
          revolverValue: point.value, cashValue: cashVal, pattern: 'undrawn-revolver-nonpositive-cash',
          note: `${revRow.sheet}!${point.cell}: revolver balance is 0 (undrawn) but cash is ${cashVal} (not positive) in the same period. If cash is short, the revolver would normally be expected to draw to cover it.`,
        });
      } else if (point.value > MEANINGFUL_FLOOR && cashVal > MEANINGFUL_FLOOR) {
        findings.push({
          sheet: revRow.sheet, revolverCell: point.cell, cashCell: null,
          revolverValue: point.value, cashValue: cashVal, pattern: 'drawn-revolver-ample-cash',
          note: `${revRow.sheet}!${point.cell}: revolver balance is ${point.value} (drawn) while cash is also ${cashVal} (ample) in the same period. Confirm why the revolver was drawn when cash appears sufficient without it.`,
        });
      }
    }
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Cross-checks revolver balance against cash balance, period by period: flags either an undrawn revolver alongside non-positive cash (a shortfall not covered), or a meaningfully drawn revolver alongside ample cash (an apparently unnecessary draw). Framed as a verification prompt — legitimate reasons can exist (minimum-cash covenants, timing).',
  };
}

module.exports = { checkRevolverCashCrosscheck };
