// owner-decision-checklist.js
//
// Found via an independent review (ER-010): six owner/specialist
// closure items sit as a single, semicolon-separated narrative text
// cell (Summary!O17: "OWNER DECISIONS: executed lender terms; written
// Australian tax/GST advice; independent property valuation; approved
// OpCo margin and multiple; final QS cost plan; executed shareholder
// and waterfall terms.") rather than a trackable checklist with
// accountable owners and dates. This parses that pattern into a
// structured list the report can present as an actual tracked table,
// rather than leaving it as prose a reader has to parse by hand.
//
// This is deliberately a parsing/presentation utility, not a Tier 0
// pass/fail check — there's nothing to flag as broken here, only
// information to surface more usefully.

// Matches a cell whose text begins with an "OWNER DECISIONS"-style
// label (allowing minor punctuation/casing variation), followed by a
// colon and the semicolon-separated item list.
const OWNER_DECISIONS_RE = /^\s*OWNER\s+DECISIONS?\s*:\s*(.+)$/i;

function extractOwnerDecisionItems(text) {
  if (typeof text !== 'string') return null;
  const m = OWNER_DECISIONS_RE.exec(text.trim());
  if (!m) return null;
  const itemsText = m[1].trim().replace(/\.$/, ''); // drop a single trailing period, not periods within items
  const items = itemsText.split(';').map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/** Scans a workbook for an "OWNER DECISIONS:"-style cell and returns
 * the parsed checklist, or null if none is found. Only the first
 * match is returned — this is a single, model-wide closure list, not
 * a per-sheet pattern expected to repeat. */
function findOwnerDecisionChecklist(workbook) {
  let result = null;
  workbook.eachSheet(ws => {
    if (result) return;
    ws.eachRow({ includeEmpty: false }, row => {
      if (result) return;
      row.eachCell({ includeEmpty: false }, cell => {
        if (result) return;
        const v = cell.value;
        const raw = (v && typeof v === 'object' && 'result' in v) ? v.result : v;
        const items = extractOwnerDecisionItems(raw);
        if (items) {
          result = { sheet: ws.name, cell: cell.address, items };
        }
      });
    });
  });
  return result;
}

module.exports = { findOwnerDecisionChecklist, extractOwnerDecisionItems };
