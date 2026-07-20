// balance-never-negative-check.js — sourced from the Financial Modeling
// Institute's "Checking and Reviewing a Model" (D2): revolver and cash
// lines on the balance sheet should never be negative.
//
// Architecturally distinct from reasonableness-checks.js's threshold
// checks (which compare one representative OUTPUT value, like EBITDA
// margin, against a rule-of-thumb threshold): this needs to examine
// EVERY period of a time-series BALANCE line, since a single negative
// period anywhere is the finding, not a headline number. Built on
// findLabeledRowSeries (find-labeled-value.js) rather than
// findLabeledValues for exactly that reason — the same limitation
// disclosed for sign-convention-check.js's Cash/Fixed Assets/Debt
// Balance groups (which only see the nearest cell to a label) would
// otherwise apply here too, and defeat the entire point of this check.

const { findLabeledRowSeries } = require('./find-labeled-value');

const NEVER_NEGATIVE_GROUPS = [
  { label: 'Cash balance', terms: ['cash balance', 'closing cash', 'cash and cash equivalents'] },
  { label: 'Revolver balance', terms: ['revolver balance', 'revolving credit facility balance', 'revolver drawn balance'] },
];

function checkBalanceNeverNegative(workbook) {
  const results = [];

  for (const group of NEVER_NEGATIVE_GROUPS) {
    const rows = findLabeledRowSeries(workbook, group.terms, { maxDistance: 60 });
    const negativeInstances = [];
    for (const row of rows) {
      for (const point of row.series) {
        if (point.value < 0) {
          negativeInstances.push({ sheet: row.sheet, cell: point.cell, value: point.value, labelText: row.labelText, labelCell: row.labelCell });
        }
      }
    }
    if (negativeInstances.length === 0) continue;

    const sample = negativeInstances.slice(0, 5).map(n => `${n.sheet}!${n.cell} (${n.value})`).join(', ');
    results.push({
      applicable: true,
      label: group.label,
      flagged: true,
      negativeCount: negativeInstances.length,
      negativeInstances,
      note: `"${group.label}"-labelled time series include ${negativeInstances.length} negative period(s), e.g. ${sample}. A negative cash or revolver balance is a common sign of a broken or incomplete funding mechanism — e.g. a revolver draw not triggering when needed, or a minimum-cash requirement not being enforced — rather than a normal commercial outcome.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: results.reduce((sum, r) => sum + r.negativeCount, 0),
    results,
    note: 'Checks every period of a labelled Cash balance or Revolver balance time series for a negative value — unlike a single-value threshold check, one negative period anywhere in the series is the finding. Per FMI\'s "Checking and Reviewing a Model": revolver and cash lines on the balance sheet should never be negative.',
  };
}

module.exports = { checkBalanceNeverNegative };
