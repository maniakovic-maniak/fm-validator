const Anthropic = require('@anthropic-ai/sdk');
const { extractJson } = require('./utils/json-extract');

const client = new Anthropic();

const FAMILIARISER_PROMPT = `You are a senior financial model reviewer.

Your job is to read a financial model and produce a structured summary
that will be used as context for a detailed validation audit.

You will receive:
- The full list of sheet names
- Sample row data from every sheet

Read every sheet carefully. Build a complete picture of the model before writing anything.

CRITICAL JSON FORMATTING RULES — violating these breaks the entire pipeline:
- NEVER use double quotes (") inside any string value. If you need to reference
  a sheet name, term, or quoted concept, use single quotes ('like this') instead
- Keep every string value on a single line — no literal line breaks inside strings
- Do not use markdown formatting (no **, no backticks) inside string values
- Keep each string value under 200 characters

Return ONLY valid JSON — no other text:
{
  "model_purpose": "one sentence describing what this model is for",
  "model_type": "mining | saas | property | infrastructure | corporate | generic",
  "industry": "specific industry (e.g. coal mining, SaaS, residential development)",
  "currency": "AUD | USD | GBP | EUR | unknown",
  "periodicity": "monthly | quarterly | annual | mixed | unknown",
  "timeline": "description of the project timeline if visible",
  "key_sheets": ["list of sheets that appear to contain the core financial logic"],
  "key_drivers": ["list of 3-5 key value drivers visible in the model"],
  "sheet_map": {
    "SheetName": "one sentence describing what this sheet contains and its role"
  },
  "immediate_observations": [
    "any immediately obvious anomalies, inconsistencies, or concerns noticed during reading"
  ],
  "data_quality": "high | medium | low — based on completeness and consistency of visible data",
  "validation_focus": "which areas of the model appear most important to validate carefully"
}`;

function buildFamiliarisationPayload(parsed) {
  const sheetNames = parsed.sheetNames || [];
  const sheets = parsed.sheets || {};

  // Send meaningful rows from ALL sheets — not just the key ones
  // This is the full read-through step
  const allSheetData = {};

  const SKIP_SHEETS = ['Graphs', 'Copy', 'Names', 'Legend', 'Comps', 'Timing'];
  for (const name of sheetNames) {
    if (SKIP_SHEETS.includes(name.trim())) { allSheetData[name] = []; continue; }
    const sheet = sheets[name];
    if (!sheet || sheet.length === 0) {
      allSheetData[name] = [];
      continue;
    }

    // Get meaningful rows — prioritise rows with numeric values
    const meaningful = sheet.filter(row => {
      const vals = Object.values(row);
      return vals.some(v => v !== null && v !== '' && v !== undefined);
    });

    const numeric = meaningful.filter(row =>
      Object.values(row).some(v => v !== null && !isNaN(parseFloat(v)))
    );

    const nonNumeric = meaningful.filter(row =>
      !Object.values(row).some(v => v !== null && !isNaN(parseFloat(v)))
    );

    // For familiarisation: send up to 8 rows, first 6 + last 6 columns
    const selected = [...numeric.slice(0, 6), ...nonNumeric.slice(0, 2)].slice(0, 8);
    allSheetData[name] = selected.map(row => {
      const keys = Object.keys(row);
      if (keys.length <= 10) return row;
      const first = keys.slice(0, 5);
      const last  = keys.slice(-5);
      const combined = [...new Set([...first, ...last])];
      const trimmed = {};
      combined.forEach(k => { trimmed[k] = row[k]; });
      return trimmed;
    });
  }

  return {
    sheetNames,
    totalSheets: sheetNames.length,
    sheets: allSheetData
  };
}

async function familiariseModel(parsed) {
  console.log(`   Reading ${parsed.sheetNames.length} sheets...`);

  const payload = buildFamiliarisationPayload(parsed);
  const payloadStr = JSON.stringify(payload);
  const estimatedTokens = Math.round(payloadStr.length / 3);

  console.log(`   Familiarisation payload: ~${estimatedTokens} tokens`);

  // If payload is too large, trim to 8 rows per sheet
  let finalPayload = payload;
  if (estimatedTokens > 30000) {
    console.log('   Trimming to 8 rows per sheet...');
    const trimmed = {};
    for (const [name, rows] of Object.entries(payload.sheets)) {
      trimmed[name] = rows.slice(0, 3).map(row => {
        const keys = Object.keys(row);
        if (keys.length <= 10) return row;
        const combined = [...new Set([...keys.slice(0, 5), ...keys.slice(-5)])];
        const t = {};
        combined.forEach(k => { t[k] = row[k]; });
        return t;
      });
    }
    finalPayload = { ...payload, sheets: trimmed };
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 4000,
      system: FAMILIARISER_PROMPT,
      messages: [{
        role: 'user',
        content: JSON.stringify(finalPayload)
      }]
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text block in familiarisation response');
    const summary = extractJson(textBlock.text);
    console.log(`   Model identified: ${summary.model_type} — ${summary.industry}`);
    console.log(`   Currency: ${summary.currency} · Periodicity: ${summary.periodicity}`);
    if (summary.immediate_observations && summary.immediate_observations.length > 0) {
      console.log(`   ⚠️  ${summary.immediate_observations.length} immediate observation(s) noted`);
    }
    return summary;

  } catch (e) {
    console.error('   Familiarisation error:', e.message);
    // Return a minimal fallback so the pipeline continues
    return {
      model_purpose: 'Unknown — familiarisation failed',
      model_type: 'generic',
      industry: 'unknown',
      currency: 'unknown',
      periodicity: 'unknown',
      timeline: 'unknown',
      key_sheets: [],
      key_drivers: [],
      sheet_map: {},
      immediate_observations: [],
      data_quality: 'low',
      validation_focus: 'Full validation required — model type could not be determined'
    };
  }
}

// Format the model summary as additional context for Tier 2
function formatSummaryAsContext(summary) {
  if (!summary || summary.model_type === 'generic' && summary.industry === 'unknown') {
    return '';
  }

  const lines = [
    '## Model summary (from pre-validation read-through)',
    '',
    `Purpose: ${summary.model_purpose}`,
    `Type: ${summary.model_type} — ${summary.industry}`,
    `Currency: ${summary.currency} · Periodicity: ${summary.periodicity}`,
    `Timeline: ${summary.timeline || 'not visible'}`,
    `Data quality: ${summary.data_quality}`,
    '',
  ];

  if (summary.key_drivers && summary.key_drivers.length > 0) {
    lines.push('Key value drivers:');
    summary.key_drivers.forEach(d => lines.push(`- ${d}`));
    lines.push('');
  }

  if (summary.key_sheets && summary.key_sheets.length > 0) {
    lines.push(`Core calculation sheets: ${summary.key_sheets.join(', ')}`);
    lines.push('');
  }

  if (summary.immediate_observations && summary.immediate_observations.length > 0) {
    lines.push('Immediate observations from read-through:');
    summary.immediate_observations.forEach(o => lines.push(`- ${o}`));
    lines.push('');
  }

  if (summary.validation_focus) {
    lines.push(`Validation focus: ${summary.validation_focus}`);
  }

  return lines.join('\n');
}

module.exports = { familiariseModel, formatSummaryAsContext };
