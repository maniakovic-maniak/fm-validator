// domain-synthesiser.js — Phase D, revived with skill-creator's methodology.
//
// Generates a DRAFT domain skill file for a model type with no existing
// skill-{type}.md — e.g. skill-property.md, triggered the first time a
// property/development model (like The Bend) is classified with no home
// to fall back to besides skill-generic.md.
//
// Deliberately NOT one-shot generation from a bare prompt. Following
// skill-creator's own documented methodology (gather concrete examples
// first, draft, test, refine — not write-once-and-ship):
//   1. The concrete example is the ACTUAL triggering model's own real
//      structure (sheet names) and Familiarisation summary — the file
//      that revealed this domain has no skill yet is itself the best
//      available grounding data, not a generic description of the industry.
//   2. The draft is structurally anchored to an existing, hand-built
//      domain skill (skill-mining.md) as a format example, so the output
//      matches this project's established conventions rather than
//      whatever shape the model happens to produce unprompted.
//   3. Where skill-generic.md's own "Model type weighting rules" section
//      already names expected focus areas for this domain (e.g. "Real
//      estate / development models: GDV reconciliation, development
//      margin calculation, GST treatment, settlement timing, contingency
//      adequacy, lifecycle phases"), the draft is explicitly told to
//      cover those — a prior decision already made in this codebase,
//      not something to reinvent.
//   4. The draft is saved to config/domains/skill-{type}.draft.md — a
//      DISTINCT location from the live config/skill-{type}.md — so it
//      requires an explicit human review step (see eval-domain-skill.js
//      and the planned tools/review-domains.js) before it can ever be
//      loaded by the live classifier/skill-loading path. This function
//      never writes to the live config/ location.

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();

const SYNTHESISER_PROMPT = `You are drafting a new domain-specific context file for a financial
model audit tool. This file will be loaded alongside a universal review
methodology (skill.md) whenever a model of this specific type is
reviewed, giving the reviewer industry context it wouldn't otherwise have.

You will be given:
- The target model type
- A real Familiarisation summary of the actual model that triggered
  this domain having no skill file yet — this is your primary grounding
  evidence, not a generic description of the industry
- The real sheet names from that model
- An existing, hand-built domain skill file (for a different industry)
  to use as a STRUCTURAL example only — match its section structure and
  level of specificity, not its industry content
- Where available, a short "expected focus areas" note derived from this
  project's own prior model-type weighting decisions — your draft must
  explicitly cover every area named there

Write the new domain skill file following the exact section structure of
the structural example: Model type, Project/model characteristics, Sheet
map (a table mapping common sheet names to their likely contents for
this industry), Typical ranges (explicitly disclosed as context only, not
pass/fail thresholds — this project never treats a benchmark as ground
truth), Common failure patterns specific to this domain (5-8 patterns,
each a real, specific, checkable mechanism — not generic advice),
Dependency chain (a plain-text arrow diagram tracing how this industry's
inputs flow through to outputs).

Ground every specific claim in what a real model of this type would
actually contain, informed by the real sheet names and summary you were
given — do not write generic industry filler. If you are not confident
about a specific numeric range or benchmark, omit it rather than
inventing a plausible-sounding number.

Output ONLY the markdown content of the new skill file — no preamble, no
commentary, no code fences.`;

/**
 * Extract skill-generic.md's own "Model type weighting rules" entry for a
 * given domain, if one already exists — e.g. the "Real estate /
 * development models" bullet naming GDV reconciliation, development
 * margin, GST treatment, settlement timing, contingency adequacy,
 * lifecycle phases as the expected focus areas. Returns null if no
 * matching entry exists, in which case the draft proceeds without this
 * guidance rather than failing.
 */
function extractWeightingGuidance(genericSkillContent, domainLabel) {
  // Matches a bold heading line (the domain label) followed by its
  // "Higher weight on: ..." sentence, stopping at the next blank line.
  const re = new RegExp(
    `\\*\\*[^*]*${domainLabel}[^*]*\\*\\*\\s*\\n(Higher weight on:[^\\n]*(?:\\n[^\\n*][^\\n]*)*)`,
    'i'
  );
  const m = re.exec(genericSkillContent);
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

/**
 * Draft a new domain skill file. Never writes to the live config/
 * location — always saves to config/domains/skill-{type}.draft.md,
 * requiring an explicit review step before it can go live.
 *
 * @param {string} modelType - e.g. 'property', 'saas', 'infrastructure'
 * @param {object} modelSummary - the real Familiarisation summary that
 *   triggered this domain being unrecognised (model_purpose, industry,
 *   currency, periodicity, immediate_observations, etc.)
 * @param {string[]} sheetNames - the real sheet names from that model
 * @param {object} [options]
 * @param {string} [options.configDir] - override for testing; defaults to ../config relative to this file
 * @param {string} [options.structuralExampleDomain] - which existing skill file to use as the structural example; defaults to 'mining'
 * @param {string} [options.weightingDomainLabel] - the label to search for in skill-generic.md's weighting rules (e.g. 'Real estate')
 */
async function draftDomainSkill(modelType, modelSummary, sheetNames, options = {}) {
  const configDir = options.configDir || path.join(__dirname, '..', 'config');
  const structuralExampleDomain = options.structuralExampleDomain || 'mining';

  const structuralExample = fs.readFileSync(
    path.join(configDir, `skill-${structuralExampleDomain}.md`), 'utf8'
  );
  const genericSkill = fs.readFileSync(path.join(configDir, 'skill-generic.md'), 'utf8');

  let weightingGuidance = null;
  if (options.weightingDomainLabel) {
    weightingGuidance = extractWeightingGuidance(genericSkill, options.weightingDomainLabel);
  }

  const payload = {
    target_model_type: modelType,
    real_model_summary: modelSummary,
    real_sheet_names: sheetNames,
    structural_example_domain: structuralExampleDomain,
    structural_example_content: structuralExample,
    expected_focus_areas: weightingGuidance,
  };

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 16000,
    system: SYNTHESISER_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });

  const draftContent = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const draftsDir = path.join(configDir, 'domains');
  if (!fs.existsSync(draftsDir)) fs.mkdirSync(draftsDir, { recursive: true });
  const draftPath = path.join(draftsDir, `skill-${modelType}.draft.md`);
  fs.writeFileSync(draftPath, draftContent);

  console.log(`   Draft domain skill written: ${draftPath} (${draftContent.length} chars) — NOT live, requires review before use.`);

  return { draftPath, draftContent, weightingGuidanceUsed: weightingGuidance };
}

module.exports = { draftDomainSkill, extractWeightingGuidance };
