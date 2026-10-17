/**
 * Absence policy, enforced in code.
 *
 * config/skill.md (Step 5b) tells the reviewer: when it was given the whole workbook and a required schedule,
 * reconciliation or control is not there, that absence is the finding ("Not present in the workbook:", fail),
 * not "uncertain". The reviewer follows that unevenly: on the Fm-00036 run it returned "uncertain" for dozens of
 * plain absences (no receivables rows, no deferred tax line, no change log) at confidence 0.5-0.65.
 *
 * So the instruction is backed by a check here. After the reviewer answers, an "uncertain" result is recorded as a
 * confirmed absence only when ALL of these hold:
 *   - the reviewer was given the complete workbook (one data chunk, full parse), so there was nothing hidden to find;
 *   - the finding itself is an absence statement ("No X was found in any sheet");
 *   - it is not a statement about the reviewer's own limits (formula-only extract, no formatting, could not confirm);
 *   - it is not the reviewer saying the structure does not belong in this kind of model (that is "not applicable",
 *     which stays uncertain and feeds the scope candidates in Improvement Signals).
 * Anything else is left exactly as the reviewer returned it.
 */
const { isAbsenceFinding } = require('./rule-exclusions');

// The reviewer talking about what it could or could not see, not about what the workbook contains.
const LIMITATION_RE = /(confirmed or ruled out|ruled out|could not|cannot|can't|unable|not possible|formula-only|extract(ion)?\b|not performed|was performed|were performed|formatting|colou?r|truncated|trimmed|subset|not visible|not shown|not provided|not available to)/i;
// The reviewer saying the structure does not belong in this kind of model.
const NOT_APPLICABLE_RE = /(not applicable|n\/a|does not (produce|apply|belong|have a|require)|do not (apply|require)|by design|not expected|not designed|not required|model type|not part of (this|the) model|outside (the )?scope|or expected|expected in this|would not be expected|no .{0,40} concept exists|not a (class|feature|component))/i;

// The finding must OPEN with the absence. A sentence that starts with a cell reference and has "no visible ..."
// somewhere in the middle is a substantive observation, not a missing-schedule finding.
const STRICT_START_RE = /^\s*(there (is|are) no |no |none of |(the )?(sheet list|workbook|model) (has|contains|includes) no )/i;

const PREFIX = 'Not present in the workbook: ';

function textOf(r) {
  return [r.condition, r.reason, r.what_wrong, r.finding].map(x => String(x || '')).find(s => s.trim()) || '';
}
function contextOf(r) {
  return [r.condition, r.reason, r.root_cause, r.cause, r.consequence].map(x => String(x || '')).join(' ');
}

function isConfirmedAbsence(r) {
  if (!r || r.status !== 'uncertain') return false;
  const text = textOf(r);
  if (!STRICT_START_RE.test(text) || !isAbsenceFinding(text)) return false;
  if (/^\s*not present in the workbook/i.test(text)) return false;
  if (LIMITATION_RE.test(text)) return false;
  if (NOT_APPLICABLE_RE.test(contextOf(r))) return false;
  return true;
}

// Priority for a finding that rests on absence alone (no wrong number was seen). The reviewer's own P1-P3 is kept;
// "Query" style or missing priorities become P3, or P2 where the rule is critical or fatal.
function priorityFor(r, rule) {
  if (/^P[123]$/.test(String(r.priority || ''))) return r.priority;
  const sev = String((rule && rule.severity) || r.severity || '').toLowerCase();
  return sev === 'fatal' || sev === 'critical' ? 'P2' : 'P3';
}

/**
 * @param results   normalised Tier 2 results (mutated in place)
 * @param opts.complete   true only when every batch saw the whole workbook in one data chunk
 * @param opts.ruleById   Map of rule id -> checklist rule (for severity)
 * @returns {{applied:boolean, converted:string[]}}
 */
function applyAbsencePolicy(results, { complete = false, ruleById = new Map() } = {}) {
  if (!complete) return { applied: false, converted: [] };
  const converted = [];
  for (const r of results) {
    if (!isConfirmedAbsence(r)) continue;
    const rule = ruleById.get(r.id);
    const text = textOf(r);
    r.status = 'fail';
    r.condition = PREFIX + text.replace(/^\s*(there (is|are) )?/i, '').replace(/^./, c => c.toLowerCase());
    r.confidence = Math.max(Number(r.confidence) || 0, 0.7);
    r.priority = priorityFor(r, rule);
    r.method = r.method && r.method !== 'automated' ? r.method : 'formula_text_review';
    r._absenceConverted = true;
    converted.push(r.id);
  }
  return { applied: true, converted };
}

module.exports = { applyAbsencePolicy, isConfirmedAbsence, PREFIX };
