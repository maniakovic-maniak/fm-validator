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
// FIX: found via direct testing after the gap-analysis rule additions
// — "terminal value" (a genuine key-output/valuation concern, named
// explicitly in both the source gap-analysis review and the finding's
// own text) didn't match any existing hint term, since "valuation"
// doesn't match "value" as a substring. This silently gave a terminal
// value finding weaker Query treatment than an equally material
// revenue finding that happened to contain the word "revenue" — not a
// deliberate materiality judgment, just an accidental keyword miss.
// Added the specific phrase "terminal value" rather than the bare word
// "value", which would be too broad and catch unrelated mentions.
const { isAbsenceFinding } = require('./rule-exclusions');

const KEY_OUTPUT_CATEGORY_HINTS = [
  'valuation', 'terminal value', 'debt', 'interest', 'liquidity', 'funding', 'covenant', 'dscr', 'dsra',
  'ownership', 'dilution', 'equity', 'tax', 'gst', 'circular', 'external',
  'return', 'irr', 'investor',
  'financial statement', 'balance sheet', 'income statement', 'cash flow statement',
  'revenue', 'balancing', 'plug',
];

function mentionsKeyOutputArea(finding) {
  const haystack = `${finding.issue_type || ''} ${finding.root_cause || ''} ${finding.category || ''}`.toLowerCase();
  return KEY_OUTPUT_CATEGORY_HINTS.some(term => haystack.includes(term));
}

// Patch 12: a missing confidence is unknown, not 100. Tier 2 stores a missing confidence as 0 already. The one place
// a missing value reached this file was Tier 1 (code checks that report no confidence). A Tier 1 check that reads a fact
// straight off the file (a hidden row, a sheet name, an external link, a circular reference, a calc setting) is exact.
// A Tier 1 check that decides by matching sheet or row NAMES (is there a sheet called Timing or Flags; is there a
// negative closing cash row) can be wrong about a model that names things differently, so it is held at 65: below the
// 80 a fatal/critical finding needs to be a P1, so it becomes a Critical Query, which still blocks reliance.
// Anything else with no confidence is unknown and is never confirmed on that basis.
const TIER1_NAME_MATCHING = new Set(['T1-002', 'T1-004', 'T1-005', 'T1-006', 'T1-008', 'T1-009', 'T1-012']);
const TIER1_ASSUMED_NAME_MATCH = 65;
function resolveConfidence(finding) {
  if (typeof finding.confidence === 'number' && !Number.isNaN(finding.confidence)) return { confidence: finding.confidence, basis: null };
  const id = String(finding.id || '');
  const t1 = /^(T1-\d+)/.exec(id);
  if (t1) return TIER1_NAME_MATCHING.has(t1[1])
    ? { confidence: TIER1_ASSUMED_NAME_MATCH, basis: 'check-type: matches names' }
    : { confidence: 100, basis: 'check-type: exact file fact' };
  return { confidence: 0, basis: 'unknown' };
}

/** Classifies a single finding, returning its record_type. Respects an
 * already-set, explicit record_type unconditionally — this function
 * only fills in a default when a check hasn't opted to set one itself. */
// Screening checks flag a pattern, not a defect: the formula differs from its neighbours, a link passes through
// another cell, a formula is long. Whether any of them is wrong needs a person to look at the cells. An independent
// review of a licence model showed these stood as P2 Confirmed Findings although none was a demonstrated error
// (the pattern changes at a period or scenario boundary on purpose; label columns were compared with number
// columns). They stay in the report, with their samples, as a Query (a candidate to examine) or an Observation
// (a maintainability note); a check that sets its own record_type is still respected.
const SCREENING_RECORD_TYPES = [
  ['T0-FMLPATTERN', 'Query'], ['T0-COLPATTERN', 'Query'], ['T0-REGIMECHANGE', 'Query'],
  ['T0-MIXEDREF', 'Observation'], ['T0-DAISYCHAIN', 'Observation'], ['T0-NESTEDIF', 'Observation'],
  ['T0-COMPLEXFML', 'Observation'], ['T0-HIDDEN-002', 'Observation'], ['T0-LINK-002', 'Observation'],
];

function screeningRecordType(id) {
  const s = String(id || '');
  for (const [prefix, type] of SCREENING_RECORD_TYPES) {
    if (s === prefix || s.startsWith(prefix + '-') || s.startsWith(prefix + ' ')) return type;
  }
  return null;
}


// A reviewer answer of the form "No X was found anywhere in the workbook" at low confidence and with no cell to point
// at (the A1 fallback) is a scope note about a procedure that may not apply to this model, not a defect. An ESO run
// raised eleven of these (bid transition, termination valuation, ESCO contract, ...) as Queries and Critical Queries,
// which blocked reliance on nothing. They stay visible as Observations; a check that sets its own record_type, or an
// absence with real confidence (40+), is not touched.
function isAbsenceText(f) {
  const text = [f.condition, f.what_wrong, f.finding, f.issue].map(x => String(x || '')).find(x => x.trim()) || '';
  const t = text.replace(/^\s*not present in the workbook:\s*/i, '');
  return isAbsenceFinding(t);
}

function isWorkbookWideAbsence(f) {
  if (!/^T2-/.test(String(f.id || ''))) return false;
  const cell = String(f.cell || '').trim().toUpperCase();
  if (cell && cell !== 'A1') return false;
  return isAbsenceText(f);
}

function isLowConfidenceWorkbookWideAbsence(f) {
  if (typeof f.confidence !== 'number' || f.confidence >= 40) return false;
  return isWorkbookWideAbsence(f);
}

function classifyRecordType(finding) {
  if (finding.record_type) return finding.record_type;
  const screening = screeningRecordType(finding.id);
  if (screening) return screening;
  if (isLowConfidenceWorkbookWideAbsence(finding)) return 'Observation';

  const { confidence, basis } = resolveConfidence(finding);
  if (basis) finding.confidence_basis = basis;
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
  // Unknown confidence on a fatal or critical finding: serious if true, unproven. It blocks reliance as a Critical Query.
  if (basis === 'unknown' && (severity === 'fatal' || severity === 'critical')) return 'Critical Query';

  if (confidence < 60) {
    // A disclosure-type absence ("no deferred tax line", "no change log") on a medium or low severity rule is a
    // question about documentation, not a possible misstatement of a key output. An ESO run raised "no deferred tax
    // line" at 45% confidence as the report's only Critical Query purely because the word "tax" is in the key-output
    // list. Fatal, critical and high severity rules keep the escalation.
    // The reviewer sometimes anchors an absence to a nearby cell (T2-S5-008 named SystemOperator!AP658 in Fm-00046),
    // so this does not require the A1 fallback that the Observation rule above does.
    if (/^T2-/.test(String(finding.id || '')) && isAbsenceText(finding) && (severity === 'medium' || severity === 'low')) return 'Query';
    // Patch 18: a documentation register that could not be found (adjustments log, overlay register, change log) is an
    // information request, whatever the rule's severity and wherever the reviewer anchored it. Missing paperwork cannot
    // misstate a key output on its own. In Fm-00047 two such results were Observations; in Fm-00049 the reviewer anchored
    // them to a SystemOperator cell, escaped the A1 rule above and became Critical Queries that blocked reliance.
    // Fatal rules keep the escalation.
    if (/^T2-/.test(String(finding.id || '')) && severity !== 'fatal' &&
        /documentation/i.test(`${finding.category || ''} ${finding.issue_type || ''}`)) return 'Query';
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

/**
 * Critical Queries about the same cell are grouped for display, never demoted. Patch 34 turned the weaker one into a
 * Query so the report counted one open matter; Patch 38 reverses that, because two different rules raising a concern at
 * one cell can be two different concerns (a review of Patch 37 pointed this out) and a concern must keep its blocking
 * status until it is answered on its own evidence. Every record stays a Critical Query. Each carries
 * `same_location_group` (sheet!cell) and the weaker ones also `grouped_with` (the strongest record's id); the report
 * counts blocking records as before and adds how many locations they cover.
 * Runs after assignRecordTypes. Only findings anchored to a real cell (not A1 or blank) are grouped.
 */
function mergeDuplicateCriticalQueries(findings) {
  const by = new Map();
  for (const f of findings) {
    if (!f || f.record_type !== 'Critical Query') continue;
    const cell = String(f.cell || '').trim().toUpperCase();
    if (!f.sheet || !cell || cell === 'A1') continue;
    const k = `${f.sheet}!${cell}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(f);
  }
  const grouped = [];
  for (const [k, group] of by.entries()) {
    if (group.length < 2) continue;
    group.sort((a, b) => (b.confidence || 0) - (a.confidence || 0) || String(a.id).localeCompare(String(b.id)));
    const keep = group[0];
    for (const f of group) f.same_location_group = k;
    for (const dup of group.slice(1)) {
      if (dup.grouped_with === keep.id) continue;          // already grouped by an earlier call
      dup.grouped_with = keep.id;
      dup.record_type_note = `${dup.record_type_note ? dup.record_type_note + ' ' : ''}Same cell as Critical Query ${keep.id}; shown as one location, still blocking.`;
      grouped.push({ id: dup.id, into: keep.id, cell: k });
    }
  }
  return grouped;
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

module.exports = { classifyRecordType, assignRecordTypes, mergeDuplicateCriticalQueries, screeningRecordType, resolveConfidence };
