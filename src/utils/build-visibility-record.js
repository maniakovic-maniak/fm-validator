/**
 * Builds a compact record of exactly which sheets and rows fm-validator's
 * own curated route actually included for a given run - not its
 * conclusions, its real, actual data visibility. This is what Partner
 * Review's Phase B needs to genuinely distinguish two structurally
 * different things that would otherwise look identical from the outside:
 *
 * - A genuine miss: the relevant cell was within fm-validator's own
 *   visibility, and it reasoned incorrectly or failed to flag something
 *   real. This is a legitimate signal about Tier 2's actual reasoning
 *   quality.
 * - A visibility gap: the relevant cell sits somewhere the curated route
 *   never looked at all. This says something about the curated route's
 *   own sampling logic, not about how well Tier 2 reasoned over what it
 *   was actually given - a structurally different, separate signal.
 *
 * Built directly from dataSubset/deepDataSubset (the same objects
 * validator-tier2.js already constructs for the real Tier 2 batches) -
 * no new parsing, just reading the real _excelRow/_cellRef fields
 * extractMeaningfulRows already attaches to every row it selects. Precision
 * is at the row level (was this row genuinely shown, by its real Excel row
 * number) plus one anchor cell per row - not a full per-column map, since
 * extractMeaningfulRows itself only keeps one representative cell reference
 * per row for token-cost reasons, not the complete set of cells shown.
 */
function buildVisibilityRecord({ dataSubset, deepDataSubset }) {
  const record = {};

  function recordSubset(subset, batchLabel) {
    for (const [sheetName, rows] of Object.entries(subset || {})) {
      if (!record[sheetName]) record[sheetName] = { batches: new Set(), rowNumbers: new Set(), cellAddresses: new Set() };
      record[sheetName].batches.add(batchLabel);
      for (const row of rows) {
        // These are extractMeaningfulRows' own, real output field names -
        // a single row anchor and its cell, not the raw per-column
        // _rowNum/_cellRefs map that only exists before that function's
        // own final trimming step.
        if (row._excelRow !== undefined) record[sheetName].rowNumbers.add(row._excelRow);
        if (row._cellRef) record[sheetName].cellAddresses.add(row._cellRef);
      }
    }
  }

  recordSubset(dataSubset, 'batch1_3');
  recordSubset(deepDataSubset, 'batch2');

  // Convert to a plain, JSON-serializable shape - Sets don't survive
  // JSON.stringify, and a partner review engagement needs this exported
  // to a file, not kept in memory.
  const serializable = {};
  for (const [sheetName, data] of Object.entries(record)) {
    serializable[sheetName] = {
      batches: Array.from(data.batches),
      rowNumbers: Array.from(data.rowNumbers).sort((a, b) => a - b),
      cellAddresses: Array.from(data.cellAddresses).sort(),
    };
  }
  return serializable;
}

module.exports = { buildVisibilityRecord };
