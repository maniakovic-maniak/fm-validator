// hardcoded-major-asset-check.js
//
// Found via an independent review: Financial Statements!G34:L34
// ("Development Property and Capitalised Project Costs" — the
// model's largest balance-sheet asset) are entirely typed numeric
// constants, no formula at all, across every period. Confirmed
// directly: the peak value ($407.49m) differs from the genuine cost
// schedule total (Underwriting!I57 = $418.76m) by exactly $11.27m,
// matching the review's claim precisely.
//
// A major asset line disconnected from its own cost/basis schedule
// means any change to the underlying cost build (a change order, a
// revised estimate, a genuine cost overrun) will never flow through
// to the balance sheet — the two will silently diverge further over
// time with no warning.
//
// Distinct from the existing general hardcode-detection checks
// (T0-HARDCHECK-001 and similar, which flag check/reconciliation
// cells specifically): this is scoped to major ASSET lines by label,
// which carry a materially different risk profile than a hardcoded
// flag or unit label — a wrong asset balance directly misstates the
// balance sheet and any leverage/coverage ratio computed from it.
//
// PREVALENCE TESTED before finalizing: 1 match on the real file (8 of
// 8 numeric cells on the row, all typed constants), zero matches on
// three other real test files.

const ASSET_LABEL_TERMS = [
  'development property', 'capitalised project cost', 'capitalized project cost',
  'property, plant', 'fixed assets', 'construction in progress', 'capital work in progress',
];
const MIN_NUMERIC_CELLS = 3; // need a genuine multi-period run, not a single opening-balance input
const MIN_CONSTANT_FRACTION = 0.75; // most of the row must be hardcoded, not just one or two early periods

function checkHardcodedMajorAsset(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      let label = null;
      row.eachCell({ includeEmpty: false }, cell => {
        if (label) return;
        const v = cell.value;
        if (typeof v === 'string' && v.trim() && isNaN(parseFloat(v))) label = v;
      });
      if (!label) return;
      const lowerLabel = label.toLowerCase();
      const matchedTerm = ASSET_LABEL_TERMS.find(t => lowerLabel.includes(t));
      if (!matchedTerm) return;

      let numericCells = 0, constantCells = 0;
      const constantAddresses = [];
      let maxValue = -Infinity;
      row.eachCell({ includeEmpty: false }, cell => {
        if (typeof cell.value !== 'number') return;
        numericCells++;
        if (cell.value > maxValue) maxValue = cell.value;
        if (!cell.formula) { constantCells++; constantAddresses.push(cell.address); }
      });
      if (numericCells < MIN_NUMERIC_CELLS) return;
      if (constantCells / numericCells < MIN_CONSTANT_FRACTION) return;

      findings.push({
        sheet: ws.name, rowNum, label, sampleCell: constantAddresses[0],
        numericCells, constantCells, maxValue,
        note: `${ws.name}!${constantAddresses[0]} ("${label}") is a major balance-sheet asset line where ${constantCells} of ${numericCells} period(s) are typed numeric constants with no formula at all (peak value: ${maxValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}), rather than being linked to a cost/basis schedule. A large asset disconnected from its own cost build will silently diverge from it over time with no warning — confirm whether this is intentional (a fixed, confirmed opening balance) or should be linked to the underlying cost schedule.`,
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} major asset row(s) are largely or entirely hardcoded rather than linked to a cost/basis schedule.`
      : 'No major asset row was found to be largely hardcoded.',
  };
}

module.exports = { checkHardcodedMajorAsset };
