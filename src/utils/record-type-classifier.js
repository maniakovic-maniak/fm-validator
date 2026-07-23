// record-type-classifier.js — Tier 1 of the P1/P2/P3 framework renewal.
//
// The memo's core principle: priority (P1/P2/P3) answers "how severe."
// record_type answers a prior, different question: "what kind of
// statement is this at all." Only record_type === 'Confirmed Finding'
// is eligible for a P-priority at all — everything else stays visible
// in the report but outside the P1-P3 hierarchy.
//
// DESIGN DECISION: rather than manually editing every one of the 50+
// individual allFlagged.push({...}) blocks across index.js/server.js —
// tedious, error-prone, and hard to keep consistent — this applies a
// SINGLE classification pass over the whole findings array, once, right
// before the report is built. A check that already sets its own
// record_type explicitly is respected unconditionally; everything else
// gets a default inferred from fields that already exist on every
// finding (confidence, severity, urgency) — no schema change needed on
// the individual check side at all.
//
// The inference rule mirrors the same guidance now written into
// soul.md's "Record Type Classification" section, so Tier 0 (this file)
// and Tier 2 (Claude, via soul.md) apply the same logic even though one
// is deterministic code and the other is semantic judgement.

// P1/P2/P3 framework renewal, Tier 2 item 4: cross-checked directly
// against the memo's own explicit P1 category list ("valuation; debt
// and interest; liquidity or funding requirements; ownership and
// dilution; investor returns; tax and GST; financial statements;
// covenants; uncontrolled circularities; critical external
// dependencies") — two categories were completely missing here:
// "investor returns" and "financial statements". Confirmed via real
// testing before this fix that both were silently under-escalating
// real checks: a balance-sheet plug finding (T0-BSPLUG) and a revenue
// double-counting finding (T0-REVDOUBLE) both classified as an
// ordinary Query rather than a Critical Query, despite touching
// exactly the "financial statements" category the memo names.
const KEY_OUTPUT_CATEGORY_HINTS = [
  'valuation', 'debt', 'interest', 'liquidity', 'funding', 'covenant', 'dscr', 'dsra',
  'ownership', 'dilution', 'equity', 'tax', 'gst', 'circular', 'external',
  'return', 'irr', 'investor',
  'financial statement', 'balance sheet', 'income statement', 'cash flow statement',
  'revenue', 'balancing', 'plug',
];

function mentionsKeyOutputArea(finding) {
  const haystack = `${finding.issue_type || ''} ${finding.root_cause || ''} ${finding.category || ''}`.toLowerCase();
  return KEY_OUTPUT_CATEGORY_HINTS.some(term => haystack.includes(term));
}

/** Classifies a single finding, returning its record_type. Respects an
 * already-set, explicit record_type unconditionally — this function
 * only fills in a default when a check hasn't opted to set one itself. */
function classifyRecordType(finding) {
  if (finding.record_type) return finding.record_type;

  const confidence = typeof finding.confidence === 'number' ? finding.confidence : 100;
  const urgency = (finding.urgency || '').toLowerCase();
  const severity = (finding.severity || '').toLowerCase();

  // A check that already labelled itself purely informational (the
  // convention established earlier this session for complexity-type
  // indicators — complex-formula, data-validation coverage, etc.) maps
  // directly to Observation, matching the memo's explicit instruction
  // that complexity measures should drive review attention, not
  // priority, unless testing establishes an actual defect.
  if (urgency === 'informational') return 'Observation';

  // Low confidence generally means "not yet confirmed" — a Query. But a
  // low-confidence result that also touches a key-output-adjacent area
  // (valuation, debt, covenants, ownership, tax) must not quietly
  // demote to an ordinary Query — per the memo, this stays a Critical
  // Query specifically because it COULD be material even though nothing
  // is confirmed yet.
  if (confidence < 60) {
    return mentionsKeyOutputArea(finding) ? 'Critical Query' : 'Query';
  }

  // ── P1/P2/P3 framework renewal, Tier 3 ─────────────────────────────
  // The memo's evidence-quality principle, applied to the P1 tier
  // specifically: "a potentially serious matter supported by
  // insufficient evidence should normally remain a Critical Query
  // until confirmed." A fatal/critical-severity finding whose
  // confidence sits at 60-79 — "persuasive but incomplete evidence"
  // per soul.md's own Confidence Scoring Guide — must not become a
  // P1-eligible Confirmed Finding on that evidence; it demotes to
  // Critical Query, which still blocks reliance with the same force
  // as a P1 (Tier 1 item 3's gate), but honestly represents the
  // matter as unconfirmed rather than established. Only 80+ ("strong
  // direct evidence") supports the P1 tier. Deliberately scoped to
  // fatal/critical ONLY: a high/medium-severity finding at 60-79 still
  // becomes an ordinary P2 Confirmed Finding — the memo's principle is
  // specifically about SERIOUS matters needing stronger evidence, not
  // about raising the bar for every finding.
  if ((severity === 'fatal' || severity === 'critical') && confidence < 80) {
    return 'Critical Query';
  }

  // Confidence 60+ with a real severity assigned is treated as a
  // Confirmed Finding — matching how these checks have been built and
  // tested all session (a real synthetic + real-file verification
  // precedes every one of them before shipping).
  if (severity === 'fatal' || severity === 'critical' || severity === 'high' ||
      severity === 'medium' || severity === 'low') {
    return 'Confirmed Finding';
  }

  // No severity at all and reasonable confidence — default to
  // Observation rather than silently assuming Confirmed Finding for an
  // unclassified shape.
  return 'Observation';
}

/** Applies classifyRecordType across an array of findings, mutating
 * each in place (adds record_type if absent) and returning the same
 * array for convenience. */
function assignRecordTypes(findings) {
  for (const f of findings) {
    f.record_type = classifyRecordType(f);
  }
  return findings;
}

module.exports = { classifyRecordType, assignRecordTypes };
