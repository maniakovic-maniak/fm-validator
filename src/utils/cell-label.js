// Shared "find the nearby descriptive label for a cell" helper.
//
// Extracted from redundant-inputs.js rather than duplicated into every
// detector that needs it — two independent copies of the same search
// logic is exactly the kind of thing that silently drifts apart the next
// time either one needs a fix (as happened once already: the left-only
// search missed labels sitting to the right of a value, a real bug found
// against a real client model).
//
// Searches left first (the most common convention — "label, then value"),
// then right if nothing is found, within a bounded window on the same row.

// FIX: found via a real pipeline run. This file previously carried its
// own independent copy of the same cell-value-to-text logic as
// find-labeled-value.js's cellText — and that copy had the exact same
// bug (a hyperlink cell's non-string .text value was returned as-is
// instead of coerced to a string, crashing downstream .toLowerCase()
// calls elsewhere), just not yet triggered on any file that had reached
// this specific path. Reusing the single, now-fixed implementation here
// is the direct fix for the duplication problem this file's own comment
// above already warns about.
const { cellText } = require('./find-labeled-value');

function findNearbyLabel(row, colNum, maxDistance = 8) {
  for (let lc = colNum - 1; lc >= Math.max(1, colNum - maxDistance); lc--) {
    const lv = row.getCell(lc).value;
    const txt = cellText(lv);
    if (txt && isNaN(Number(txt))) return txt;
  }
  for (let lc = colNum + 1; lc <= colNum + maxDistance; lc++) {
    const lv = row.getCell(lc).value;
    const txt = cellText(lv);
    if (txt && isNaN(Number(txt))) return txt;
  }
  return '';
}

module.exports = { findNearbyLabel };
