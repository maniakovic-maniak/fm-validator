const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { buildPhaseASystemPrompt, buildPhaseBSystemPrompt } = require('./prompts');
const { PHASE_A_OUTPUT_SCHEMA } = require('./finding-schema');

const ENGAGEMENTS_DIR = path.join(__dirname, '..', 'engagements');
if (!fs.existsSync(ENGAGEMENTS_DIR)) fs.mkdirSync(ENGAGEMENTS_DIR, { recursive: true });

function getClient() {
  // Deliberately constructed fresh per call, not module-level - avoids
  // silently capturing a stale/missing key if this module is required
  // before the environment variable is actually set.
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Phase A - blind independent review. Accepts an array of batches
 * (per the real, necessary batching decision - a full model's genuine
 * formula+text export is far too large for a single call). Calls
 * OpenAI once per batch, accumulating findings across all of them.
 * Each individual call still only ever sees that batch's model data -
 * never fm-validator's report, regardless of how many calls this
 * takes; the blind boundary is about content, not call count.
 */
async function runPhaseA(engagementId, modelDataBatches) {
  const client = getClient();
  const batches = Array.isArray(modelDataBatches) ? modelDataBatches : [modelDataBatches];
  let modelUnderstanding = '';
  const allFindings = [];

  for (let i = 0; i < batches.length; i++) {
    console.log(`Phase A - batch ${i + 1}/${batches.length}...`);
    const response = await client.responses.create({
      model: 'gpt-5.2',
      instructions: buildPhaseASystemPrompt(),
      input: `Here is batch ${i + 1} of ${batches.length} of the parsed model data to review:\n\n${JSON.stringify(batches[i])}`,
      tools: [{ type: 'web_search_preview' }],
      text: { format: PHASE_A_OUTPUT_SCHEMA },
    });
    const result = JSON.parse(response.output_text);
    if (result.modelUnderstanding) modelUnderstanding = modelUnderstanding
      ? `${modelUnderstanding}\n\n(Batch ${i + 1}): ${result.modelUnderstanding}`
      : result.modelUnderstanding;
    allFindings.push(...result.findings);
  }

  return { modelUnderstanding, findings: allFindings };
}

/**
 * The freeze - writes Phase A's output to disk, immutably, before Phase B
 * is ever invoked. This file is the ONLY channel through which Phase B
 * can ever learn what Phase A found - see runPhaseB below, which takes a
 * file path, never the findings object directly.
 */
function freezePhaseA(engagementId, findings) {
  const frozenPath = path.join(ENGAGEMENTS_DIR, `${engagementId}-phase-a-frozen.json`);
  // 'wx' - refuses to overwrite an existing frozen file. Once frozen,
  // Phase A's findings for this engagement are genuinely immutable; a
  // second attempt to freeze the same engagement id is a real error,
  // not a silent overwrite - matching Constitution Article 2's "must be
  // frozen before comparison" as a hard, not a soft, rule.
  fs.writeFileSync(frozenPath, JSON.stringify({ engagementId, frozenAt: new Date().toISOString(), findings }, null, 2), { flag: 'wx' });
  return frozenPath;
}

/**
 * Phase B - reveal and compare. Deliberately typed to accept a
 * *filesystem path* to the frozen Phase A output, not the findings
 * object itself directly - this is what makes the boundary a genuine
 * code-level constraint, not just a prompting convention. There is no
 * code path by which Phase B can be handed Phase A's in-memory result
 * before it was written to disk.
 */
async function runPhaseB(frozenPhaseAPath, fmValidatorReportData, visibilityRecord = null) {
  const frozen = JSON.parse(fs.readFileSync(frozenPhaseAPath, 'utf8'));
  const client = getClient();
  const inputParts = [
    'Your own, already-frozen Phase A findings:',
    JSON.stringify(frozen.findings),
    '',
    'The completed audit to compare against:',
    JSON.stringify(fmValidatorReportData),
  ];
  if (visibilityRecord) {
    inputParts.push(
      '',
      'The completed audit\'s own real data-visibility record for this run ' +
      '(exactly which sheets/rows it actually had access to - use this to ' +
      'distinguish a genuine miss from a visibility gap, per your ' +
      'instructions above):',
      JSON.stringify(visibilityRecord)
    );
  } else {
    inputParts.push('', 'No visibility record was provided for this run.');
  }
  const response = await client.responses.create({
    model: 'gpt-5.2',
    instructions: buildPhaseBSystemPrompt(),
    input: inputParts.join('\n'),
    tools: [{ type: 'web_search_preview' }],
  });

  return response.output_text;
}

module.exports = { runPhaseA, freezePhaseA, runPhaseB, ENGAGEMENTS_DIR };
