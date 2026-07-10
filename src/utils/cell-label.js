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

function findNearbyLabel(row, colNum, maxDistance = 8) {
  for (let lc = colNum - 1; lc >= Math.max(1, colNum - maxDistance); lc--) {
    const lv = row.getCell(lc).value;
    const txt = lv == null ? '' : (typeof lv === 'object' ? (lv.richText ? lv.richText.map(t => t.text).join('') : (lv.text || '')) : String(lv));
    if (txt && isNaN(Number(txt))) return txt;
  }
  for (let lc = colNum + 1; lc <= colNum + maxDistance; lc++) {
    const lv = row.getCell(lc).value;
    const txt = lv == null ? '' : (typeof lv === 'object' ? (lv.richText ? lv.richText.map(t => t.text).join('') : (lv.text || '')) : String(lv));
    if (txt && isNaN(Number(txt))) return txt;
  }
  return '';
}

module.exports = { findNearbyLabel };
