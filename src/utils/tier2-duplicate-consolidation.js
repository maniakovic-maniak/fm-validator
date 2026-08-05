// tier2-duplicate-consolidation.js
//
// Found via an independent review (AR-003): at least 3 Tier 2 findings
// explicitly self-identify as duplicates of another finding — e.g.
// T2-S10-006's own text begins "Same as T2-S5-003 — equity build
// reliability cannot currently be confirmed." These inflate the
// headline finding count even though Tier 2 itself has already
// recognized them as the same underlying root cause, not a separate
// defect.
//
// This does NOT attempt fuzzy text-similarity matching to find
// duplicates Tier 2 didn't notice itself — that's a genuinely harder,
// higher-risk problem (real risk of merging two findings that only
// sound similar). This handles the much safer, well-evidenced case:
// Tier 2's own explicit self-report, which is a reliable signal
// precisely because the model itself made the connection with full
// context, not a heuristic guessing from the outside.
//
// Confirmed directly against a real report: the pattern includes a
// 2-hop chain (T2-S10-092 says "same as T2-S5-007/T2-S10-014", and
// T2-S10-014 itself says "same as T2-S5-007") — resolved transitively
// so both ultimately point to the true root, T2-S5-007, rather than
// T2-S10-092 pointing at T2-S10-014 which then still counts as its
// own separate finding.

// Anchored to the START of the text (not a substring search anywhere)
// — confirmed directly necessary: a substring search matches "for the
// same asset diverge" (ordinary prose, not a duplicate reference) as
// a false positive, since "same as" is incidentally a substring of
// "same asset".
const SAME_AS_RE = /^same as\s+(T2-[A-Za-z0-9-]+)(?:\s*[\/,]\s*(T2-[A-Za-z0-9-]+))*/i;
const ALL_REFS_RE = /T2-[A-Za-z0-9-]+/g;

// Extracts every referenced finding ID from a "Same as ..." match,
// handling one or more comma/slash-separated IDs in the same sentence.
function extractSameAsRefs(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!SAME_AS_RE.test(trimmed)) return null;
  const prefix = trimmed.match(/^same as\s+[^.—]*/i);
  if (!prefix) return null;
  const refs = prefix[0].match(ALL_REFS_RE);
  return refs && refs.length > 0 ? refs : null;
}

// Follows a "same as" chain to its true root — the first finding in
// the chain that does NOT itself self-identify as a duplicate of
// something else. Caps at 10 hops as a safety net against a
// malformed or circular chain, which should never genuinely occur but
// must not hang or loop forever if it somehow did.
function resolveRoot(findingId, sameAsMap, depth = 0) {
  if (depth > 10) return findingId; // safety net against a malformed/circular chain
  const refs = sameAsMap.get(findingId);
  if (!refs || refs.length === 0) return findingId;
  return resolveRoot(refs[0], sameAsMap, depth + 1);
}

/** Consolidates Tier 2 findings that explicitly self-identify as
 * duplicates of another finding. Returns { consolidated, removed }
 * where consolidated is the filtered findings array (duplicates
 * removed, their evidence merged into the root finding's own text as
 * a visible cross-reference note) and removed is the list of
 * findings that were folded in, for logging/transparency. */
function consolidateTier2Duplicates(findings) {
  const sameAsMap = new Map(); // findingId -> [referencedIds]
  const byId = new Map();

  for (const f of findings) {
    if (!f.id) continue;
    byId.set(f.id, f);
    const textFields = [f.reason, f.condition, f.corrective_action, f.label].filter(Boolean);
    for (const text of textFields) {
      const refs = extractSameAsRefs(text);
      if (refs) { sameAsMap.set(f.id, refs); break; }
    }
  }

  const removed = [];
  const consolidated = [];
  const rootNotes = new Map(); // rootId -> [noteText, ...] to append

  for (const f of findings) {
    if (!f.id || !sameAsMap.has(f.id)) { consolidated.push(f); continue; }

    const root = resolveRoot(f.id, sameAsMap);
    if (root === f.id || !byId.has(root)) {
      // Points at itself, or the referenced finding doesn't actually
      // exist in this run's findings (e.g. a rule that didn't fire
      // this time) — can't safely consolidate; keep it standalone
      // rather than silently dropping real information.
      consolidated.push(f);
      continue;
    }

    removed.push({ id: f.id, rootId: root, reason: f.reason || f.condition || '' });
    if (!rootNotes.has(root)) rootNotes.set(root, []);
    rootNotes.get(root).push(f.id);
  }

  // Append a visible cross-reference note to each root finding that
  // absorbed at least one duplicate, so the consolidation is
  // transparent in the report rather than silently reducing the count.
  for (const f of consolidated) {
    if (!f.id || !rootNotes.has(f.id)) continue;
    const mergedIds = rootNotes.get(f.id);
    const note = ` (This root cause was also independently identified as ${mergedIds.join(', ')} — consolidated here as one finding, not counted separately.)`;
    f.condition = (f.condition || '') + note;
  }

  return { consolidated, removed };
}

module.exports = { consolidateTier2Duplicates, extractSameAsRefs, resolveRoot };
