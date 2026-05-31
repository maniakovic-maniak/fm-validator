const Anthropic = require('@anthropic-ai/sdk');
const checklist = require('../config/checklist.json');

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a financial model validator specialising in mining and resource project financial models.

You will receive:
1. A list of validation rules with id, label, and description
2. A summary of key data extracted from a financial model Excel file

For each rule return one of three statuses:
- "pass": rule is clearly satisfied
- "fail": rule is clearly violated  
- "uncertain": data is ambiguous or insufficient to judge

For any fail or uncertain, include the sheet name and cell reference where possible.

Return ONLY valid JSON, no other text:
{
  "results": [
    { 
      "id": "T2-001", 
      "status": "pass", 
      "reason": "...",
      "sheet": "Cons",
      "cell": "B12",
      "fixable": false,
      "fix_instruction": "..."
    }
  ]
}`;

function summariseSheet(rows, maxRows = 8) {
  if (!rows || rows.length === 0) return [];
  return rows.slice(0, maxRows).map(row => {
    const summary = {};
    const keys = Object.keys(row).slice(0, 6);
    for (const k of keys) summary[k] = row[k];
    return summary;
  });
}

async function runTier2(parsed) {
  const dataSubset = {};
  const sheetsToCheck = ['Cons', 'Ops', 'Inputs', 'Debt', 'Equity'];

  for (const name of sheetsToCheck) {
    if (parsed.sheets[name]) {
      dataSubset[name] = summariseSheet(parsed.sheets[name]);
    }
  }

  const userMessage = JSON.stringify({
    rules: checklist.tier2,
    data: dataSubset
  });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  });

  try {
    const raw = response.content[0].text;
    const clean = raw.replace(/```json|```/g, '').trim();
    const results = JSON.parse(clean).results;
    return results.map(r => ({
      ...r,
      cell: r.cell && r.cell !== 'Unknown' && r.cell !== 'N/A' ? r.cell : 'A1'
    }));
  } catch (e) {
    console.error('Tier 2 parse error:', e.message);
    return [];
  }
}

module.exports = { runTier2 };
