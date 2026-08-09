// domain-skill-verifier.js
//
// Automated source-verification pass for a freshly-drafted domain skill
// file. Extracts the specific, checkable claims from the draft (sheet-
// naming conventions, standard domain metrics, typical model structure)
// and verifies each one via web search against an agreed source-tier
// list, producing a report for the human reviewer alongside
// eval-domain-skill.js's existing structural checks.
//
// DELIBERATELY SEPARATE from eval-domain-skill.js: that module is
// explicitly documented as not calling the Anthropic API, by design, so
// it can run synchronously the instant a draft is written. This module
// does the opposite — it's async, costs real tokens, and takes real
// time — so it's kept as its own fire-and-forget pass (matching
// draftDomainSkill()'s own pattern in domain-synthesiser.js), writing
// its results to a separate sidecar file that tools/review-domains.js
// picks up and displays alongside the structural eval, not merged into
// it.
//
// This NEVER auto-approves a draft. Its only output is a verification
// report — confirmed / contradicted / unverified per claim, with the
// source and tier behind each verdict. The actual approve/reject
// decision stays exactly where it already lives: a human, via
// tools/review-domains.js.

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

// ══════════════════════════════════════════════════════════════════
// Source-tier list — agreed directly with the project owner. A single
// Tier 1 or Tier 2 source is sufficient to confirm a claim. Tier 3
// requires 2+ independent sources agreeing. Tier 4 can never confirm a
// claim on its own — logged only as weak corroboration. Anything
// showing signs of unauthorized reproduction (piracy-site watermarks,
// unattributed content, paywalled excerpts) is excluded entirely, the
// same discipline already applied by hand to every book checked this
// project.
// ══════════════════════════════════════════════════════════════════
const SOURCE_TIER_GUIDANCE = `
SOURCE TIERS — apply these exactly when judging what you find via web search:

Tier 1 (Authoritative) — a single source is sufficient to confirm a claim:
- Industry standard-setting or regulatory bodies (e.g. JORC Code, NI 43-101 for mining;
  RICS for real estate; relevant project-finance standards bodies for infrastructure)
- Established financial-modelling standards already used in this project
  (ICAEW Financial Modelling Code, FAST Standard, IFRS)

Tier 2 (Established publisher/institutional) — a single source is sufficient:
- Books from recognized finance/academic publishers (Wiley, MIT Press, McGraw-Hill,
  Palgrave, and similar)
- Major accounting-firm published methodology guides (KPMG, PwC, Deloitte, EY),
  when genuinely publicly published
- Peer-reviewed academic journals directly on the relevant topic

Tier 3 (Established practitioner) — requires 2+ INDEPENDENT sources agreeing:
- Recognized training providers/consultancies with verifiable, established credentials
  (decades of documented practice, professional-body contribution — not just a bio claim)
- Trade publications with genuine editorial standards, not self-published content

Tier 4 (General web) — NEVER sufficient alone to confirm a claim, log as weak
corroboration only:
- Ordinary blog posts, marketing/SEO comparison content, forum posts, Q&A sites

EXCLUDE ENTIRELY, do not cite even as weak corroboration:
- Any source showing signs of unauthorized reproduction of copyrighted material
  (piracy-site watermarks, e.g. OceanofPDF-style markers embedded in extracted text)
- Anonymous/unattributed content with no way to verify authorship
- Content you can tell is a paywalled excerpt reproduced without rights
`.trim();

const VERIFIER_SYSTEM_PROMPT = `You are verifying a freshly-drafted financial-model domain skill file before it goes to a human for approval. Your job has two parts, done together in one pass:

1. EXTRACT the specific, checkable factual claims from the draft — sheet-naming conventions,
   standard financial metrics for this domain, typical model structure, industry-specific
   conventions or terminology. Do NOT extract vague or subjective statements ("models in this
   domain can be complex") — only claims a real source could confirm or contradict.

2. VERIFY each extracted claim using web search, applying the source-tier rules below exactly.
   For each claim, search for genuine reference material, judge the tier of what you find, and
   reach a verdict: "confirmed", "contradicted", or "unverified" (searched but found nothing
   authoritative enough per the tier rules).

${SOURCE_TIER_GUIDANCE}

Respond with ONLY a JSON object, no other text, in exactly this shape:
{
  "claims": [
    {
      "claim": "the exact claim text from the draft, verbatim or near-verbatim",
      "verdict": "confirmed" | "contradicted" | "unverified",
      "source_tier": 1 | 2 | 3 | 4 | null,
      "source_description": "what the source is (e.g. 'JORC Code 2012 Edition, section 3.2') — null if unverified",
      "source_url": "URL if available, else null",
      "note": "one or two sentences of reasoning — why this verdict, what the source actually said, and if contradicted, what it said instead"
    }
  ]
}`;

/**
 * Runs the full extraction + verification pass against a draft domain
 * skill file. Fire-and-forget by design — the caller does not await
 * this in the request path of anything time-sensitive.
 *
 * @param {string} draftContent - the full text of the draft skill file
 * @param {string} targetDomain - e.g. 'infrastructure'
 * @returns {Promise<object>} the verification report
 */
async function verifyDomainSkillDraft(draftContent, targetDomain) {
  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 16000,
    system: VERIFIER_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Domain: ${targetDomain}\n\nDraft skill file content:\n\n${draftContent}`,
    }],
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  });

  const textBlocks = response.content.filter(b => b.type === 'text').map(b => b.text).join('');

  let parsed;
  try {
    // The model may wrap JSON in markdown fences despite instructions —
    // strip those defensively before parsing, same pattern used
    // elsewhere in this codebase for LLM JSON responses.
    const cleaned = textBlocks.replace(/```json\s*|\s*```/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return {
      applicable: false,
      error: `Could not parse verification response as JSON: ${e.message}`,
      rawResponse: textBlocks.slice(0, 2000),
    };
  }

  const claims = parsed.claims || [];
  const confirmed = claims.filter(c => c.verdict === 'confirmed');
  const contradicted = claims.filter(c => c.verdict === 'contradicted');
  const unverified = claims.filter(c => c.verdict === 'unverified');

  return {
    applicable: true,
    targetDomain,
    totalClaims: claims.length,
    confirmedCount: confirmed.length,
    contradictedCount: contradicted.length,
    unverifiedCount: unverified.length,
    claims,
    summary: contradicted.length > 0
      ? `⚠️  ${contradicted.length} claim(s) CONTRADICTED by a source — review these before approving. ${confirmed.length} confirmed, ${unverified.length} unverified.`
      : `${confirmed.length} of ${claims.length} claim(s) confirmed, ${unverified.length} unverified. No contradictions found.`,
  };
}

/**
 * Runs verification and writes the result to a sidecar file next to the
 * draft, so tools/review-domains.js can pick it up in a later, separate
 * CLI invocation — the same separation already used for the drafting
 * metadata sidecar.
 *
 * @param {string} draftPath - full path to skill-{domain}.draft.md
 * @param {string} targetDomain
 */
async function verifyAndSaveSidecar(draftPath, targetDomain) {
  const draftContent = fs.readFileSync(draftPath, 'utf8');
  const result = await verifyDomainSkillDraft(draftContent, targetDomain);
  const sidecarPath = draftPath.replace(/\.draft\.md$/, '.draft.verification.json');
  fs.writeFileSync(sidecarPath, JSON.stringify(result, null, 2));
  return { sidecarPath, result };
}

module.exports = { verifyDomainSkillDraft, verifyAndSaveSidecar, SOURCE_TIER_GUIDANCE };
