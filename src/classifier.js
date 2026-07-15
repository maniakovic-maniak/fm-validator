const Anthropic = require('@anthropic-ai/sdk');
const { extractJson } = require('./utils/json-extract');
const { resolveAny } = require('./utils/sheet-resolver');
const fs = require('fs');
const path = require('path');

const client = new Anthropic();

const CLASSIFIER_PROMPT = `You are a financial model classifier.

Your only job is to identify what type of financial model has been uploaded
based on the sheet names and a small sample of data.

Return ONLY a JSON object — no other text:
{
  "type": "mining" | "saas" | "property" | "infrastructure" | "generic",
  "confidence": 0-100,
  "reason": "one sentence explaining the classification"
}

Classification guide:

mining:
- Sheet names include: Ops, Reserves, Capex Unit Costs, D&T, Unit Economics
- Data includes: production volumes, ore grades, strip ratios, royalties, DSCR
- Keywords: tonne, ROM, pit, mining, resource, reserve, commodity

saas:
- Sheet names include: ARR, MRR, Cohort, Churn, CAC, LTV, Headcount
- Data includes: monthly recurring revenue, churn rate, customer counts
- Keywords: ARR, MRR, churn, SaaS, subscription, CAC, LTV, retention

property:
- Sheet names include: Development, GDV, Feasibility, Construction, Sales Programme
- Data includes: land cost, construction cost, gross development value, lot sales
- Keywords: GDV, development margin, settlement, lot, sqm, construction, feasibility

infrastructure:
- Sheet names include: Concession, Traffic, DSCR, LLCR, Toll, Tariff
- Data includes: DSCR, LLCR, PLCR, concession term, traffic volumes, tariff
- Keywords: concession, DSCR, LLCR, toll, traffic, regulated, availability payment

generic:
- Does not clearly match any of the above
- Mixed or unclear model type`;

async function classifyModel(parsed) {
  try {
    // Build a lean classification payload — sheet names + small data sample
    const sheetNames = parsed.sheetNames || [];

    // Sample up to 5 rows from a few representative sheets, if they exist.
    // Each category tries several real-world naming variants via
    // resolveAny() — a flat exact-name list here ('Dashboard', 'Summary',
    // 'Overview', 'Cons') was confirmed to match only 1 of 5 targets on a
    // real non-mining production file (The Bend), for the same reason as
    // the deep-accounting-subset bug fixed in validator-tier2.js this
    // session: hardcoded short/mining-style names don't generalise, and a
    // raw property lookup (parsed.sheets[name]) does no fuzzy matching at
    // all.
    //
    // Short/bare tokens ('Dashboard', 'Cons') are deliberately NOT offered
    // as aliases even as a low-priority fallback: sheet-resolver's Level 4
    // match is a normalized PREFIX check, and 'Dashboard' alone was
    // confirmed to prefix-match 'Dashboard (backup)' (its normalised form
    // literally starts with 'dashboard') while missing the more relevant
    // 'Equity Dashboard' / 'Debt Dashboard' entirely — and 'Cons' still
    // matches 'Construction Timeline' the same way found and fixed in
    // validator-tier2.js. Leaving a category unresolved is a better
    // outcome here than silently sampling a backup sheet or an unrelated
    // schedule — this is only a classification sample, not a finding.
    const BACKUP_SUFFIX_RE = /[\s_]*[\(\[-]?\s*(backup|copy|duplicate|old|archive|v\d+)\s*[\)\]]?\s*$/i;
    const candidateSheetNames = sheetNames.filter(n => !BACKUP_SUFFIX_RE.test(n));
    const SAMPLE_SHEET_CATEGORIES = {
      'Dashboard': ['Executive Dashboard', 'Summary Dashboard', 'Equity Dashboard', 'Debt Dashboard'],
      'Inputs':    ['Inputs', 'Assumptions', 'Key Inputs'],
      'Summary':   ['Financial Summary', 'Executive Summary', 'Summary'],
      'Overview':  ['Overview', 'Model Overview'],
      'Cons':      ['Consolidated', 'Cash Flow Statement', 'Cash Flow', 'Cashflow'],
    };
    const dataSample = {};
    for (const [category, aliases] of Object.entries(SAMPLE_SHEET_CATEGORIES)) {
      const resolved = resolveAny(aliases, candidateSheetNames);
      const sheet = resolved && parsed.sheets[resolved];
      if (sheet && sheet.length > 0) {
        dataSample[resolved] = sheet.slice(0, 8);
      }
    }

    const payload = {
      sheetNames,
      dataSample
    };

    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 200,
      system: CLASSIFIER_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    });

    const _tb = response.content.filter(b => b.type === 'text');
    const textBlock = { text: _tb.map(b => b.text).join('') };  // multi-block safe
    if (_tb.length === 0) throw new Error('No text block in classifier response');
    const result = extractJson(textBlock.text);
    return {
      type: result.type || 'generic',
      confidence: result.confidence || 50,
      reason: result.reason || 'Could not determine model type'
    };

  } catch (e) {
    console.error('   Classification error (defaulting to generic):', e.message);
    return { type: 'generic', confidence: 0, reason: 'Classification failed — using generic' };
  }
}

// Domain label normalization — maps a classifier-produced modelType
// string to one canonical domain name, so the same underlying file
// doesn't spawn a different skill (or a duplicate draft) depending on
// which exact wording Familiarisation happened to produce on a given
// run. Confirmed real and recurring on a genuine production file:
// classified as "property", then "corporate", then "property" again
// across three separate runs of the identical model — each time either
// missing the skill that already existed under a different name, or
// spawning a second, redundant draft.
//
// Matching is word-boundary-safe (not raw substring) for the same reason
// established earlier this session for sheet-name matching: a short,
// ambiguous alias term can otherwise false-match inside an unrelated
// longer word. Searches WITHIN the modelType string rather than requiring
// an exact whole-string match, so this works correctly whether modelType
// is a short category ("property") or a longer descriptive phrase
// ("property — entertainment venue development and operations").
const DOMAIN_ALIASES = {
  property: ['property', 'real estate', 'development', 'hospitality', 'entertainment venue', 'venue development', 'mixed-use', 'mixed use', 'corporate'],
  mining: ['mining', 'coal', 'resources', 'minerals'],
  // Add further canonical domains here as they're identified. 'corporate'
  // is deliberately mapped to 'property' rather than kept as its own
  // canonical domain — confirmed on real evidence that the two labels
  // described the exact same underlying file, and skill-property.md (the
  // merged file) already covers both the property/development and
  // corporate/operating angles.
};

function normalizeDomainLabel(modelType) {
  if (!modelType) return modelType;
  const lower = String(modelType).toLowerCase();
  for (const [canonical, aliases] of Object.entries(DOMAIN_ALIASES)) {
    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
      if (re.test(lower)) return canonical;
    }
  }
  return modelType; // no known alias — leave as-is; a genuinely new domain still works correctly, it just won't be normalized to anything yet
}

function loadDomainSkill(modelType) {
  const normalized = normalizeDomainLabel(modelType);
  const skillDir = path.join(__dirname, '../config');
  const candidates = [
    `skill-${normalized}.md`,
    'skill-generic.md'
  ];

  for (const filename of candidates) {
    const filepath = path.join(skillDir, filename);
    if (fs.existsSync(filepath)) {
      return {
        content: fs.readFileSync(filepath, 'utf8'),
        file: filename
      };
    }
  }

  return { content: '', file: 'none' };
}

// Maps a classifier-produced modelType string to the label used in
// skill-generic.md's own "Model type weighting rules" section, where one
// already exists — a prior decision already made in this codebase about
// what matters for that domain, which the draft should align with rather
// than reinvent. Deliberately small and only covers domains with an
// existing weighting entry; anything else drafts without this guidance
// rather than guessing at a label that doesn't exist.
const WEIGHTING_LABEL_MAP = {
  property: 'Real estate', 'real estate': 'Real estate', development: 'Real estate',
  saas: 'SaaS', technology: 'SaaS',
  infrastructure: 'Project finance', 'project finance': 'Project finance',
  lending: 'Lending', credit: 'Lending',
  fund: 'Fund', 'private equity': 'Fund',
  valuation: 'Valuation', dcf: 'Valuation',
  corporate: 'Corporate',
};
function guessWeightingLabel(modelType) {
  return WEIGHTING_LABEL_MAP[(modelType || '').toLowerCase().trim()] || null;
}

/**
 * Opportunistically queue a new domain skill draft when a model is
 * classified as a type with no dedicated skill file yet (loadDomainSkill
 * fell back to skill-generic.md). This is a pure side effect for FUTURE
 * runs — it never blocks, slows, or risks the CURRENT pipeline run, which
 * already has what it needs (skill-generic.md, loaded synchronously by
 * loadDomainSkill before this is ever called).
 *
 * Fire-and-forget by design: the actual drafting call (an LLM request)
 * is deliberately not awaited by the caller. Any failure here is caught
 * and logged, never allowed to propagate to or affect the current run.
 *
 * @param {string} modelType
 * @param {object} modelSummary - the real Familiarisation summary
 * @param {string[]} sheetNames - the real sheet names
 * @param {object} domainSkillResult - loadDomainSkill()'s own return value
 */
function maybeQueueDomainDraft(modelType, modelSummary, sheetNames, domainSkillResult) {
  if (!modelType || modelType === 'generic' || domainSkillResult.file !== 'skill-generic.md') {
    return { queued: false, reason: 'not applicable — model type unknown, or a dedicated skill already exists' };
  }

  // Normalize before checking/drafting — otherwise "property" and
  // "corporate" (confirmed, on a real file, to be the same underlying
  // model classified two different ways across separate runs) would each
  // check for and potentially create their OWN separate draft, rather
  // than sharing one.
  const normalized = normalizeDomainLabel(modelType);

  const configDir = path.join(__dirname, '../config');
  const draftPath = path.join(configDir, 'domains', `skill-${normalized}.draft.md`);
  if (fs.existsSync(draftPath)) {
    return { queued: false, reason: 'draft already pending review' };
  }

  const { draftDomainSkill } = require('./domain-synthesiser');
  draftDomainSkill(normalized, modelSummary, sheetNames, {
    weightingDomainLabel: guessWeightingLabel(normalized),
  }).then(() => {
    console.log(`   ℹ️  New domain "${normalized}" drafted for future review: config/domains/skill-${normalized}.draft.md (run tools/review-domains.js)`);
  }).catch(e => {
    console.error(`   ⚠️  Domain skill drafting failed for "${normalized}" (non-blocking, this run is unaffected):`, e.message);
  });

  return { queued: true };
}

module.exports = { classifyModel, loadDomainSkill, maybeQueueDomainDraft, normalizeDomainLabel };
