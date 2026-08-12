// eval-domain-skill.js — validates a DRAFT domain skill file before it's
// allowed to move from config/domains/skill-{type}.draft.md to the live
// config/skill-{type}.md location.
//
// This is the direct equivalent of skill-creator's own eval loop
// (scripts/run_loop.py) adapted to fm-validator's actual architecture.
// fm-validator's domain skills aren't triggered by Claude matching a
// query against a description (the way a Claude Code skill is) — they're
// loaded deterministically by classifier.js's model-type string output.
// So the "should-trigger / should-not-trigger" discipline in this
// project's mechanism isn't about testing trigger phrases; it's about
// two different, both genuinely checkable things:
//   1. Structural + content completeness of the draft itself — does it
//      follow this project's established domain-skill conventions, and
//      does it cover the specific focus areas skill-generic.md's own
//      "Model type weighting rules" section already named as important
//      for this domain (a decision already made in this codebase, not
//      something a draft should be allowed to silently omit)?
//   2. Whether the draft still contains obvious residue from whatever
//      structural example it was drafted from — the clearest sign a
//      draft was copy-adapted carelessly rather than genuinely written
//      for its own domain.
//
// This does not call the Anthropic API or require model access — it's a
// pure, deterministic check over the draft's text content, intended to
// run automatically the moment a draft is produced, before a human ever
// looks at it via the planned tools/review-domains.js.

const REQUIRED_SECTIONS = [
  '## Model',           // "## Model type" / "## Model characteristics" etc.
  '## Sheet map',
  '## Typical ranges',
  '## Common',          // "## Common failure patterns" / "## Common ... patterns"
  '## Dependency chain',
  '## Must-have',       // B3/B4 — Must-have/Optional/Skip tiering, required for drafts generated after this convention was adopted
];

// Domain-specific terminology that should NEVER appear in a draft for a
// DIFFERENT domain — the clearest possible sign of careless copy-adaptation
// from the structural example rather than genuine domain-specific content.
// Deliberately small and specific (not every word from the example file)
// to avoid false positives on genuinely coincidental overlap.
const DOMAIN_RESIDUE_TERMS = {
  mining: ['strip ratio', 'royalt', 'rehabilitation provision', 'wash plant', 'reserve depletion', 'run-of-mine', 'coal'],
};

function checkStructuralCompleteness(draftContent) {
  const checks = REQUIRED_SECTIONS.map(section => ({
    check: `Has section starting with "${section}"`,
    passed: draftContent.includes(section),
  }));
  return checks;
}

function checkFocusAreaCoverage(draftContent, weightingGuidance) {
  if (!weightingGuidance) {
    return [{ check: 'Focus-area coverage (no prior weighting guidance existed for this domain)', passed: true, skipped: true }];
  }
  // weightingGuidance looks like: "Higher weight on: GDV reconciliation,
  // development margin calculation, GST treatment, settlement timing,
  // contingency adequacy, lifecycle phases."
  const listPart = weightingGuidance.replace(/^Higher weight on:\s*/i, '').replace(/\.$/, '');
  const focusAreas = listPart.split(',').map(s => s.trim().replace(/^and\s+/i, '')).filter(Boolean);
  // Collapse all whitespace (including newlines) to single spaces before
  // matching — markdown content is routinely soft-wrapped across lines,
  // and a multi-word focus area term can straddle a line break (e.g.
  // "...cash timing (tax\n   reconciliation)." from normal ~75-character
  // line wrapping). A literal substring match against un-normalized
  // content would then fail even though the phrase reads correctly to a
  // human, or to anything markdown-rendering the text. Confirmed real on
  // a genuine draft: "tax reconciliation" and "margin plausibility" both
  // genuinely appeared in the content but were each split by a line
  // break, and failed this check before this fix.
  const lowerContent = draftContent.toLowerCase().replace(/\s+/g, ' ');
  return focusAreas.map(area => {
    // Use just the first few significant words of a multi-word area for
    // matching — "GDV reconciliation" should match "GDV" appearing
    // anywhere near reconciliation-related text, not require the exact
    // phrase verbatim.
    const keyTerm = area.split(' ').slice(0, 2).join(' ').toLowerCase().replace(/\s+/g, ' ');
    return {
      check: `Mentions expected focus area: "${area}"`,
      passed: lowerContent.includes(keyTerm) || lowerContent.includes(area.toLowerCase().replace(/\s+/g, ' ')),
    };
  });
}

function checkNoResidueFromStructuralExample(draftContent, structuralExampleDomain, targetDomain) {
  const residueTerms = DOMAIN_RESIDUE_TERMS[structuralExampleDomain];
  if (!residueTerms || structuralExampleDomain === targetDomain) {
    return [{ check: 'No residue check applicable', passed: true, skipped: true }];
  }
  const lowerContent = draftContent.toLowerCase();
  return residueTerms.map(term => ({
    check: `Does not carry over "${term}" from the ${structuralExampleDomain} structural example`,
    passed: !lowerContent.includes(term.toLowerCase()),
  }));
}

function checkGradedTestsMatchChecklistAdditions(draftContent, checklistAdditions) {
  if (checklistAdditions === undefined) {
    return [{ check: 'Graded-tests / checklist-additions consistency (no sidecar provided)', passed: true, skipped: true }];
  }
  const pattern = /^### (T2-S10-\d+) — test: (\w+)/gm;
  const draftIds = new Set([...draftContent.matchAll(pattern)].map(m => m[1]));
  const sidecarIds = new Set(checklistAdditions.map(r => r.id));

  const missingFromSidecar = [...draftIds].filter(id => !sidecarIds.has(id));
  const extraInSidecar = [...sidecarIds].filter(id => !draftIds.has(id));

  return [
    {
      check: 'Every graded test in the draft has a corresponding checklist-additions entry',
      passed: missingFromSidecar.length === 0,
      detail: missingFromSidecar.length > 0 ? `Missing: ${missingFromSidecar.join(', ')}` : undefined,
    },
    {
      check: 'No checklist-additions entry without a corresponding graded test in the draft',
      passed: extraInSidecar.length === 0,
      detail: extraInSidecar.length > 0 ? `Orphaned: ${extraInSidecar.join(', ')}` : undefined,
    },
  ];
}

/**
 * Checks that the draft genuinely references the real sheet names it was
 * given at generation time, rather than defaulting to generic industry
 * sheet names disconnected from the actual triggering model. Confirmed
 * this session, on real reference models (Hidden Gem, Bend), that a
 * draft's assumed structure can diverge substantially from what a real
 * model of the same domain actually looks like — this check catches the
 * weakest case of that: a draft that never references the one real
 * example it was explicitly given.
 *
 * Deliberately NOT a 100% coverage requirement — a domain skill file is
 * meant to generalize beyond one example model, and some sheet names
 * (administrative tabs, cover sheets) aren't worth naming specifically.
 * Flags only when grounding looks genuinely weak, not merely partial.
 *
 * @param {string} draftContent
 * @param {string[]|undefined} sourceSheetNames - the real sheet names
 *   from the triggering model, from the .draft.meta.json sidecar
 */
function checkSheetNameGrounding(draftContent, sourceSheetNames) {
  if (!sourceSheetNames || sourceSheetNames.length === 0) {
    return [{ check: 'Sheet-name grounding (no source sheet names available)', passed: true, skipped: true }];
  }
  const lowerContent = draftContent.toLowerCase();
  const referenced = sourceSheetNames.filter(name =>
    name && name.trim().length > 0 && lowerContent.includes(name.toLowerCase().trim())
  );
  const proportion = referenced.length / sourceSheetNames.length;
  // Threshold set low deliberately (20%) — this is a floor catching
  // near-total disconnection from the real triggering model, not a
  // target proportion. A well-written draft will often exceed it by a
  // wide margin without needing to.
  const passed = proportion >= 0.2;
  return [{
    check: `Draft references a meaningful proportion of the real triggering model's sheet names`,
    passed,
    detail: `${referenced.length}/${sourceSheetNames.length} referenced (${Math.round(proportion * 100)}%)${passed ? '' : ' — below the 20% floor, draft may be generic rather than grounded in the real model'}`,
  }];
}

/**
 * Run the full eval check against a draft domain skill.
 *
 * @param {string} draftContent
 * @param {string} targetDomain - e.g. 'property'
 * @param {string|null} weightingGuidance - from extractWeightingGuidance(), or null
 * @param {string} structuralExampleDomain - which existing skill was used as the structural example
 * @param {Array<object>} [checklistAdditions] - from the .draft.checklist-additions.json sidecar, if present
 */
function evalDomainSkillDraft(draftContent, targetDomain, weightingGuidance, structuralExampleDomain, checklistAdditions, sourceSheetNames) {
  const allChecks = [
    ...checkStructuralCompleteness(draftContent),
    ...checkFocusAreaCoverage(draftContent, weightingGuidance),
    ...checkNoResidueFromStructuralExample(draftContent, structuralExampleDomain, targetDomain),
    ...checkGradedTestsMatchChecklistAdditions(draftContent, checklistAdditions),
    ...checkSheetNameGrounding(draftContent, sourceSheetNames),
  ];

  const failed = allChecks.filter(c => !c.passed && !c.skipped);
  const passed = allChecks.filter(c => c.passed && !c.skipped);
  const skipped = allChecks.filter(c => c.skipped);

  return {
    readyForReview: failed.length === 0,
    passedCount: passed.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    checks: allChecks,
    summary: failed.length === 0
      ? `All ${passed.length} check(s) passed (${skipped.length} not applicable). Ready for human review via tools/review-domains.js.`
      : `${failed.length} check(s) failed: ${failed.map(c => c.check).join('; ')}. Do not promote to live config/ until addressed.`,
  };
}

module.exports = { evalDomainSkillDraft, checkStructuralCompleteness, checkFocusAreaCoverage, checkNoResidueFromStructuralExample, checkGradedTestsMatchChecklistAdditions, checkSheetNameGrounding };
