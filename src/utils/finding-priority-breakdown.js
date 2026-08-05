// finding-priority-breakdown.js
//
// Found via an independent review (AR-001): the headline "N items
// flagged" console message and report title blend confirmed defects
// (P1/P2/P3/Critical Query — items that are, or need to be resolved
// as, genuine findings) with open questions (Query/Observation — the
// audit couldn't confirm one way or the other, or is simply noting
// something, not asserting a defect exists). Confirmed directly on a
// real report: of 227 total, 136 are confirmed/blocking (5 P1 + 101
// P2 + 4 P3 + 26 Critical Query) and 91 are open questions (88 Query
// + 3 Observation) — a reader scanning "227 items flagged" has no way
// to tell these apart without opening the Issue Log itself.
//
// Deliberately replicates build_report.py's own priority()
// classification exactly, rather than inventing a separate one — the
// console headline and the report itself must never disagree about
// what counts as what.

function classifyPriority(f) {
  const recordType = f.record_type || 'Confirmed Finding';
  if (recordType !== 'Confirmed Finding') return recordType;
  const sev = (f.severity || '').toLowerCase();
  if (sev === 'fatal' || sev === 'critical') return 'P1';
  if (sev === 'high' || sev === 'medium') return 'P2';
  return 'P3';
}

// Categories treated as confirmed, actionable findings — a P1/P2/P3
// classification or a Critical Query (already treated as equally
// reliance-blocking as a P1 elsewhere in this codebase, per I-1).
const CONFIRMED_CATEGORIES = new Set(['P1', 'P2', 'P3', 'Critical Query']);

/** Returns { total, confirmedCount, openQuestionCount, byCategory }
 * for a findings array — the breakdown the console headline and
 * report title should show, rather than one blended total. */
function computeFindingBreakdown(findings) {
  const byCategory = {};
  let confirmedCount = 0;
  let openQuestionCount = 0;

  for (const f of findings) {
    const cat = classifyPriority(f);
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    if (CONFIRMED_CATEGORIES.has(cat)) confirmedCount++;
    else openQuestionCount++;
  }

  return { total: findings.length, confirmedCount, openQuestionCount, byCategory };
}

/** Formats the breakdown as a single, human-readable line for console
 * output — e.g. "227 total (136 confirmed: 5 P1, 101 P2, 4 P3, 26
 * Critical Query; 91 open question(s): 88 Query, 3 Observation)". */
function formatBreakdownLine(breakdown) {
  const { total, confirmedCount, openQuestionCount, byCategory } = breakdown;
  if (openQuestionCount === 0) {
    // Nothing to distinguish — a plain total is not misleading here,
    // so don't add noise for the common case where every finding is
    // already a confirmed category.
    return `${total} item(s) flagged`;
  }
  const confirmedOrder = ['P1', 'P2', 'P3', 'Critical Query'];
  const confirmedParts = confirmedOrder.filter(c => byCategory[c]).map(c => `${byCategory[c]} ${c}`);
  const openParts = Object.keys(byCategory)
    .filter(c => !CONFIRMED_CATEGORIES.has(c))
    .map(c => `${byCategory[c]} ${c}`);
  return `${total} item(s) flagged \u2014 ${confirmedCount} confirmed (${confirmedParts.join(', ')}), ${openQuestionCount} open question(s) not yet confirmed as defects (${openParts.join(', ')})`;
}

module.exports = { classifyPriority, computeFindingBreakdown, formatBreakdownLine, CONFIRMED_CATEGORIES };
