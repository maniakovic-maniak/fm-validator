const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const checklist = require('../config/checklist.json');
const { resolveAny } = require('./utils/sheet-resolver');
const { extractJson } = require('./utils/json-extract');
const { dumpFailedResponse } = require('./utils/dump-failed-response');

const client = new Anthropic();

// Load soul and universal skill — always loaded once at startup, never change
const soulPath  = path.join(__dirname, '../config/soul.md');
const skillPath = path.join(__dirname, '../config/skill.md');
// Read per-call, not at module load — a long-running dev server otherwise
// silently keeps stale prompts after config/soul.md or skill.md change on disk.
function SOUL()  { return fs.existsSync(soulPath)  ? fs.readFileSync(soulPath, 'utf8')  : ''; }
function SKILL() { return fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : ''; }

// No module-level mutable state — domain and modelContext passed per request
// Returns static (cacheable) and dynamic (per-model) prompt parts separately.
// Static: soul + skill + domain — same across calls for the same model type.
// Dynamic: model context — changes per uploaded file.
function buildSystemPrompt(domain, modelContext) {
  const staticParts = [SOUL(), SKILL(), domain].filter(Boolean);
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
    // Capture cell address info before trimming — _cellRefs and _rowNum
    // are non-enumerable so they survive Object.keys() exclusion naturally,
    // but we read them explicitly here since the trimmed object below is
    // a fresh literal and won't inherit them.
    const cellRefs = row._cellRefs || {};
    const rowNum   = row._rowNum;
    // Use the cell ref of the first column with a value as a row anchor —
    // gives Claude a concrete starting cell reference for this row even
    // when only a subset of columns are shown.
    // Prefer a numeric-value column as the anchor — period calculation cells
    // (columns J onwards) are more meaningful than row label cells (column C).
    // Falling back to any cell with a ref if no numeric column exists.
    const firstNumericKeyWithRef = keys.find(k => {
      const v = row[k];
      return cellRefs[k] && v !== null && v !== undefined && v !== '' && !isNaN(parseFloat(v));
    });
    const firstKeyWithRef = firstNumericKeyWithRef || keys.find(k => cellRefs[k]);
    const rowAnchorCell   = firstKeyWithRef ? cellRefs[firstKeyWithRef] : null;

    let resultRow;
    if (keys.length <= 12) {
      resultRow = { ...row };
    } else {
      const firstSix = keys.slice(0, 6);
      const lastSix  = keys.slice(-6);
      const combined = [...new Set([...firstSix, ...lastSix])];
      resultRow = {};
      combined.forEach(k => { resultRow[k] = row[k]; });
    }

    // Attach cell reference metadata as a visible field so Claude can cite
    // real cell addresses. Kept compact — only the row anchor cell and row
    // number, not a full per-column map, to control token cost.
    if (rowAnchorCell) {
      resultRow._cellRef = rowAnchorCell;
    }
    if (rowNum) {
      resultRow._excelRow = rowNum;
    }

    return resultRow;
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
    riskSummary: tier0Context.risks || {},
    // Wave 1 (named-range audit) and Wave 2 (VBA/macro review) both run
    // deterministically before Tier 2 and already answer several test
    // questions skill.md's own test instructions previously described as
    // permanently unanswerable from Mode A data (no_circular_references,
    // calculation_settings, macros_documented, named_ranges_current,
    // no_hardcodes) — this data existed but was never threaded into the
    // Tier 2 payload. Kept deliberately compact (counts and names, not
    // full finding objects) to stay within the conciseness budget the
    // rest of this payload already follows.
    namedRangeSummary: tier0Context.namedRangeSummary || null,
    vbaSummary: tier0Context.vbaSummary || null
  };

  const estimatedTokens = Math.round(JSON.stringify(payload).length / 3);
  console.log(`   ${batchLabel}: ~${estimatedTokens} tokens input, ${batchRules.length} rules`);

  let rawText = '';
  const stream = await client.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 128000,   // Sonnet 5 ceiling on the synchronous Messages API.
                           // Was 64000, sized for the pre-Sonnet-5 tokenizer;
                           // the new tokenizer produces ~30% more tokens for
                           // the same output, which was silently truncating
                           // dense/numeric batches like Accounting & Debt.
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

  const finalMessage = await stream.finalMessage();
  const stopReason = finalMessage.stop_reason;
  const outputTokens = finalMessage.usage ? finalMessage.usage.output_tokens : null;

  console.log(`   ${batchLabel}: ${rawText.length} chars received` +
    (outputTokens ? ` (${outputTokens} output tokens, stop: ${stopReason})` : ''));

  if (stopReason === 'max_tokens') {
    console.log(`   \u26a0\ufe0f  ${batchLabel} hit the max_tokens ceiling \u2014 response was truncated, not malformed. Split the batch or raise max_tokens further.`);
  }

  try {
    return parseResponse(rawText);
  } catch (err) {
    dumpFailedResponse(batchLabel.replace(/[^a-zA-Z0-9]+/g, '_'), rawText, err);
    if (stopReason === 'max_tokens') {
      throw new Error(`${batchLabel} response truncated at ${outputTokens} output tokens (max_tokens ceiling reached) \u2014 not a parse error. Reduce batch size or raise max_tokens.`);
    }
    throw err;
  }
}

// Split tier2 rules into batches by section
function splitIntoBatches(rules) {
  // Batch 1 — Structure, inputs, formula mechanics
  const batch1Sections = ['S1', 'S2', 'S3', 'S4'];
  // Batch 2 — Accounting, debt, revenue, tax — the deep financial review batch
  // Gets full untrimmed financial statement data (see runTier2)
  const batch2Sections = ['S5', 'S6', 'S7', 'S10'];
  // Batch 3 — Scenarios, audit/governance, actuals, commercial completeness, governance
  const batch3Sections = ['S8', 'S9', 'S11', 'S12', 'S13'];

  const batch1 = rules.filter(r => batch1Sections.some(s => r.id.includes(`-${s}-`)));
  const batch2 = rules.filter(r => batch2Sections.some(s => r.id.includes(`-${s}-`)));
  const batch3 = rules.filter(r => batch3Sections.some(s => r.id.includes(`-${s}-`)));

  // Any rules not matched go to batch1
  const matched = new Set([...batch1.map(r => r.id), ...batch2.map(r => r.id), ...batch3.map(r => r.id)]);
  const unmatched = rules.filter(r => !matched.has(r.id));
  batch1.push(...unmatched);

  return { batch1, batch2, batch3 };
}

// Category/alias definitions for the deep-accounting data subset, plus a
// standalone resolver function — kept at module level (not inside
// runTier2) so index.js/server.js can call this same resolution
// independently (cheap, no LLM calls involved) to get the REAL resolved
// sheet names for the report's "Evidence Reviewed" text, without needing
// runTier2 itself to change its existing return shape (a plain array of
// findings, not an object — changing that would be a breaking change for
// every existing caller).
//
// Each category is a list of aliases, tried in order via resolveAny() —
// safer, fuller-word aliases first, short accounting abbreviations last.
// A short abbreviation like 'Cons' is unsafe as a sole target: confirmed
// on a real production file, 'Cons' silently matched an unrelated sheet
// named 'Construction Timeline', feeding a construction schedule into
// the accounting batch in place of a real cash flow statement, while the
// genuine Balance Sheet/P&L/Cashflow sheets were never matched at all.
const DEEP_ACCOUNTING_CATEGORIES = {
  'Balance Sheet':      ['Balance Sheet', 'Statement of Financial Position', 'SOFP', 'AFS', 'BS'],
  'Income Statement':   ['Profit and Loss', 'Profit & Loss', 'P&L', 'Income Statement', 'IFS', 'PnL'],
  'Cash Flow':          ['Cash Flow Statement', 'Cash Flow', 'Cashflow', 'CFS', 'Cons'],
  'Debt':               ['Debt Schedule', 'Debt Dashboard', 'Debt'],
  'Equity':             ['Equity Schedule', 'Equity Dashboard', 'Equity'],
  'Depreciation & Tax': ['Depreciation and Tax', 'Depreciation & Tax', 'Tax Schedule', 'D&T'],
  'Leases':             ['Lease Schedule', 'Leases', 'Lease'],
};

/**
 * Resolve the deep-accounting categories against a workbook's real sheet
 * names. Returns which real sheet name was matched for each category (or
 * absent if none), plus the list of categories that didn't resolve at
 * all — this is the real data the "Evidence Reviewed" column should
 * describe, replacing a static string in build_report.py that always
 * said "AFS/IFS/Cons/Debt/Equity/D&T/Leases" regardless of what sheets
 * were actually used for a given run.
 */
function resolveDeepAccountingSheets(sheetNames) {
  const resolvedMap = {};
  const unresolvedCategories = [];
  for (const [category, aliases] of Object.entries(DEEP_ACCOUNTING_CATEGORIES)) {
    const resolved = resolveAny(aliases, sheetNames);
    if (resolved) {
      resolvedMap[category] = resolved;
    } else {
      unresolvedCategories.push(category);
    }
  }
  return { resolvedMap, unresolvedCategories };
}

async function runTier2(parsed, { domain = '', modelContext = '', keySheets = null, tier0Stats = null, tier0Risks = null, namedRangeAudit = null, vbaReview = null } = {}) {
  // Fallback key-sheet categories used when the caller doesn't supply
  // keySheets (normally Familiarisation-derived) — e.g. when Familiarisation
  // itself failed to complete for this run. A flat, mining-style
  // abbreviation list matched via raw exact-key lookup (parsed.sheets[name])
  // with NO fuzzy resolution at all silently matches almost nothing on a
  // non-mining model — confirmed on a real production file where only
  // 'Inputs' and 'Debt' resolved out of seven targets.
  const KEY_SHEET_CATEGORIES = {
    'Cash Flow':        ['Cash Flow Statement', 'Cash Flow', 'Cashflow', 'CFS', 'Cons'],
    'Income Statement': ['Profit and Loss', 'Profit & Loss', 'P&L', 'Income Statement', 'IFS', 'PnL'],
    'Balance Sheet':    ['Balance Sheet', 'Statement of Financial Position', 'AFS', 'SOFP', 'BS'],
    'Inputs':           ['Inputs', 'Assumptions', 'Key Inputs'],
    'Debt':             ['Debt Schedule', 'Debt Dashboard', 'Debt'],
    'Operations':       ['Operations', 'Ops', 'Operating Assumptions'],
    'Equity':           ['Equity Schedule', 'Equity Dashboard', 'Equity'],
  };

  let sheetsToCheck;
  if (keySheets && keySheets.length > 0) {
    sheetsToCheck = keySheets;
  } else {
    sheetsToCheck = [];
    const unresolvedKeyCategories = [];
    for (const [category, aliases] of Object.entries(KEY_SHEET_CATEGORIES)) {
      const resolved = resolveAny(aliases, parsed.sheetNames);
      if (resolved) sheetsToCheck.push(resolved);
      else unresolvedKeyCategories.push(category);
    }
    if (unresolvedKeyCategories.length > 0) {
      console.log(`   ⚠️  Key-sheet fallback (Batches 1 & 3): no matching sheet for ${unresolvedKeyCategories.length} categor${unresolvedKeyCategories.length === 1 ? 'y' : 'ies'} — ${unresolvedKeyCategories.join(', ')}. This normally means Familiarisation did not supply keySheets for this run — check for an earlier Familiarisation error above.`);
    }
  }

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

  // ── Deep accounting data subset for Batch 2 (B5) ──────────────────────────
  // The accounting/debt/tax batch needs full, untrimmed financial statement
  // data — not the generic key_sheets sample. This gives Claude enough
  // evidence to actually test balance sheet roll-forwards, debt schedules,
  // and tax reconciliation rather than returning uncertain due to thin data.
  // Uses the module-level resolveDeepAccountingSheets() (defined above,
  // before this function) so index.js/server.js can call the exact same
  // resolution independently to get real sheet names for the report.
  const { resolvedMap, unresolvedCategories } = resolveDeepAccountingSheets(parsed.sheetNames);
  const deepDataSubset = {};
  for (const [category, sheetName] of Object.entries(resolvedMap)) {
    if (parsed.sheets[sheetName]) {
      // Use a higher row cap (40) and wider extraction for the deep batch
      deepDataSubset[sheetName] = extractMeaningfulRows(parsed.sheets[sheetName], 40);
    }
  }
  if (unresolvedCategories.length > 0) {
    console.log(`   ⚠️  Deep accounting subset: no matching sheet found for ${unresolvedCategories.length} categor${unresolvedCategories.length === 1 ? 'y' : 'ies'} — ${unresolvedCategories.join(', ')}. Batch 2 will run without this data; expect "uncertain" results on checks that depend on it. If this workbook has an equivalent sheet under a different name, add it as an alias to DEEP_ACCOUNTING_CATEGORIES in validator-tier2.js.`);
  }
  const deepTokens = Math.round(JSON.stringify(deepDataSubset).length / 3);
  console.log(`   Deep accounting data subset: ~${deepTokens} tokens across ${Object.keys(deepDataSubset).length} sheets`);
  if (deepTokens > 70000) {
    console.log('   Trimming deep accounting data to 25 rows per sheet...');
    for (const name of Object.keys(deepDataSubset)) {
      deepDataSubset[name] = deepDataSubset[name].slice(0, 25);
    }
  }

  const systemPrompt = buildSystemPrompt(domain, modelContext);
  const { batch1, batch2, batch3 } = splitIntoBatches(checklist.tier2);
  const allResults = [];
  let topLevelMeta = {};

  // Compact Wave 1 (named-range audit) and Wave 2 (VBA review) summaries —
  // built once here, from data Wave 1/2 already computed deterministically
  // before Tier 2 runs, and threaded into every batch via tier0Context
  // below. See the payload comment in runBatch() for why this exists.
  const namedRangeSummaryForPrompt = (namedRangeAudit && namedRangeAudit.applicable) ? {
    totalNamedRanges: namedRangeAudit.totalNamedRanges,
    brokenCount: (namedRangeAudit.broken || []).length,
    brokenNames: (namedRangeAudit.broken || []).map(b => b.name),
    unusedCount: (namedRangeAudit.unused || []).length,
  } : { note: 'Named range audit did not complete for this run — treat named_ranges_current as manual_only.' };

  const vbaSummaryForPrompt = (vbaReview && vbaReview.applicable) ? {
    hasVbaProject: vbaReview.hasVbaProject,
    moduleCount: vbaReview.moduleCount || 0,
    findingSummary: (vbaReview.findings || []).map(f => `${f.id}: ${f.label}`),
  } : { note: 'VBA review did not complete for this run — treat macros_documented and any VBA-dependent test as manual_only.' };

  // Reusable batch runner with consistent error handling
  async function runOneBatch(rules, data, label, errorIdPrefix) {
    if (rules.length === 0) return;
    try {
      const { results, meta } = await runBatch(
        rules, data, parsed.sheetNames, systemPrompt, label,
        { stats: tier0Stats, risks: tier0Risks, namedRangeSummary: namedRangeSummaryForPrompt, vbaSummary: vbaSummaryForPrompt }
      );
      allResults.push(...results);
      if (meta && (meta.audit_completion_percent !== undefined || meta.open_p1_count !== undefined) &&
          topLevelMeta.audit_completion_percent === undefined) {
        topLevelMeta = meta;
      }
    } catch (e) {
      console.error(`   ❌ ${label} error:`, e.message);
      allResults.push({
        id: `${errorIdPrefix}-ERROR`, status: 'uncertain', confidence: 0,
        priority: 'P2',
        category: 'Governance', method: 'automated',
        reason: `${label} could not complete: ${e.message}`,
        sheet: 'N/A', cell: 'A1', fixable: false,
        fix_instruction: 'Re-run the validation. If the error persists, reduce the model file size.',
        escalation_flag: false, needs_retest: false,
        condition: '', criteria: '', cause: '', consequence: '', corrective_action: '',
        periods_affected: [], dollar_impact: 'unquantified', root_cause: 'Validation error'
      });
    }
  }

  try {
    // ── Batch 1: Structure, Inputs, Formula mechanics (S1-S4) ────────────────
    await runOneBatch(batch1, dataSubset, 'Batch 1 — Structure (S1-S4)', 'T2-BATCH1');

    // ── Batch 2: Accounting, Debt, Revenue, Tax (S5-S7,S10) — DEEP DATA ──────
    // This is the B5 deep financial review batch. It receives full,
    // untrimmed AFS/IFS/Cons/Debt/Equity data so Claude has enough evidence
    // to test balance sheet roll-forwards, debt schedules, retained earnings,
    // and tax reconciliation with confidence rather than returning uncertain.
    await runOneBatch(batch2, deepDataSubset, 'Batch 2 — Accounting & Debt (S5-S7,S10)', 'T2-BATCH2');

    // ── Batch 3: Scenarios, Audit, Actuals, Commercial, Governance ───────────
    await runOneBatch(batch3, dataSubset, 'Batch 3 — Scenarios & Governance (S8-S9,S11-S13)', 'T2-BATCH3');

    // Normalise all results — ensure required fields exist
    const normalised = allResults.map(r => ({
      id:                       r.id || 'UNKNOWN',
      status:                   r.status || 'uncertain',
      confidence:               r.confidence ?? 0,
      priority:                 r.priority || 'P3',
      severity:                 r.severity || 'Medium',
      issue_type:               r.issue_type || '',
      workstream:               r.workstream || '',
      model_risk:               r.model_risk || '',
      key_output_impact:        r.key_output_impact || 'Unknown',
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
      needs_retest:             r.needs_retest ?? false,
      // Top-level meta fields (from overall assessment)
      _meta: topLevelMeta
    }));

    return normalised;

  } catch (e) {
    console.error('   ❌ Tier 2 fatal error:', e.message);
    return [{
      id: 'T2-ERROR', status: 'uncertain', confidence: 0,
      priority: 'P2',
      category: 'Governance', method: 'automated',
      reason: `Tier 2 validation could not complete: ${e.message}. Manual review required.`,
      sheet: 'N/A', cell: 'A1', fixable: false,
      fix_instruction: 'Tier 2 (Claude AI checks) did not complete. Re-run the validation or review the model manually.',
      escalation_flag: false, needs_retest: false,
      condition: '', criteria: '', cause: '', consequence: '', corrective_action: '',
      periods_affected: [], dollar_impact: 'unquantified', root_cause: 'Validation system error',
      _meta: {}
    }];
  }
}

module.exports = { runTier2, parseResponse, resolveDeepAccountingSheets };
