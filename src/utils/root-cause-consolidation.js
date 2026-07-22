// root-cause-consolidation.js — P1/P2/P3 framework renewal, Tier 2
// item 1. The memo's principle #4: "one formula error copied across 100
// periods should be recorded as one master finding with 100
// occurrences, not 100 separate findings." Today's checks already do
// the FINDING-level consolidation (one Issue Log row per check, not one
// per instance) — this adds the missing STRUCTURED DATA the memo
// actually specifies: Root Cause ID, Master Finding ID, Occurrence
// Count, Material Occurrence Count, Affected Cells (the REAL full list,
// not the 5-8 sample already baked into prose text for display), and
// Affected Sheets.
//
// SCOPE, disclosed honestly: this handles the common shape used by the
// majority of checks built this session — a top-level `findings` array
// where each item carries `sheet` (100% consistent across every check
// surveyed) plus one of several common cell-identifying field names.
// A handful of checks with genuinely different shapes (nested `results`/
// sub-array structures, e.g. balance-never-negative-check.js's
// results[].negativeInstances[]) are NOT yet covered by this utility —
// noted as a real, disclosed follow-up rather than risking an
// under-tested generic handler for shapes not yet carefully surveyed.

/** Extracts a single "Sheet!Cell"-style reference from one finding item,
 * trying the field names actually observed across this session's checks,
 * in priority order. Returns null if no recognizable cell reference is
 * present (e.g. a check that is itself sheet-level, not cell-level). */
function extractCellRef(item) {
  // FIX (found via real testing): revenue-double-counting-check.js's
  // componentCell field is ALREADY a fully-formatted "Sheet!Cell"
  // string, with no separate top-level `sheet` field on the finding
  // item at all — the sheet-first guard below was silently rejecting
  // every one of this check's findings, producing an empty
  // affected_cells list despite the real cell reference being right
  // there. Any single-cell field already containing "!" is used as-is.
  const preformattedField = item.componentCell || item.cell;
  if (typeof preformattedField === 'string' && preformattedField.includes('!')) {
    return preformattedField;
  }

  const sheet = item.sheet;
  if (!sheet) return null;

  const singleCellField = item.cell || item.componentCell || item.taxCell ||
    item.distributionCell || item.revolverCell || item.dsraCell || item.labelCell ||
    item.headerCell;
  if (singleCellField) return `${sheet}!${singleCellField}`;

  // Paired-cell shape (e.g. period-sequence-gap-check.js) — anchor on
  // the "before" cell, since that's where the gap is first detected.
  if (item.beforeCell) return `${sheet}!${item.beforeCell}`;

  // Row-based shape (e.g. terminal-period-completeness-check.js) — use
  // the first terminal cell if present, else a synthetic row reference.
  if (Array.isArray(item.terminalCells) && item.terminalCells.length > 0) {
    return `${sheet}!${item.terminalCells[0]}`;
  }
  if (typeof item.row === 'number') return `${sheet}!Row${item.row}`;

  return null;
}

/** Builds the structured root-cause consolidation fields for a check's
 * raw result object (must have a top-level `findings` array in the
 * common shape). `checkId` is used as both Root Cause ID and Master
 * Finding ID for now — a 1:1 mapping, since none of today's checks
 * currently produce genuinely distinguishable multiple root causes
 * within a single check; a check that later needs to split into
 * multiple root causes can pass a more specific id per call. */
function buildRootCauseFields(checkId, checkResult, opts = {}) {
  const findings = Array.isArray(checkResult && checkResult.findings) ? checkResult.findings : [];
  const affectedCells = [];
  const affectedSheets = new Set();

  for (const item of findings) {
    const ref = extractCellRef(item);
    if (ref) affectedCells.push(ref);
    if (item.sheet) affectedSheets.add(item.sheet);
  }

  // materialityFilter, if provided, decides which occurrences count as
  // MATERIAL (vs merely detected) — e.g. a dollar-value threshold.
  // Defaults to treating every occurrence as material, which is
  // accurate for the majority of today's checks (a daisy chain either
  // exists or doesn't; there's no natural materiality gradient
  // per-occurrence for most of these patterns).
  const materialityFilter = typeof opts.materialityFilter === 'function' ? opts.materialityFilter : () => true;
  const materialOccurrenceCount = findings.filter(materialityFilter).length;

  return {
    root_cause_id: checkId,
    master_finding_id: checkId,
    occurrence_count: findings.length,
    material_occurrence_count: materialOccurrenceCount,
    affected_cells: affectedCells,
    affected_sheets: [...affectedSheets],
    common_remediation_action: opts.commonRemediationAction || '',
  };
}

module.exports = { extractCellRef, buildRootCauseFields };
