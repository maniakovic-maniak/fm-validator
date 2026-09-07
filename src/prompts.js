const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');

function readConfigFile(filename) {
  return fs.readFileSync(path.join(CONFIG_DIR, filename), 'utf8');
}

/**
 * Phase A's system prompt: Constitution + Soul + Skill, in the package's
 * own recommended load order. Deliberately does NOT include the Partner
 * Challenge Playbook here - that's Phase C's own, separate concern, and
 * including it in Phase A would pull in second-pass-specific instructions
 * (stress-testing, break-the-model lenses) that aren't relevant to a
 * first, blind independent review.
 *
 * Critically: this prompt contains nothing about fm-validator's own
 * report. The blind-review boundary (Constitution Article 2) is enforced
 * by never constructing that content here at all, not by asking the
 * model to ignore something it can see.
 */
function buildPhaseASystemPrompt() {
  const constitution = readConfigFile('AUDIT_REVIEW_CONSTITUTION.md');
  const soul = readConfigFile('SOUL.md');
  const skill = readConfigFile('SKILL.md');
  return [
    constitution,
    soul,
    skill,
    '\n---\n\nYou are now beginning Phase A: the blind independent review. ' +
    'You have NOT been given, and must not assume the existence of, any ' +
    'completed audit of this model. Review the model on its own merits, ' +
    'using the procedures and standards above. Produce your own, ' +
    'independent finding register.\n\n' +
    'You have a real web-search tool available. Use it whenever you need ' +
    'to verify a domain-specific, regulatory, or industry fact you are ' +
    'not certain of, rather than relying on your own training knowledge ' +
    'alone - this matters specifically for a specialist model type (e.g. ' +
    'a regulated-utility, mining, or other domain-specific model) where ' +
    'getting a real, current mechanism wrong would be a genuine, avoidable ' +
    'error. When you do, prefer official regulators and professional ' +
    'standards first, ahead of forums or informal sources, matching the ' +
    'research-order priority in the Playbook\'s own Mandatory Partner ' +
    'Research Phase.',
  ].join('\n\n');
}

/**
 * Phase B's system prompt: the same Constitution + Soul + Skill
 * foundation, but now explicitly told the blind phase is over and a
 * comparison is required. This is a genuinely separate prompt
 * construction from Phase A's - Phase B is never built by simply
 * appending to Phase A's own conversation, so there's no risk of stray
 * context leaking backward.
 */
function buildPhaseBSystemPrompt() {
  const constitution = readConfigFile('AUDIT_REVIEW_CONSTITUTION.md');
  const soul = readConfigFile('SOUL.md');
  const skill = readConfigFile('SKILL.md');
  return [
    constitution,
    soul,
    skill,
    '\n---\n\nYou are now beginning Phase B: reveal and compare. Your own, ' +
    'already-frozen independent findings from Phase A are provided below, ' +
    'exactly as you produced them - they are not to be revised in ' +
    'hindsight. You are also now given the completed audit to compare ' +
    'against. Follow Part D of the Skill (Phases 4-6): classify each ' +
    'completed-audit finding, classify each of your own independent ' +
    'findings against it, and identify genuine disagreements.\n\n' +
    'CRITICAL - a visibility record may be included below. If it is, it ' +
    'shows exactly which sheets and rows the completed audit\'s own ' +
    'review actually had in front of it when it was produced - not its ' +
    'conclusions, its real, actual data visibility. This is deliberately ' +
    'provided because the completed audit was not always shown every ' +
    'cell in the workbook, and you must distinguish two structurally ' +
    'different things that would otherwise look identical from your own, ' +
    'independent, full-visibility perspective:\n\n' +
    '- A GENUINE MISS: something you found that sits on a sheet/row the ' +
    'completed audit\'s visibility record shows it genuinely had access ' +
    'to. This is a real, legitimate signal about the completed audit\'s ' +
    'actual reasoning quality - it saw this and still did not catch it.\n' +
    '- A VISIBILITY GAP, not a miss: something you found that sits on a ' +
    'sheet/row absent from the visibility record entirely, or on a sheet ' +
    'that is present but at a row number not listed. The completed audit ' +
    'never had the chance to reason about this at all. Do not describe ' +
    'this as the completed audit missing something, failing to catch ' +
    'something, or any equivalent phrasing that implies a reasoning ' +
    'failure - state plainly that this finding was outside the completed ' +
    'audit\'s own data visibility for this run, and classify it ' +
    'separately from genuine misses in your own output.\n\n' +
    'If no visibility record is included below, this distinction is not ' +
    'available for this comparison - say so explicitly rather than ' +
    'silently treating every one of your own findings as a genuine miss.',
  ].join('\n\n');
}

/**
 * Phase C's system prompt: adds the Partner Challenge Playbook on top of
 * the same foundation - this is the one phase that genuinely needs it.
 */
function buildPhaseCSystemPrompt() {
  const constitution = readConfigFile('AUDIT_REVIEW_CONSTITUTION.md');
  const soul = readConfigFile('SOUL.md');
  const skill = readConfigFile('SKILL.md');
  const playbook = readConfigFile('PARTNER_CHALLENGE_PLAYBOOK.md');
  return [
    constitution,
    soul,
    skill,
    playbook,
    '\n---\n\nYou are now beginning Phase C: the mandatory Partner ' +
    'Challenge. Using a genuinely different lens from the Playbook above ' +
    '- not a repeat of Phase B\'s own procedures - stress-test Phase B\'s ' +
    'conclusions specifically.\n\n' +
    'This phase includes the Playbook\'s own Mandatory Partner Research ' +
    'Phase (Section 5): use the real web-search tool available to you to ' +
    'research current official review approaches and industry/model-' +
    'specific testing ideas, following the research-order priority in ' +
    'Section 5.1 (official standards and regulators first, forums only ' +
    'as idea generators, never as authoritative evidence). Ask ' +
    'explicitly: what would a leading specialist team test here that is ' +
    'not yet in the standard methodology?',
  ].join('\n\n');
}

module.exports = { buildPhaseASystemPrompt, buildPhaseBSystemPrompt, buildPhaseCSystemPrompt };
