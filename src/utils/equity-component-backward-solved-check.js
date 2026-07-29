// equity-component-backward-solved-check.js
//
// Found via an independent review directly disproving the automated
// audit's own output: Financial Statements!G42 ("Contributed Equity")
// = MAX(0,G35-G39-G43-G44) — Total Assets less Total Liabilities less
// Accumulated Profit less Distributions. Confirmed directly on the
// real file. Contributed equity is supposed to represent an
// independent fact (actual cash investors put in) — deriving it as a
// residual of the balance sheet equation means it will silently
// absorb any error anywhere else on the balance sheet, and every
// later period (H42 onward) anchors back to this single first-period
// value via an absolute reference, propagating the plug across the
// whole horizon.
//
// DISTINCT FROM the existing balance-sheet-plug-check.js, which is
// deliberately scoped to only LABELED plugs (a row literally named
// "Balancing Figure"). Confirmed directly that check returns zero
// findings here, exactly as its own documented scope predicts — this
// is an UNLABELLED plug. Rather than attempt broad, unscoped
// "any subtraction is suspicious" detection (which the existing
// check's own comments correctly identify as high false-positive
// risk), this check is narrow on purpose: it only flags a formula
// referencing BOTH a Total-Assets-labelled row and a Total-
// Liabilities-labelled row via subtraction, AND only when the
// formula's OWN row is labelled as a specific equity COMPONENT that
// should genuinely be independent (contributed equity, paid-in
// capital, share capital, etc.) — deliberately excluding legitimate
// residual lines like "Total Equity" or "Net Assets", which the
// accounting equation itself defines as Assets minus Liabilities.
//
// PREVALENCE TESTED before finalizing across three other real files.

const { findLabeledValues } = require('./find-labeled-value');

const ASSETS_LABEL_TERMS = ['total assets'];
const LIABILITIES_LABEL_TERMS = ['total liabilities'];

// Deliberately narrow: terms describing a component that should be an
// independent fact (cash actually contributed), never excluding
// legitimate whole-of-equity residual lines like "Total Equity" /
// "Shareholders' Equity" / "Net Assets", which the accounting
// equation itself defines as a residual and are correctly computed
// that way.
const CONTRIBUTION_COMPONENT_TERMS = [
  'contributed equity', 'paid-in capital', 'paid in capital',
  'share capital', 'common stock', 'capital contribution', 'member contribution',
];

function rowNumOf(cellAddr) {
  const m = /^[A-Z]+(\d+)$/.exec(cellAddr);
  return m ? m[1] : null;
}

function formulaReferencesRow(formula, rowNum) {
  if (!formula || !rowNum) return false;
  const re = new RegExp(`[A-Z]+\\$?${rowNum}\\b`);
  return re.test(formula);
}

function checkEquityComponentBackwardSolved(workbook) {
  const assetsRows = [...new Set(findLabeledValues(workbook, ASSETS_LABEL_TERMS).map(a => rowNumOf(a.valueCell)))].filter(Boolean);
  const liabRows = [...new Set(findLabeledValues(workbook, LIABILITIES_LABEL_TERMS).map(a => rowNumOf(a.valueCell)))].filter(Boolean);

  if (assetsRows.length === 0 || liabRows.length === 0) {
    return { applicable: true, flaggedCount: 0, findings: [],
      note: 'No labelled Total Assets and Total Liabilities row pair was found — this check does not apply without both.' };
  }

  const findings = [];
  const seenRows = new Set();

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const formula = cell.formula;
        if (!formula || !/[-\u2212]/.test(formula)) return;
        const referencesAssets = assetsRows.some(r => formulaReferencesRow(formula, r));
        const referencesLiabs = liabRows.some(r => formulaReferencesRow(formula, r));
        if (!referencesAssets || !referencesLiabs) return;

        // Find this cell's own row label, looking left.
        let ownLabel = null;
        for (let c = colNum - 1; c >= Math.max(1, colNum - 8); c--) {
          const v = row.getCell(c).value;
          if (typeof v === 'string' && v.trim()) { ownLabel = v; break; }
        }
        if (!ownLabel) return;
        const lower = ownLabel.toLowerCase();
        const matchedTerm = CONTRIBUTION_COMPONENT_TERMS.find(t => lower.includes(t));
        if (!matchedTerm) return;

        const key = `${ws.name}!row${rowNum}`;
        if (seenRows.has(key)) return; // one finding per row, not per period column
        seenRows.add(key);

        findings.push({
          sheet: ws.name, rowNum, sampleCell: cell.address, label: ownLabel,
          formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
          note: `${ws.name}!${cell.address}, labelled "${ownLabel}", is computed by subtracting Total Assets and Total Liabilities (formula: ${formula.length > 100 ? formula.slice(0, 100) + '…' : formula}) rather than as an independent figure. A contributed-equity-style line is supposed to represent an actual fact (cash investors put in), not a residual — deriving it this way means it silently absorbs any error elsewhere on the balance sheet, and if later periods anchor back to this same cell, the plug propagates across the whole horizon.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} equity-component line(s) appear to be computed as a residual of Total Assets less Total Liabilities rather than as an independent figure.`
      : 'No equity-component line (contributed equity, paid-in capital, etc.) was found to be derived as a residual of Total Assets and Total Liabilities.',
  };
}

module.exports = { checkEquityComponentBackwardSolved };
