const Anthropic = require('@anthropic-ai/sdk');
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

    // Sample up to 5 rows from Dashboard and Inputs if they exist
    const sampleSheets = ['Dashboard', 'Inputs', 'Summary', 'Overview', 'Cons'];
    const dataSample = {};
    for (const name of sampleSheets) {
      const sheet = parsed.sheets[name];
      if (sheet && sheet.length > 0) {
        dataSample[name] = sheet.slice(0, 8);
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

    const textBlock = response.content.find(b => b.type === 'text');
        if (!textBlock) throw new Error('No text block in classifier response');
        const raw = textBlock.text.replace(/```json|```/g, '').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in response');

    const result = JSON.parse(raw.substring(start, end + 1));
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
