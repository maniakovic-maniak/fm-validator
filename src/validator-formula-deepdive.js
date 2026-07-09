// Formula Deep Dive — orchestration. Reuses the exact API-call pattern
// already proven in validator-tier2.js's runBatch (streaming, stop_reason
// handling, dumpFailedResponse on parse failure) rather than a second,
// slightly-different copy of the same logic.
//
// OPT-IN — call this only when explicitly requested (see ENABLE_FORMULA_
// DEEPDIVE in the entry points). It is an additional-cost review beyond
// the standard run, not part of the default pipeline.

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { parseResponse } = require('./validator-tier2');
const { dumpFailedResponse } = require('./utils/dump-failed-response');
const {
  selectHighRiskFormulas, attachLabels, buildReviewItems, estimateInputTokens
} = require('./utils/formula-deepdive-select');

const client = new Anthropic();

const soulPath  = path.join(__dirname, '../config/soul.md');
const taskPath  = path.join(__dirname, '../config/skill-formula-deepdive.md');
function SOUL() { return fs.existsSync(soulPath) ? fs.readFileSync(soulPath, 'utf8') : ''; }
function TASK() { return fs.existsSync(taskPath) ? fs.readFileSync(taskPath, 'utf8') : ''; }

/**
 * @param {object} parsed        the standard parsed-workbook object (needs ._raw)
 * @param {object} tier0Result   Tier 0's full result — uses .uniqueFormulas
 * @param {object} opts          { topN, minFscore, domain } — domain (a
 *   short domain-skill excerpt) is optional context, same spirit as the
 *   main Tier 2 call, but not required for this task.
 */
async function runFormulaDeepDive(parsed, tier0Result, opts = {}) {
  const taskPrompt = TASK();
  if (!taskPrompt) {
    const msg = `Formula Deep Dive task prompt not found at ${taskPath} — refusing to run rather than send Claude an incomplete prompt with no task instructions. Check the file was deployed alongside this code.`;
    console.error('   \u26a0\ufe0f  ' + msg);
    return { applicable: false, reviewed: 0, findings: [], note: msg };
  }

  const uniqueFormulas = (tier0Result && tier0Result.uniqueFormulas) || [];
  const selected = selectHighRiskFormulas(uniqueFormulas, opts.topN, opts.minFscore);

  if (selected.length === 0) {
    return { applicable: false, reviewed: 0, findings: [], note: 'No formulas met the minimum complexity threshold for deep review.' };
  }

  const labelled = attachLabels(parsed._raw, selected);
  const items = buildReviewItems(labelled);

  const systemPrompt = [SOUL(), taskPrompt].filter(Boolean).join('\n\n---\n\n');
  const estTokens = estimateInputTokens(items, systemPrompt.length);
  console.log(`   Formula Deep Dive: ~${estTokens} tokens input, ${items.length} formulas selected (F-score >= ${opts.minFscore || 4})`);

  let rawText = '';
  const stream = await client.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 32000,   // far smaller than the main batches — this task
                          // reviews at most ~40 compact records, not full
                          // financial-statement data subsets.
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: JSON.stringify({ formulas: items }) }]
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta && chunk.delta.type === 'text_delta') {
      rawText += chunk.delta.text;
    }
  }

  const finalMessage = await stream.finalMessage();
  const stopReason = finalMessage.stop_reason;
  const outputTokens = finalMessage.usage ? finalMessage.usage.output_tokens : null;
  console.log(`   Formula Deep Dive: ${rawText.length} chars received` +
    (outputTokens ? ` (${outputTokens} output tokens, stop: ${stopReason})` : ''));

  let parsed_response;
  try {
    parsed_response = parseResponse(rawText);
  } catch (err) {
    dumpFailedResponse('formula_deep_dive', rawText, err);
    throw err;
  }

  const results = parsed_response.results || [];
  const findings = results.filter(r => r.status === 'fail' || r.status === 'uncertain');

  return {
    applicable: true,
    reviewed: items.length,
    passed: results.filter(r => r.status === 'pass').length,
    findings,
    allResults: results,
    note: `Deep individual review of the ${items.length} highest-complexity formula patterns (Tier 0 F-score ranked). This is a targeted sample, not full coverage — see the Scope and Reliance tab.`
  };
}

module.exports = { runFormulaDeepDive };
