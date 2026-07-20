// dscr-gated-distributions-check.js — sourced from the World Bank/PPIAF
// Greenfield Mining Transport Infrastructure report (D5): lenders
// customarily require both a backward- and forward-looking minimum DSCR
// test (often ~1.4x) before permitting distributions.
//
// DELIBERATE DESIGN CHOICE, disclosed: the customary 1.4x figure varies
// by deal and financing document, so using it directly as a pass/fail
// line would risk a high false-positive rate on any real deal with a
// different agreed threshold. Instead, this check anchors on DSCR < 1.0x
// — a period where the project's cash flow is mathematically
// insufficient to cover its own debt service. A distribution paid in
// such a period is a much harder, less deal-specific concern than a
// distribution paid at, say, 1.2x against a 1.4x covenant (which might
// simply reflect a different agreed threshold, not an error). The
// customary ~1.4x figure is mentioned in the finding text as context,
// not used as the flagging line.
//
// METHOD: find distributions, backward-DSCR, and forward-DSCR labelled
// time series (preferring same-sheet matches), align them by COLUMN
// LETTER (same column = same period — a defensible assumption given
// FAST Standard's own "consistent time ruler" convention already
// partially validated elsewhere in this codebase), and flag any period
// where a distribution is paid while either DSCR series reads below 1.0
// at that same column.

const { findLabeledRowSeries } = require('./find-labeled-value');

const DISTRIBUTION_TERMS = ['distributions paid', 'dividends paid', 'distribution to equity', 'distributions / buybacks', 'distributions/buybacks', 'dividends', 'distributions'];
const BACKWARD_DSCR_TERMS = ['backward looking dscr', 'backward-looking dscr', 'historic dscr', 'trailing dscr'];
const FORWARD_DSCR_TERMS = ['forward looking dscr', 'forward-looking dscr', 'projected dscr', 'prospective dscr'];
// FIX (found via real testing against The Bend): the model clearly has a
// real DSCR-gated distribution lock-up (P&L!C107 states it explicitly),
// but uses a single unified "DSCR" label rather than an explicit
// backward/forward split — a common, real pattern this check's original
// scope would have made itself inapplicable to. Used only as a fallback
// when NEITHER an explicit backward nor forward series is found — an
// explicit split, when present, is always preferred as more precise.
const GENERAL_DSCR_TERMS = ['dscr'];

const DSCR_HARD_FLOOR = 1.0;

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

function checkDscrGatedDistributions(workbook) {
  const distributionRows = findLabeledRowSeries(workbook, DISTRIBUTION_TERMS, { maxDistance: 60 });
  let backwardRows = findLabeledRowSeries(workbook, BACKWARD_DSCR_TERMS, { maxDistance: 60 });
  let forwardRows = findLabeledRowSeries(workbook, FORWARD_DSCR_TERMS, { maxDistance: 60 });
  let usedGeneralFallback = false;
  if (backwardRows.length === 0 && forwardRows.length === 0) {
    const generalRows = findLabeledRowSeries(workbook, GENERAL_DSCR_TERMS, { maxDistance: 60 });
    if (generalRows.length > 0) {
      forwardRows = generalRows; // functionally serves the same gating role as an explicit split
      usedGeneralFallback = true;
    }
  }

  if (distributionRows.length === 0 || (backwardRows.length === 0 && forwardRows.length === 0)) {
    return {
      applicable: false,
      flaggedCount: 0,
      findings: [],
      note: distributionRows.length === 0
        ? 'No labelled distributions time series found — this check does not apply to models without one.'
        : 'Distributions were found, but no explicitly-labelled backward- or forward-looking DSCR time series was found to check them against.',
    };
  }

  const findings = [];
  for (const distRow of distributionRows) {
    const sameSheetBackward = backwardRows.filter(r => r.sheet === distRow.sheet);
    const sameSheetForward = forwardRows.filter(r => r.sheet === distRow.sheet);
    const backward = (sameSheetBackward.length > 0 ? sameSheetBackward : backwardRows)[0];
    const forward = (sameSheetForward.length > 0 ? sameSheetForward : forwardRows)[0];
    if (!backward && !forward) continue;

    const backwardByCol = backward ? seriesByColumn(backward.series) : {};
    const forwardByCol = forward ? seriesByColumn(forward.series) : {};

    for (const point of distRow.series) {
      if (point.value <= 0) continue; // no distribution paid this period — nothing to check
      const col = colLetterOf(point.cell);
      if (!col) continue;
      const bVal = backwardByCol[col];
      const fVal = forwardByCol[col];
      const bBelow = typeof bVal === 'number' && bVal < DSCR_HARD_FLOOR;
      const fBelow = typeof fVal === 'number' && fVal < DSCR_HARD_FLOOR;
      if (bBelow || fBelow) {
        const dscrDescriptor = usedGeneralFallback
          ? `DSCR is ${fVal}`
          : `${bBelow ? `backward-looking DSCR is ${bVal}` : ''}${bBelow && fBelow ? ' and ' : ''}${fBelow ? `forward-looking DSCR is ${fVal}` : ''}`;
        findings.push({
          sheet: distRow.sheet,
          distributionCell: point.cell,
          distributionValue: point.value,
          backwardDscr: bVal,
          forwardDscr: fVal,
          usedGeneralFallback,
          note: `${distRow.sheet}!${point.cell} shows a distribution of ${point.value} paid in a period where ${dscrDescriptor} — below 1.0x, meaning the project's own cash flow was mathematically insufficient to cover its debt service that period. Lenders customarily require a DSCR test (often around 1.4x, though this varies by deal, and ideally both a backward- and forward-looking version) before permitting a distribution at all; a value below 1.0x is a materially harder concern than falling short of a specific covenant level.${usedGeneralFallback ? ' Note: this model uses a single unified DSCR figure rather than an explicit backward/forward split, so this check used that general figure.' : ''}`,
        });
      }
    }
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: `Flags a period where a distribution was paid while DSCR (aligned by column position — explicit backward/forward split when labelled that way, otherwise falling back to a single unified "DSCR" label if that's what the model uses) reads below 1.0x — deliberately anchored on this mathematically hard floor rather than the customary ~1.4x lock-up level, which varies by deal and would risk false positives against a different agreed threshold. Requires an explicitly-labelled distributions series AND at least one explicitly-labelled DSCR series; nothing is inferred or guessed.${usedGeneralFallback ? ' This run used the general-DSCR fallback, since no explicit backward/forward split was found.' : ''}`,
  };
}

module.exports = { checkDscrGatedDistributions };
