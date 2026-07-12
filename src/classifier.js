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

function loadDomainSkill(modelType) {
  const skillDir = path.join(__dirname, '../config');
  const candidates = [
    `skill-${modelType}.md`,
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

module.exports = { classifyModel, loadDomainSkill };
