// display-rounds-to-zero-check.js — sourced from ICAEW's "How to Review
// a Spreadsheet" (D6): a small nonzero percentage formatted with no
// decimal places displays as "0%" — visually indistinguishable from a
// genuine zero, even though the underlying value is real and nonzero.
//
// SCOPE, deliberately narrow: only the no-decimal-place PERCENTAGE
// format case (e.g. "0%", "#,##0%") is checked — the specific,
// unambiguous example ICAEW cites. General numeric formats have far
// more custom-format variants to parse correctly, and a wrong parse
// there risks a real false positive; not attempted here.

function isNoDecimalPercentFormat(numFmt) {
  if (!numFmt || typeof numFmt !== 'string') return false;
  if (!numFmt.includes('%')) return false;
  // A decimal place in the format looks like "0.0%" or "#,##0.00%" —
  // if there's a "." before the "%", decimals ARE shown, so this
  // specific check doesn't apply.
  const percentIndex = numFmt.indexOf('%');
  const beforePercent = numFmt.slice(0, percentIndex);
  return !beforePercent.includes('.');
}

function checkDisplayRoundsToZero(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (!isNoDecimalPercentFormat(cell.numFmt)) return;
        const raw = cell.formula ? cell.result : cell.value;
        if (typeof raw !== 'number') return;
        if (raw === 0) return; // a genuine zero correctly displays as 0% — not misleading
        // Rounds to 0% at zero decimal places: between -0.5% and 0.5%
        // (exclusive of exactly ±0.5%, which rounds away from zero
        // under standard rounding).
        if (Math.abs(raw) < 0.005) {
          findings.push({
            sheet: ws.name,
            cell: cell.address,
            actualValue: raw,
            numFmt: cell.numFmt,
            note: `${ws.name}!${cell.address} contains ${(raw * 100).toFixed(4)}% but is formatted to display with no decimal places, so it shows as "0%" — visually indistinguishable from a genuine zero, even though the underlying value is real.`,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a cell holding a small nonzero percentage (between -0.5% and 0.5%, exclusive) formatted with no decimal places — it displays as "0%", indistinguishable from a genuine zero. Only the no-decimal-place percentage format case is checked; other display-rounding scenarios are out of scope for this pass.',
  };
}

module.exports = { checkDisplayRoundsToZero };
