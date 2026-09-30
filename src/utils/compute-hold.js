'use strict';
// Decides whether a completed run should be held from the client rather than
// sent automatically to the "ready to send" state - a pure function so it's
// testable in isolation from the rest of the pipeline.
//
// Hold rule (per Mik's decision):
//   - any FATAL-severity rule (per checklist.json) landed Uncertain -> hold
//   - 2 or more CRITICAL-severity rules landed Uncertain -> hold
//   - everything else -> ship, then flag (handled elsewhere, not here)
//
// Deliberately checks only rules actually present in ruleResults (i.e. rules
// that were run and returned a verdict) - a rule that never returned at all
// is a "not run" gap, a different problem, not this gate's job.

function buildSeverityIndex(checklist) {
  const idx = new Map();
  for (const r of [...(checklist.tier1 || []), ...(checklist.tier2 || [])]) {
    if (r && r.id) idx.set(r.id, r.severity || null);
  }
  return idx;
}

function computeHoldStatus(ruleResults, checklist) {
  const severityById = buildSeverityIndex(checklist);
  const uncertainFatal = [];
  const uncertainCritical = [];

  for (const r of ruleResults || []) {
    if (!r || r.status !== 'uncertain') continue;
    const sev = severityById.get(r.id);
    if (sev === 'fatal') uncertainFatal.push(r.id);
    else if (sev === 'critical') uncertainCritical.push(r.id);
  }

  if (uncertainFatal.length > 0) {
    return {
      held: true,
      heldReason: `${uncertainFatal.length} fatal-gate procedure(s) could not be concluded: ${uncertainFatal.join(', ')}`
    };
  }
  if (uncertainCritical.length >= 2) {
    return {
      held: true,
      heldReason: `${uncertainCritical.length} critical-severity procedures could not be concluded: ${uncertainCritical.join(', ')}`
    };
  }
  return { held: false, heldReason: null };
}

module.exports = { computeHoldStatus, buildSeverityIndex };
