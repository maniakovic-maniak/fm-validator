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

// FIX: found via a genuine production discovery on a newer model
// version. Two real gaps, confirmed directly against
// Summary!O17: "OWNER DECISIONS — 6/6 OPEN: executed lender terms;
// ...; executed shareholder and waterfall terms. Controlled closure
// register: DATA MAP!A524:H533."
// (1) the label can carry a status annotation between "OWNER
// DECISIONS" and the colon (here, "— 6/6 OPEN") — the original
// pattern required the colon immediately after "DECISIONS", so this
// entire cell was silently missed.
// (2) a trailing sentence can follow the semicolon-separated item
// list itself (here, "Controlled closure register: ...") — the
// original "strip one trailing period" logic only handled a period
// at the very end of the string, so this trailing sentence would
// have been swallowed into the last item's text.
// Matches an "OWNER DECISIONS"-style label, optionally followed by a
// "— <status text>" segment, then a colon and the item list.
const OWNER_DECISIONS_RE = /^\s*OWNER\s+DECISIONS?\s*(?:[\u2014\u2013-]\s*[^:]*)?\s*:\s*(.+)$/i;

function extractOwnerDecisionItems(text) {
  if (typeof text !== 'string') return null;
  const m = OWNER_DECISIONS_RE.exec(text.trim());
  if (!m) return null;
  // Stop at the first sentence-ending period (one followed by
  // whitespace-then-a-capital-letter, or the end of the string) —
  // this is the boundary between the genuine item list and any
  // trailing sentence that follows it, not just "the last period".
  const listMatch = /^([\s\S]+?)(?:\.\s+[A-Z]|\.\s*$)/.exec(m[1].trim());
  const itemsText = listMatch ? listMatch[1].trim() : m[1].trim().replace(/\.$/, '');
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
