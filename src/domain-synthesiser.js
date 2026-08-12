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

/**
 * Scans checklist.json for the highest T2-S10-XXX rule number currently
 * in use and returns a safe starting point for a new domain's graded
 * tests — avoiding the exact collision risk that would exist if a future
 * draft's LLM-generated numbering happened to overlap with an existing
 * domain's range (mining: 097-179, property: 201-284, confirmed
 * collision-free with each other only because both were checked
 * manually before this function existed).
 *
 * @param {string} configDir
 * @returns {number} the first safe rule number to start a new block at
 */
function getNextAvailableRuleNumber(configDir) {
  const checklistPath = path.join(configDir, 'checklist.json');
  const checklist = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));
  const usedNumbers = checklist.tier2
    .map(r => r.id)
    .filter(id => id.startsWith('T2-S10-'))
    .map(id => parseInt(id.split('-').pop(), 10))
    .filter(n => Number.isFinite(n));
  const maxUsed = usedNumbers.length > 0 ? Math.max(...usedNumbers) : 0;
  return maxUsed + 10; // small buffer, not a tight boundary
}

/**
 * Extracts every "### T2-S10-NNN — test: name\n<description>" block from
 * a draft's content and builds the exact checklist.json entry shape
 * used for the mining and property integrations this session — same
 * schema, same first-sentence-as-label derivation, same
 * fix_instruction-from-description pattern. Returns an empty array if
 * the draft has no graded-test sections at all (a genuinely valid case
 * for a smaller/simpler domain, not an error).
 *
 * @param {string} draftContent
 * @param {string} sourceFileName - e.g. 'skill-corporate.md', used as
 *   this session's own established source_id convention
 * @returns {Array<object>} checklist.json-shaped rule entries
 */
function extractGradedTestsAsChecklistEntries(draftContent, sourceFileName) {
  const pattern = /^### (T2-S10-\d+) — test: (\w+)\n([\s\S]*?)(?=\n### |\Z|$(?![\s\S]))/gm;
  const matches = [...draftContent.matchAll(pattern)];

  function firstSentence(text) {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    const m = collapsed.match(/^(.*?[.!?])\s/);
    return (m ? m[1] : collapsed.slice(0, 200)).trim();
  }

  return matches.map(([, ruleId, testName, description]) => {
    const num = parseInt(ruleId.split('-').pop(), 10);
    const descClean = description.replace(/\s+/g, ' ').trim();
    let label = firstSentence(descClean);
    if (label.length > 220) label = label.slice(0, 217).trimEnd() + '...';
    return {
      id: ruleId,
      section: `10.${num}`,
      label,
      source_id: sourceFileName,
      source_section: `Domain-specific graded tests — ${testName}`,
      test: testName,
      severity: 'medium',
      manual_only: false,
      fixable: false,
      fix_instruction: `Investigate per ${sourceFileName}'s ${testName} test: ${descClean.slice(0, 400)}${descClean.length > 400 ? '...' : ''}`,
    };
  });
}

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
the structural example: Model type, Project/model characteristics, a
Must-have / Optional / Skip section (see below), a Sheet-identification
section (NOT a fixed table of "common sheet names" — ground this in the
real sheet names you were given for the actual triggering model, and
explicitly instruct the reviewer to identify structure from the model's
own evidence rather than assume a fixed template; two models in the same
broad industry can have materially different sheet structures, and a
rigid name-matching table has been confirmed, on real reference models
this project uses, to miss or mismatch genuine structural variation),
Typical ranges (explicitly disclosed as context only, not pass/fail
thresholds — this project never treats a benchmark as ground truth),
Common failure patterns specific to this domain (5-8 patterns, each a
real, specific, checkable mechanism — not generic advice), Dependency
chain (a plain-text arrow diagram tracing how this industry's inputs flow
through to outputs).

In addition, include a final "## Domain-specific graded tests" section,
formatted as a series of blocks in EXACTLY this shape (matching the
convention already used in skill-mining.md and skill-property.md):

### T2-S10-{N} — test: snake_case_test_name
One or two sentences of specific, checkable guidance — what pattern to
look for, and why it matters economically. Not generic advice.

Start numbering at {starting_rule_number} (given to you in the payload)
and increment by 1 for each test, with no gaps or reuse. Write 8-15 of
these, covering the domain's most material, checkable failure patterns —
quality over quantity; do not pad to reach a target count. Each test_name
must be a unique snake_case identifier not used elsewhere in this file.

The Must-have / Optional / Skip section exists because not every check in
a domain applies to every model of that type — some sub-variants within
the same broad industry genuinely don't have the mechanism a check is
about (e.g. a fully-stabilised asset has no contingency left to check,
because there's no construction phase left to hold contingency against).
Reason through this genuinely for the target domain, not mechanically:
- Must-have: checks that apply regardless of which sub-variant of this
  domain you're looking at
- Optional: checks that only apply when a specific mechanism, sheet, or
  sub-variant is actually present — state what that precondition is
- Skip by default: checks native to a DIFFERENT domain that don't belong
  here by default, but name the specific circumstance under which they'd
  become relevant anyway (e.g. a mixed-use property with a genuine
  subscription-revenue tenant might need a SaaS-domain check applied on
  top) — never state a flat "skip", always give the reviewer a concrete
  test for when to override it

Distinguish durable domain-economic principles (relationships that hold
regardless of date or jurisdiction — e.g. how a physical or legal
characteristic changes value or risk) from specific, time-bound facts
(current statutory rates, named current standards, specific numeric
benchmarks, named regulatory editions). Where you include a specific,
verifiable fact of the second kind, flag it as something a reviewer
should confirm is still current — don't state it as if it were as
durable as the underlying principle. This also makes the automated
verification pass that runs after this draft more effective: it can
check specific, flagged facts directly, rather than having to guess
which parts of the file are asserting something checkable.

Ground every specific claim in what a real model of this type would
actually contain, informed by the real sheet names and summary you were
given — do not write generic industry filler. If you are not confident
about a specific numeric range or benchmark, omit it rather than
inventing a plausible-sounding number.

Do not restate what skill.md and soul.md already cover generically —
generic spreadsheet review, audit evidence standards, severity
calibration, reporting conventions, formula engineering, and general
financial-statement mechanics (balance sheet reconciliation, cash flow
reconciliation, debt rollforward, tax reconciliation, and similar) are
handled by the core review methodology, not by this file. Every major
section should explicitly name this boundary where it's relevant — for
example, when writing about domain-specific accounting treatment, say
plainly that generic financial-statement mechanics remain in the core
skill, and only cover what's genuinely different because of this
domain's physical, legal, or economic characteristics. Restating a
generic concept in domain-flavoured language is not the same as
covering something the core methodology doesn't already handle — if
you're unsure whether a point belongs here or is already covered
generically, err toward leaving it out and stating the boundary
explicitly instead.

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
  // Stops at the first sentence-ending period after "Higher weight on:",
  // not at the next blank line or bold heading — 4 of 7 domain categories
  // in skill-generic.md have a second, unrelated sentence immediately
  // following in the same paragraph (e.g. "...scenario engine. Gate
  // failures are a P1 or P2 finding..."), which an earlier version of
  // this regex swallowed into the captured guidance, corrupting the
  // focus-area list with garbled non-terms. Confirmed on a real
  // production draft (skill-corporate.draft.md) — the first genuinely
  // live use of this function, not caught by earlier testing since that
  // only exercised two domain categories (Real estate, SaaS) that happen
  // not to have this second-sentence pattern. The 's' flag lets '.' match
  // across the line-wrapped markdown source.
  const re = new RegExp(
    `\\*\\*[^*]*${domainLabel}[^*]*\\*\\*\\s*\\n(Higher weight on:.*?\\.)(?:\\s|$)`,
    'is'
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

  const startingRuleNumber = getNextAvailableRuleNumber(configDir);

  const payload = {
    target_model_type: modelType,
    real_model_summary: modelSummary,
    real_sheet_names: sheetNames,
    structural_example_domain: structuralExampleDomain,
    structural_example_content: structuralExample,
    expected_focus_areas: weightingGuidance,
    starting_rule_number: startingRuleNumber,
  };

  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    // FIX: raised from 16000 — the structural example alone (mining,
    // now 1845 lines) approaches or exceeds this as INPUT, and this same
    // fix adds a genuinely new, substantial output requirement (8-15
    // graded test blocks) on top of the existing sections. The old
    // ceiling risked truncating a draft trying to match that depth
    // before this change; not a guess, a real constraint found while
    // building the graded-tests requirement itself.
    max_tokens: 32000,
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

  // FIX: extract any graded-test sections and stage the corresponding
  // checklist.json entries as a separate sidecar file — NOT merged into
  // the live checklist.json here. This closes the gap found this
  // session where drafts had no mechanism at all for registering new
  // rules, requiring a human to notice and build this manually after
  // the fact (as happened for both the mining and property domain
  // reviews). Staged the same way the draft skill file itself is
  // staged, requiring the same explicit human approval step via
  // tools/review-domains.js before merging into the live file.
  const checklistAdditions = extractGradedTestsAsChecklistEntries(draftContent, `skill-${modelType}.md`);
  const checklistAdditionsPath = path.join(draftsDir, `skill-${modelType}.draft.checklist-additions.json`);
  fs.writeFileSync(checklistAdditionsPath, JSON.stringify(checklistAdditions, null, 2));
  console.log(`   ${checklistAdditions.length} graded test(s) extracted \u2014 staged at ${checklistAdditionsPath} (not yet in checklist.json, requires approval).`);

  // Metadata sidecar — review-domains.js runs in a separate CLI
  // invocation, potentially long after this drafting call completed, and
  // needs weightingGuidance/structuralExampleDomain to actually re-run
  // eval-domain-skill.js's checks against this draft. Without this file,
  // that information only ever existed in this function's return value
  // and in-memory local variables — genuinely lost the moment this
  // process exits.
  const metaPath = path.join(draftsDir, `skill-${modelType}.draft.meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify({
    modelType,
    structuralExampleDomain,
    weightingGuidance,
    draftedAt: new Date().toISOString(),
    sourceModelSummary: modelSummary,
    sourceSheetNames: sheetNames,
  }, null, 2));

  console.log(`   Draft domain skill written: ${draftPath} (${draftContent.length} chars) — NOT live, requires review before use.`);

  return { draftPath, metaPath, checklistAdditionsPath, draftContent, weightingGuidanceUsed: weightingGuidance, checklistAdditions };
}

module.exports = { draftDomainSkill, extractWeightingGuidance, getNextAvailableRuleNumber, extractGradedTestsAsChecklistEntries };
