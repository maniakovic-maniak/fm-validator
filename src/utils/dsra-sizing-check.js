// dsra-sizing-check.js — sourced from TWO independent references, both
// citing the same customary practice: Ofgem's Cap and Floor Financial
// Model Handbook (D4) and the World Bank / PPIAF Greenfield Mining
// Transport Infrastructure report (D5) — both describe lenders
// typically requiring a debt service reserve account funded at
// completion to a level equivalent to at least six months of debt
// service.
//
// Framed as a ONE-SIDED, minimum-funding check, matching that framing
// precisely: "at least six months" describes a floor, not a target —
// a DSRA funded well above six months' worth is conservative, not a
// defect, so this only flags apparent UNDER-funding, never over-funding.
//
// SCOPE, deliberately narrow: this only fires when the model has an
// EXPLICITLY monthly-labeled debt service figure to compare against
// (e.g. "monthly debt service", "monthly P&I") — periodicity cannot be
// reliably inferred from an unlabeled figure (is a bare "debt service"
// number monthly, quarterly, or annual?), and guessing would produce an
// unreliable, non-defensible result. Matches this project's established
// "skip rather than guess" discipline (see total-range-check.js). If no
// explicitly-monthly figure is found, the check reports not applicable
// rather than attempting a periodicity conversion.

const { findLabeledValues } = require('./find-labeled-value');

const DSRA_TARGET_TERMS = ['dsra target', 'dsra required balance', 'debt service reserve account target', 'dsra requirement'];
const MONTHLY_DEBT_SERVICE_TERMS = ['monthly debt service', 'monthly p&i', 'monthly principal and interest'];

const MIN_MONTHS_CUSTOMARY = 6;
// A small tolerance below the customary 6-month floor before flagging —
// avoids treating a borderline 5.5-month DSRA as a defect when the
// underlying source language itself is a general customary practice,
// not a universal hard rule every deal must follow exactly.
const FLAG_BELOW_MONTHS = 5;

function checkDsraSizing(workbook) {
  const dsraCandidates = findLabeledValues(workbook, DSRA_TARGET_TERMS, { maxDistance: 8 });
  const monthlyDebtServiceCandidates = findLabeledValues(workbook, MONTHLY_DEBT_SERVICE_TERMS, { maxDistance: 8 });

  if (dsraCandidates.length === 0 || monthlyDebtServiceCandidates.length === 0) {
    return {
      applicable: false,
      flaggedCount: 0,
      findings: [],
      note: dsraCandidates.length === 0
        ? 'No labelled DSRA target/required-balance value found — this check does not apply to models without an explicit DSRA sizing figure.'
        : 'A DSRA target was found, but no explicitly monthly-labelled debt service figure was found to compare it against — periodicity cannot be reliably inferred from an unlabelled figure, so this check does not attempt a conversion and reports not applicable rather than guessing.',
    };
  }

  const findings = [];
  for (const dsra of dsraCandidates) {
    if (typeof dsra.value !== 'number' || dsra.value <= 0) continue;
    // Prefer a monthly-debt-service candidate on the SAME sheet as the
    // DSRA target, if one exists — more likely to be the genuinely
    // corresponding figure than one from an unrelated sheet.
    const sameSheet = monthlyDebtServiceCandidates.filter(c => c.sheet === dsra.sheet);
    const pick = (sameSheet.length > 0 ? sameSheet : monthlyDebtServiceCandidates)[0];
    if (typeof pick.value !== 'number' || pick.value <= 0) continue;

    const monthsCovered = dsra.value / pick.value;
    if (monthsCovered < FLAG_BELOW_MONTHS) {
      findings.push({
        sheet: dsra.sheet,
        dsraCell: dsra.valueCell,
        dsraValue: dsra.value,
        debtServiceSheet: pick.sheet,
        debtServiceCell: pick.valueCell,
        debtServiceValue: pick.value,
        monthsCovered: Math.round(monthsCovered * 10) / 10,
        note: `${dsra.sheet}!${dsra.valueCell} ("${dsra.labelText}") of ${dsra.value} covers approximately ${Math.round(monthsCovered * 10) / 10} months of debt service, based on ${pick.sheet}!${pick.valueCell} ("${pick.labelText}") of ${pick.value} — below the customary "at least six months" convention cited by both Ofgem's Cap and Floor Financial Model Handbook and the World Bank/PPIAF Greenfield Mining Transport Infrastructure report. Confirm whether this reflects the deal's actual agreed DSRA sizing (deal terms vary) or an under-funded reserve.`,
      });
    }
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a DSRA target that covers apparently fewer than ~5 months of a labelled monthly debt service figure, against the customary "at least six months" convention (two independent sources: Ofgem, World Bank/PPIAF). One-sided — a DSRA funded well above six months is not flagged, since the source convention is a floor, not a target. Only fires when an explicitly monthly-labelled debt service figure exists; periodicity is never inferred or guessed.',
  };
}

module.exports = { checkDsraSizing };
