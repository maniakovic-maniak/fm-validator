const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const checklist = require('../config/checklist.json');

const client = new Anthropic();

// Load soul and universal skill — always loaded once at startup, never change
const soulPath  = path.join(__dirname, '../config/soul.md');
const skillPath = path.join(__dirname, '../config/skill.md');
const SOUL  = fs.existsSync(soulPath)  ? fs.readFileSync(soulPath, 'utf8')  : '';
const SKILL = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : '';

// No module-level mutable state — domain and modelContext passed per request
// Returns static (cacheable) and dynamic (per-model) prompt parts separately.
// Static: soul + skill + domain — same across calls for the same model type.
// Dynamic: model context — changes per uploaded file.
function buildSystemPrompt(domain, modelContext) {
  const staticParts = [SOUL, SKILL, domain].filter(Boolean);
  const staticPrompt = staticParts.join('\n\n---\n\n');
  return { staticPrompt, dynamicPrompt: modelContext || '' };
}

function extractMeaningfulRows(rows, maxRows = 20) {
  if (!rows || rows.length === 0) return [];

  const meaningful = rows.filter(row => {
    const vals = Object.values(row);
    return vals.some(v => v !== null && v !== '' && v !== undefined);
  });

  const numeric = meaningful.filter(row =>
    Object.values(row).some(v => v !== null && !isNaN(parseFloat(v)))
  );

  const nonNumeric = meaningful.filter(row =>
    !Object.values(row).some(v => v !== null && !isNaN(parseFloat(v)))
  );

  const selected = [...numeric.slice(0, maxRows), ...nonNumeric.slice(0, 5)].slice(0, maxRows);

  return selected.map(row => {
    const keys = Object.keys(row);
    if (keys.length <= 12) return row;
    const firstSix = keys.slice(0, 6);
    const lastSix  = keys.slice(-6);
    const combined = [...new Set([...firstSix, ...lastSix])];
    const trimmed  = {};
    combined.forEach(k => { trimmed[k] = row[k]; });
    return trimmed;
  });
}

// Parse Claude response — handles object {results:[...]} or raw array
function parseResponse(raw) {
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return { results: parsed, meta: {} };
    if (parsed && Array.isArray(parsed.results)) {
      const { results, ...meta } = parsed;
      return { results, meta };
    }
  } catch (e1) {
    // Try extracting results array directly
    const arrStart = cleaned.indexOf('"results"');
    if (arrStart !== -1) {
      const bracketStart = cleaned.indexOf('[', arrStart);
      const bracketEnd   = cleaned.lastIndexOf(']');
      if (bracketStart !== -1 && bracketEnd !== -1) {
        try {
          return { results: JSON.parse(cleaned.substring(bracketStart, bracketEnd + 1)), meta: {} };
        } catch (e2) {}
      }
    }
    // Try raw array
    const arrS = cleaned.indexOf('[');
    const arrE = cleaned.lastIndexOf(']');
    if (arrS !== -1 && arrE !== -1) {
      try {
        return { results: JSON.parse(cleaned.substring(arrS, arrE + 1)), meta: {} };
      } catch (e3) {}
    }
  }
  throw new Error(`Could not parse Tier 2 response (length: ${cleaned.length}, tail: ${cleaned.slice(-80)})`);
}

// Run a single batch of rules via streaming
async function runBatch(batchRules, dataSubset, sheetNames, systemPrompt, batchLabel, tier0Context = {}) {
  const payload = {
    sheetNames,
    rules: batchRules,
    data: dataSubset,
    workbookStats: tier0Context.stats || {},
    riskSummary: tier0Context.risks || {}
  };

  const estimatedTokens = Math.round(JSON.stringify(payload).length / 3);
  console.log(`   ${batchLabel}: ~${estimatedTokens} tokens input, ${batchRules.length} rules`);

  let rawText = '';
  const stream = await client.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 64000,
    temperature: 0,
    system: [
      {
        type: 'text',
        text: systemPrompt.staticPrompt,
        cache_control: { type: 'ephemeral' }
      },
      ...(systemPrompt.dynamicPrompt ? [{
        type: 'text',
        text: systemPrompt.dynamicPrompt
      }] : []),
    ],
    messages: [{ role: 'user', content: JSON.stringify(payload) }]
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta && chunk.delta.type === 'text_delta') {
      rawText += chunk.delta.text;
    }
  }

  console.log(`   ${batchLabel}: ${rawText.length} chars received`);
  return parseResponse(rawText);
}

// Split tier2 rules into batches by section
function splitIntoBatches(rules) {
  const batch1Sections = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'];
  const batch2Sections = ['S8', 'S9', 'S10', 'S11', 'S12', 'S13'];

  const batch1 = rules.filter(r => batch1Sections.some(s => r.id.includes(`-${s}-`)));
  const batch2 = rules.filter(r => batch2Sections.some(s => r.id.includes(`-${s}-`)));

  // Any rules not matched go to batch1
  const matched = new Set([...batch1.map(r => r.id), ...batch2.map(r => r.id)]);
  const unmatched = rules.filter(r => !matched.has(r.id));
  batch1.push(...unmatched);

  return { batch1, batch2 };
}

async function runTier2(parsed, { domain = '', modelContext = '', keySheets = null, tier0Stats = null, tier0Risks = null } = {}) {
  const sheetsToCheck = keySheets && keySheets.length > 0
    ? keySheets
    : ['Cons', 'IFS', 'AFS', 'Inputs', 'Debt', 'Ops', 'Equity'];

  const dataSubset = {};
  for (const name of sheetsToCheck) {
    if (parsed.sheets[name]) {
      dataSubset[name] = extractMeaningfulRows(parsed.sheets[name]);
    }
  }

  // Trim if too large
  const totalTokens = Math.round(JSON.stringify(dataSubset).length / 3);
  if (totalTokens > 40000) {
    console.log('   Trimming sheet data to 10 rows per sheet...');
    for (const name of Object.keys(dataSubset)) {
      dataSubset[name] = dataSubset[name].slice(0, 10);
    }
  }

  const systemPrompt = buildSystemPrompt(domain, modelContext);
  const { batch1, batch2 } = splitIntoBatches(checklist.tier2);
  const allResults = [];
  let topLevelMeta = {};

  try {
    // ── Batch 1: Sections S1-S7 ──────────────────────────────────────────────
    if (batch1.length > 0) {
      try {
        const { results, meta } = await runBatch(
          batch1, dataSubset, parsed.sheetNames, systemPrompt, 'Batch 1 (S1-S7)', { stats: tier0Stats, risks: tier0Risks }
        );
        allResults.push(...results);
        if (meta && meta.overall_assessment) topLevelMeta = meta;
      } catch (e) {
        console.error('   ❌ Batch 1 error:', e.message);
        allResults.push({
          id: 'T2-BATCH1-ERROR', status: 'uncertain', confidence: 0,
          severity: 'high', urgency: 'before_signoff',
          category: 'Governance', method: 'automated',
          reason: `Batch 1 (Sections 1-7) could not complete: ${e.message}`,
          sheet: 'N/A', cell: 'A1', fixable: false,
          fix_instruction: 'Re-run the validation. If the error persists, reduce the model file size.',
          escalation_flag: false, investment_grade_blocker: false,
          condition: '', criteria: '', cause: '', consequence: '', corrective_action: '',
          periods_affected: [], dollar_impact: 'unquantified', root_cause: 'Validation error'
        });
      }
    }

    // ── Batch 2: Sections S8-S13 ─────────────────────────────────────────────
    if (batch2.length > 0) {
      try {
        const { results, meta } = await runBatch(
          batch2, dataSubset, parsed.sheetNames, systemPrompt, 'Batch 2 (S8-S13)', { stats: tier0Stats, risks: tier0Risks }
        );
        allResults.push(...results);
        // Only override meta if batch 2 returns a more complete assessment
        if (meta && meta.overall_assessment && !topLevelMeta.overall_assessment) {
          topLevelMeta = meta;
        }
      } catch (e) {
        console.error('   ❌ Batch 2 error:', e.message);
        allResults.push({
          id: 'T2-BATCH2-ERROR', status: 'uncertain', confidence: 0,
          severity: 'high', urgency: 'before_signoff',
          category: 'Governance', method: 'automated',
          reason: `Batch 2 (Sections 8-13) could not complete: ${e.message}`,
          sheet: 'N/A', cell: 'A1', fixable: false,
          fix_instruction: 'Re-run the validation. If the error persists, reduce the model file size.',
          escalation_flag: false, investment_grade_blocker: false,
          condition: '', criteria: '', cause: '', consequence: '', corrective_action: '',
          periods_affected: [], dollar_impact: 'unquantified', root_cause: 'Validation error'
        });
      }
    }

    // Normalise all results — ensure required fields exist
    const normalised = allResults.map(r => ({
      id:                       r.id || 'UNKNOWN',
      status:                   r.status || 'uncertain',
      confidence:               r.confidence ?? 0,
      severity:                 r.severity || 'medium',
      urgency:                  r.urgency || 'next_revision',
      category:                 r.category || 'Governance',
      method:                   r.method || 'automated',
      reason:                   r.reason || '',
      sheet:                    r.sheet || '',
      cell:                     r.cell && r.cell !== 'Unknown' ? r.cell : 'A1',
      periods_affected:         r.periods_affected || [],
      dollar_impact:            r.dollar_impact || 'unquantified',
      root_cause:               r.root_cause || '',
      condition:                r.condition || '',
      criteria:                 r.criteria || '',
      cause:                    r.cause || '',
      consequence:              r.consequence || '',
      corrective_action:        r.corrective_action || '',
      fixable:                  r.fixable ?? false,
      fix_instruction:          r.fix_instruction || r.corrective_action || '',
      escalation_flag:          r.escalation_flag ?? false,
      investment_grade_blocker: r.investment_grade_blocker ?? false,
      // Top-level meta fields (from overall assessment)
      _meta: topLevelMeta
    }));

    return normalised;

  } catch (e) {
    console.error('   ❌ Tier 2 fatal error:', e.message);
    return [{
      id: 'T2-ERROR', status: 'uncertain', confidence: 0,
      severity: 'high', urgency: 'immediate',
      category: 'Governance', method: 'automated',
      reason: `Tier 2 validation could not complete: ${e.message}. Manual review required.`,
      sheet: 'N/A', cell: 'A1', fixable: false,
      fix_instruction: 'Tier 2 (Claude AI checks) did not complete. Re-run the validation or review the model manually.',
      escalation_flag: true, investment_grade_blocker: false,
      condition: '', criteria: '', cause: '', consequence: '', corrective_action: '',
      periods_affected: [], dollar_impact: 'unquantified', root_cause: 'Validation system error',
      _meta: {}
    }];
  }
}

module.exports = { runTier2 };
