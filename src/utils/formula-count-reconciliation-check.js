// formula-count-reconciliation-check.js
//
// Found via an independent review (MR-011): four different formula-
// cell counts appeared across this project's own outputs for the
// same file (raw OOXML, Tier 0's own count, the model's own self-
// reported count, and a separate technical review), with no stated
// methodology explaining why they might legitimately differ. Traced
// the Tier 0 vs. raw-OOXML gap precisely to Excel Data Table cells
// (fixed separately in validator-tier0.js). This check addresses the
// remaining piece: reconciling against the MODEL's OWN self-reported
// count, where the model states one, flagging a material discrepancy
// rather than leaving two different numbers unreconciled in the
// same report.

// Matches the model's own self-reported formula count, e.g. "All 14
// worksheets | 252,348 used cells | 65,246 formulas" — deliberately
// requires the word "formula(s)" immediately after the number, not
// just any number in a QA-status cell, to keep false-positive risk low.
const SELF_REPORTED_COUNT_RE = /([\d,]{3,10})\s*formulas?\b/i;

// A material discrepancy threshold — small differences (a handful of
// cells) are expected and already explained by known methodology
// differences (Data Table cells, shared-formula edge cases); this
// flags only a genuinely material gap worth a reader's attention.
const MATERIAL_DISCREPANCY_PCT = 0.5; // percent

function checkFormulaCountReconciliation(workbook, tier0Stats) {
  if (!tier0Stats || typeof tier0Stats.totalFormulaCells !== 'number') {
    return { applicable: false, flaggedCount: 0, findings: [], note: 'No Tier 0 formula-cell count was available to reconcile against.' };
  }

  const tier0Count = tier0Stats.formulaCellsIncludingDataTables ?? tier0Stats.totalFormulaCells;
  const groups = new Map(); // selfReportedCount -> { cells: [{sheet, address}] }

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        const raw = (v && typeof v === 'object' && 'result' in v) ? v.result : v;
        if (typeof raw !== 'string') return;
        const m = SELF_REPORTED_COUNT_RE.exec(raw);
        if (!m) return;

        const selfReportedCount = parseInt(m[1].replace(/,/g, ''), 10);
        if (!Number.isFinite(selfReportedCount) || selfReportedCount <= 0) return;

        // A genuine workbook-wide self-report should be comparably
        // scaled to Tier 0's own workbook-wide count — a small, local
        // per-component or per-scenario formula count (confirmed
        // directly: this model has several such local counts, e.g.
        // "369 formulas" for one specific line item) uses the same
        // "N formulas" phrasing without claiming to be the workbook's
        // total at all. Requiring at least half of Tier 0's count
        // before even considering a match keeps this check anchored
        // to genuine total-vs-total reconciliation.
        if (selfReportedCount < tier0Count * 0.5) return;

        const diff = Math.abs(tier0Count - selfReportedCount);
        const pctDiff = 100 * diff / Math.max(tier0Count, selfReportedCount);
        if (pctDiff < MATERIAL_DISCREPANCY_PCT) return; // within expected tolerance — not material

        if (!groups.has(selfReportedCount)) groups.set(selfReportedCount, { cells: [] });
        groups.get(selfReportedCount).cells.push({ sheet: ws.name, address: cell.address });
      });
    });
  });

  const findings = [];
  for (const [selfReportedCount, g] of groups) {
    const sample = g.cells[0];
    const diff = Math.abs(tier0Count - selfReportedCount);
    const pctDiff = Math.round((100 * diff / Math.max(tier0Count, selfReportedCount)) * 10) / 10;
    findings.push({
      sheet: sample.sheet, cell: sample.address,
      tier0Count, selfReportedCount, diff, pctDiff,
      instanceCount: g.cells.length,
      allSheets: [...new Set(g.cells.map(c => c.sheet))],
      note: `${sample.sheet}!${sample.address}${g.cells.length > 1 ? ` (and ${g.cells.length - 1} other cell(s) showing the same figure, across ${[...new Set(g.cells.map(c => c.sheet))].join(', ')})` : ''} states ${selfReportedCount.toLocaleString()} formulas, but this audit's own formula-cell scan counted ${tier0Count.toLocaleString()} — a ${diff.toLocaleString()}-cell (${pctDiff}%) difference, larger than the tolerance expected from known methodology differences (e.g. Data Table cells, shared-formula edge cases). Confirm which count is authoritative, or investigate why the two counting methods diverge by this much before relying on either figure.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} material discrepancy(ies) found between this audit's formula-cell count and the model's own self-reported count.`
      : 'No material discrepancy found between this audit\'s formula-cell count and any self-reported count in the model (or the model does not report one).',
  };
}

module.exports = { checkFormulaCountReconciliation };
