// tax-effective-rate-check.js — G6 (Phase D deterministic gap-fill).
// Compares the model's own COMPUTED effective tax rate (tax expense /
// pre-tax income, per period) against a labelled statutory rate
// assumption. A large, unexplained gap between the two — e.g. an
// effective rate of 5% against a 30% statutory rate input, with nothing
// else in the model to explain the difference — is a common symptom of
// a broken tax calculation (a formula referencing the wrong base, a
// rate input not actually wired into the tax formula, etc.).
//
// Framed explicitly as a verification prompt, not an assertion of
// error: a real, legitimate gap can exist for reasons this check cannot
// see (tax losses carried forward, credits, a different rate applying
// to a specific jurisdiction or period) — the check flags the
// DISCREPANCY, not a conclusion about its cause.
//
// Uses findLabeledRowSeries (the same column-alignment technique proven
// in dscr-gated-distributions-check.js) for tax expense and pre-tax
// income, since both need to be checked period-by-period, not as a
// single representative value. The statutory rate is typically a single
// constant assumption, so findLabeledValues (single-nearest) is used for
// that specifically.

const { findLabeledRowSeries, findLabeledValues } = require('./find-labeled-value');

const TAX_EXPENSE_TERMS_SPECIFIC = ['tax expense', 'income tax expense', 'tax charge', 'current tax', 'income tax'];
const PRETAX_INCOME_TERMS = ['pre-tax income', 'pretax income', 'profit before tax', 'earnings before tax', 'ebt', 'pbt'];
const STATUTORY_RATE_TERMS = ['statutory tax rate', 'corporate tax rate', 'tax rate'];

// FIX (found via real testing on Carlsberg, before shipping): an
// earlier version added a bare "tax" fallback term for when nothing
// more specific matched. Confirmed directly that this was a mistake,
// not just risky in theory — on a real file it matched "Change in
// Deferred Tax/Capital Expenditure", "Stable taxes", "Tax Adjustment",
// "Taxes in Terminal Year", and "Adjustment to Taxes" — five genuinely
// different tax-ADJACENT concepts (terminal-value adjustments, deferred
// tax movements, normalization line items), none of which is a
// straightforward period tax-expense line comparable to a flat
// statutory rate. There is no reliable substring-based way to
// distinguish "the" tax expense line from these other legitimate but
// different concepts, so the fallback is removed entirely — "not
// applicable" is the honest, safe outcome when only ambiguous labels
// exist, matching this project's established "skip rather than guess"
// discipline (see total-range-check.js).
const EXCLUDED_LABEL_TERMS = ['rate', 'loss carry'];

function isExcludedLabel(labelText) {
  const t = (labelText || '').toLowerCase();
  return EXCLUDED_LABEL_TERMS.some(x => t.includes(x));
}

const DEVIATION_THRESHOLD = 0.10; // 10 percentage points
const MIN_PRETAX_INCOME = 1000;   // skip periods with negligible/negative pre-tax income — ratio is meaningless there

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

function checkTaxEffectiveRate(workbook) {
  const taxRows = findLabeledRowSeries(workbook, TAX_EXPENSE_TERMS_SPECIFIC, { maxDistance: 60 })
    .filter(r => !isExcludedLabel(r.labelText));

  const pretaxRows = findLabeledRowSeries(workbook, PRETAX_INCOME_TERMS, { maxDistance: 60 })
    .filter(r => !isExcludedLabel(r.labelText));
  const statutoryCandidates = findLabeledValues(workbook, STATUTORY_RATE_TERMS, { maxDistance: 8 });

  if (taxRows.length === 0 || pretaxRows.length === 0 || statutoryCandidates.length === 0) {
    const missing = [];
    if (taxRows.length === 0) missing.push('tax expense');
    if (pretaxRows.length === 0) missing.push('pre-tax income');
    if (statutoryCandidates.length === 0) missing.push('statutory tax rate');
    return {
      applicable: false,
      flaggedCount: 0,
      findings: [],
      note: `Missing labelled ${missing.join(' and ')} — this check requires all three (tax expense series, pre-tax income series, and a statutory rate) to be explicitly labelled; nothing is inferred or guessed.`,
    };
  }

  // A statutory rate expressed as a fraction (0.30) vs a whole number
  // (30) is genuinely ambiguous from the cell alone — treat anything
  // greater than 1 as a whole-number percentage and normalize it,
  // matching common real-world labelling of both forms.
  const rawRate = statutoryCandidates[0].value;
  const statutoryRate = typeof rawRate === 'number' ? (rawRate > 1 ? rawRate / 100 : rawRate) : null;
  if (statutoryRate === null) {
    return { applicable: false, flaggedCount: 0, findings: [], note: 'A statutory tax rate label was found, but its value is not numeric.' };
  }

  const findings = [];
  for (const taxRow of taxRows) {
    const samesheetPretax = pretaxRows.filter(r => r.sheet === taxRow.sheet);
    const pretax = (samesheetPretax.length > 0 ? samesheetPretax : pretaxRows)[0];
    const pretaxByCol = seriesByColumn(pretax.series);

    for (const point of taxRow.series) {
      const col = colLetterOf(point.cell);
      if (!col) continue;
      const pretaxVal = pretaxByCol[col];
      if (typeof pretaxVal !== 'number' || pretaxVal < MIN_PRETAX_INCOME) continue;

      const effectiveRate = Math.abs(point.value) / pretaxVal;
      const deviation = Math.abs(effectiveRate - statutoryRate);
      if (deviation > DEVIATION_THRESHOLD) {
        findings.push({
          sheet: taxRow.sheet,
          taxCell: point.cell,
          taxValue: point.value,
          pretaxIncomeValue: pretaxVal,
          effectiveRate: Math.round(effectiveRate * 1000) / 1000,
          statutoryRate: Math.round(statutoryRate * 1000) / 1000,
          note: `${taxRow.sheet}!${point.cell}: computed effective tax rate is ${(effectiveRate * 100).toFixed(1)}% (tax expense ${point.value} / pre-tax income ${pretaxVal}) against a statutory rate input of ${(statutoryRate * 100).toFixed(1)}% — a gap of ${(deviation * 100).toFixed(1)} percentage points. A real, legitimate gap can exist (tax losses carried forward, credits, a different jurisdictional rate) — this flags the discrepancy for review, not a confirmed error.`,
        });
      }
    }
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: `Compares computed effective tax rate (|tax expense| / pre-tax income) per period against a labelled statutory rate of ${(statutoryRate * 100).toFixed(1)}%, flagging gaps over ${DEVIATION_THRESHOLD * 100} percentage points. Periods with pre-tax income below ${MIN_PRETAX_INCOME} are skipped — the ratio is meaningless or misleading near a loss.`,
  };
}

module.exports = { checkTaxEffectiveRate };
