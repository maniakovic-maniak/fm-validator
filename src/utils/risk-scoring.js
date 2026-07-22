// risk-scoring.js — P1/P2/P3 framework renewal, Tier 2 item 3.
//
// The memo's four dimensions: Decision consequence, Exposure,
// Propagation, Control weakness. Explicit caveat, honored directly in
// this design: "a numerical score must not create a P1 by itself" — P1
// eligibility is already fully determined by record_type + severity
// (Tier 1 of this renewal); this score is used ONLY to rank findings
// WITHIN their already-assigned P2/P3 tier, never to move a finding
// between tiers.
//
// Deliberately built from fields that ALREADY exist reliably on every
// finding after Tier 2 items 1-2 (root_cause_id, affected_cells,
// affected_sheets, confidence, needs_retest) rather than requiring new
// per-check instrumentation across all 26 checks a second time. Each
// dimension is scored 1-5; documented per-dimension below rather than
// left as an opaque formula.

// Reuses the same key-output vocabulary already established in
// record-type-classifier.js's Critical Query escalation logic, so a
// finding that would escalate record_type also scores high on Decision
// consequence — the two concepts are related, not independently
// invented here.
const KEY_OUTPUT_CATEGORY_HINTS = [
  'valuation', 'debt', 'liquidity', 'funding', 'covenant', 'dscr', 'dsra',
  'ownership', 'dilution', 'equity', 'tax', 'gst', 'circular', 'external',
];

function mentionsKeyOutputArea(finding) {
  const haystack = `${finding.issue_type || ''} ${finding.root_cause || ''} ${finding.category || ''}`.toLowerCase();
  return KEY_OUTPUT_CATEGORY_HINTS.some(term => haystack.includes(term));
}

/** Decision consequence: does this finding touch a key-output-adjacent
 * area (valuation, debt, tax, covenants, etc.), and does it name a
 * SPECIFIC key output (key_output_impact other than the 'Unknown'
 * default) rather than an unspecified one? */
function scoreDecisionConsequence(finding) {
  let score = 2; // baseline: a real defect, but not shown to touch a named key area
  if (mentionsKeyOutputArea(finding)) score += 2;
  const kOut = (finding.key_output_impact || '').trim();
  if (kOut && kOut.toLowerCase() !== 'unknown') score += 1;
  return Math.min(5, score);
}

/** Exposure: how likely normal/foreseeable use encounters this,
 * approximated by how many MATERIAL occurrences were actually found —
 * a single occurrence is less exposed to being hit than a widespread
 * pattern. */
function scoreExposure(finding) {
  const count = typeof finding.material_occurrence_count === 'number'
    ? finding.material_occurrence_count
    : (typeof finding.occurrence_count === 'number' ? finding.occurrence_count : 1);
  if (count >= 20) return 5;
  if (count >= 8) return 4;
  if (count >= 3) return 3;
  if (count >= 1) return 2;
  return 1;
}

/** Propagation: breadth across cells, sheets, and (where visible)
 * periods — approximated here by affected_sheets.length, matching the
 * memo's own language "across cells, periods, modules or outputs":
 * affected_sheets is the closest available proxy for "modules". */
function scorePropagation(finding) {
  const sheets = Array.isArray(finding.affected_sheets) ? finding.affected_sheets.length : 0;
  const cells = Array.isArray(finding.affected_cells) ? finding.affected_cells.length : 0;
  if (sheets >= 5) return 5;
  if (sheets >= 3) return 4;
  if (sheets === 2) return 3;
  if (sheets === 1 && cells > 1) return 2;
  return 1;
}

/** Control weakness: how likely this is to remain undetected or
 * uncontrolled in ordinary use. Two real signals already exist on every
 * finding: needs_retest (the check itself flags this as unverified
 * until fixed and re-checked) and confidence WITHIN the Confirmed-
 * Finding range (60-100) — a Confirmed Finding sitting at the lower end
 * of that range means the evidence, while sufficient to confirm, is
 * less overwhelming than a 95+ finding, which plausibly correlates with
 * how easily an ordinary reviewer would independently catch it. */
function scoreControlWeakness(finding) {
  let score = 2;
  if (finding.needs_retest === true) score += 1;
  const confidence = typeof finding.confidence === 'number' ? finding.confidence : 100;
  if (confidence < 70) score += 2;
  else if (confidence < 85) score += 1;
  return Math.min(5, score);
}

/** Weighted total — decision consequence weighted highest, matching the
 * memo's own ordering (it is listed first, and P1 eligibility already
 * depends on "materially affecting a key output or decision" language
 * specifically). Used only as a ranking key within a tier, never to
 * assign a tier. */
function computeRiskScore(finding) {
  const decisionConsequence = scoreDecisionConsequence(finding);
  const exposure = scoreExposure(finding);
  const propagation = scorePropagation(finding);
  const controlWeakness = scoreControlWeakness(finding);
  const weightedTotal = (decisionConsequence * 2) + exposure + propagation + controlWeakness;
  return { decisionConsequence, exposure, propagation, controlWeakness, weightedTotal };
}

/** Applies risk scoring across an array of findings, mutating each in
 * place. Only record_type === 'Confirmed Finding' gets scored — a
 * Query/Observation/etc. isn't ranked against confirmed defects at all,
 * consistent with Tier 1's own record_type gating. */
function assignRiskScores(findings) {
  for (const f of findings) {
    if (f.record_type !== 'Confirmed Finding') continue;
    const scores = computeRiskScore(f);
    f.risk_decision_consequence = scores.decisionConsequence;
    f.risk_exposure = scores.exposure;
    f.risk_propagation = scores.propagation;
    f.risk_control_weakness = scores.controlWeakness;
    f.risk_weighted_total = scores.weightedTotal;
  }
  return findings;
}

module.exports = {
  scoreDecisionConsequence, scoreExposure, scorePropagation, scoreControlWeakness,
  computeRiskScore, assignRiskScores,
};
