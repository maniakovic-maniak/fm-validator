const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const checklist = require('../config/checklist.json');

const client = new Anthropic();

// Load soul and universal skill — always loaded once at startup
const soulPath  = path.join(__dirname, '../config/soul.md');
const skillPath = path.join(__dirname, '../config/skill.md');
const SOUL  = fs.existsSync(soulPath)  ? fs.readFileSync(soulPath, 'utf8')  : '';
const SKILL = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : '';

// Domain skill and model context — set dynamically per run
let DOMAIN        = '';
let MODEL_CONTEXT = '';

function setDomainSkill(content) {
  DOMAIN = content || '';
}

function setModelContext(context) {
  MODEL_CONTEXT = context || '';
}

function buildSystemPrompt() {
  const parts = [SOUL, SKILL, DOMAIN, MODEL_CONTEXT].filter(Boolean);
  return parts.join('\n\n---\n\n');
}

// Extracts meaningful rows from a sheet.
// Strategy: send first 6 + last 6 columns per row.
// This captures: label column + early periods + late periods
// without sending all 50+ quarterly columns.
function extractMeaningfulRows(rows, maxRows = 20) {
  if (!rows || rows.length === 0) return [];

  // Filter out completely empty rows
  const meaningful = rows.filter(row => {
    const vals = Object.values(row);
    return vals.some(v => v !== null && v !== '' && v !== undefined);
  });

  // Prioritise rows with numeric values (actual financial data)
  const numeric = meaningful.filter(row =>
    Object.values(row).some(v => v !== null && !isNaN(parseFloat(v)))
  );

  const nonNumeric = meaningful.filter(row =>
    !Object.values(row).some(v => v !== null && !isNaN(parseFloat(v)))
  );

  const selected = [...numeric.slice(0, maxRows), ...nonNumeric.slice(0, 5)].slice(0, maxRows);

  // Apply first 6 + last 6 column strategy
  return selected.map(row => {
    const keys = Object.keys(row);
    if (keys.length <= 12) return row; // already small — send as-is
    const firstSix = keys.slice(0, 6);
    const lastSix  = keys.slice(-6);
    const combined = [...new Set([...firstSix, ...lastSix])];
    const trimmed  = {};
    combined.forEach(k => { trimmed[k] = row[k]; });
    return trimmed;
  });
}

async function runTier2(parsed) {
  // Core financial sheets — all 7 needed for full rule coverage
  // Cons, IFS, AFS: three-statement integration (Section 5)
  // Inputs: assumption checks (Section 3)
  // Debt: debt roll-forward, covenants, waterfall (Section 6)
  // Ops: revenue = price × volume, capacity (Section 7)
  // Equity: equity reconciliation (Section 5.4)
  const sheetsToCheck = ['Cons', 'IFS', 'AFS', 'Inputs', 'Debt', 'Ops', 'Equity'];

  const dataSubset = {};
  for (const name of sheetsToCheck) {
    if (parsed.sheets[name]) {
      dataSubset[name] = extractMeaningfulRows(parsed.sheets[name]);
    }
  }

  const payload = {
    sheetNames: parsed.sheetNames,
    rules: checklist.tier2,
    data: dataSubset
  };

  const estimatedTokens = Math.round(JSON.stringify(payload).length / 3);
  console.log(`   Tier 2 data: ~${estimatedTokens} tokens`);

  // Trim further if still too large
  if (estimatedTokens > 80000) {
    console.log('   Trimming to 10 rows per sheet...');
    for (const name of sheetsToCheck) {
      if (dataSubset[name]) {
        dataSubset[name] = dataSubset[name].slice(0, 10);
      }
    }
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: buildSystemPrompt(),
      messages: [{ role: 'user', content: JSON.stringify(payload) }]
    });

    const raw = response.content[0].text.replace(/```json|```/g, '').trim();

    // Try object format first { "results": [...] }
    let results = [];
    const objStart = raw.indexOf('{');
    const objEnd   = raw.lastIndexOf('}');
    if (objStart !== -1 && objEnd !== -1) {
      try {
        results = JSON.parse(raw.substring(objStart, objEnd + 1)).results || [];
      } catch (parseErr) {
        // Try array format [ {...}, {...} ]
        const arrStart = raw.indexOf('[');
        const arrEnd   = raw.lastIndexOf(']');
        if (arrStart !== -1 && arrEnd !== -1) {
          try {
            results = JSON.parse(raw.substring(arrStart, arrEnd + 1));
          } catch (e2) {
            throw new Error('Could not parse Tier 2 response as JSON object or array');
          }
        }
      }
    }

    return results.map(r => ({
      ...r,
      cell: r.cell && r.cell !== 'Unknown' && r.cell !== 'N/A' ? r.cell : 'A1'
    }));

  } catch (e) {
    console.error('   ❌ Tier 2 error:', e.message);
    // Return a sentinel result so the UI knows Tier 2 failed
    return [{
      id: 'T2-ERROR',
      status: 'uncertain',
      confidence: 0,
      reason: `Tier 2 validation could not complete: ${e.message}. Manual review required.`,
      sheet: 'N/A',
      cell: 'A1',
      fixable: false,
      severity: 'high',
      fix_instruction: 'Tier 2 (Claude AI checks) did not complete. Re-run the validation or review the model manually.'
    }];
  }
}

module.exports = { runTier2, setDomainSkill, setModelContext };
