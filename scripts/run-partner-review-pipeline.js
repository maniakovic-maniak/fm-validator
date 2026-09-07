#!/usr/bin/env node
// Chains the full, real Partner Review pipeline for one engagement:
//   1. Export the model's data (fm-validator's own script)
//   2. Extract the completed report (fm-validator's own script)
//   3. Run the actual engagement (Partner Review's own orchestration)
//
// Usage:
//   node scripts/run-partner-review-pipeline.js <orderId> <modelFilePath> <reportFilePath>
//
// This is what admin/server.js spawns as a single background process -
// keeps the admin server's own logic simple (one spawn call), and can
// also be run manually for testing.

const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');

const PARTNER_REVIEW_PATH = process.env.PARTNER_REVIEW_PATH || path.join(require('os').homedir(), 'partner-review');

const [orderId, modelFilePath, reportFilePath] = process.argv.slice(2);
if (!orderId || !modelFilePath || !reportFilePath) {
  console.error('Usage: node scripts/run-partner-review-pipeline.js <orderId> <modelFilePath> <reportFilePath>');
  process.exit(1);
}

const engagementId = `PR-${orderId}`;
const workDir = path.join(require('os').tmpdir(), `partner-review-${orderId}`);
fs.mkdirSync(workDir, { recursive: true });
const exportPath = path.join(workDir, 'export.json');
const reportJsonPath = path.join(workDir, 'report.json');

// Same cross-repo require pattern already established in admin/server.js -
// gracefully unavailable rather than a hard crash, since this is only
// used to record a real failure, not required for the pipeline's own
// core steps to run.
let updateEngagementStatus = null;
try {
  ({ updateEngagement: updateEngagementStatus } = require(path.join(PARTNER_REVIEW_PATH, 'src', 'engagement-store')));
} catch (_) { /* best-effort only - see failAndExit below */ }

function failAndExit(message) {
  console.error(`[${engagementId}] ${message}`);
  if (updateEngagementStatus) {
    try { updateEngagementStatus(engagementId, { status: 'failed', error: message }); } catch (_) { /* genuinely nothing more we can do here */ }
  }
  process.exit(1);
}

function logStep(label) {
  console.log(`[${engagementId}] ${label}...`);
}

// Step 1 - real export, written directly to a real file (not captured
// via stdout piping alone, to avoid any risk of a large model's output
// being truncated by an intermediate buffer).
// Real, genuine bug found via direct debugging: Node's default spawnSync
// output buffer is only 1MB, but the real export output for even a
// mid-sized model already exceeds that (confirmed: 3.5MB for RIIO-GT1) -
// silently truncating to exactly 1MB with an ENOBUFS error rather than a
// clear failure. Set explicitly large for both calls that capture
// substantial stdout.
const LARGE_BUFFER = 200 * 1024 * 1024; // 200MB - comfortably covers even the largest real models

logStep('Exporting model data');
const exportResult = spawnSync('node', [path.join(__dirname, 'export-for-partner-review.js'), modelFilePath, orderId], { encoding: 'utf8', maxBuffer: LARGE_BUFFER });
if (exportResult.status !== 0) failAndExit(`Export failed: ${exportResult.error || exportResult.stderr}`);
fs.writeFileSync(exportPath, exportResult.stdout);
console.error(exportResult.stderr);

// Step 2 - real report extraction, same pattern.
logStep('Extracting the completed report');
const reportResult = spawnSync('python3', [path.join(__dirname, 'extract_report_for_partner_review.py'), reportFilePath], { encoding: 'utf8', maxBuffer: LARGE_BUFFER });
if (reportResult.status !== 0) failAndExit(`Report extraction failed: ${reportResult.error || reportResult.stderr}`);
fs.writeFileSync(reportJsonPath, reportResult.stdout);
console.error(reportResult.stderr);

// Step 3 - the actual engagement, run from Partner Review's own repo.
logStep('Running the real engagement (Phase A -> freeze -> Phase B)');
const engagementResult = spawnSync(
  'node', ['--env-file=.env', 'run-engagement.js', engagementId, orderId, exportPath, reportJsonPath],
  { cwd: PARTNER_REVIEW_PATH, encoding: 'utf8', stdio: 'inherit' }
);
// A non-zero exit here can mean run-engagement.js's own code genuinely
// ran and already recorded a real, specific failure itself (in which
// case this is redundant but harmless) - OR it can mean the process
// never even started at all (a missing .env, a missing node binary,
// etc.), in which case nothing else would ever have recorded this
// failure, and the engagement would otherwise stay silently,
// permanently stuck at "queued" forever.
if (engagementResult.status !== 0) failAndExit(`The engagement process itself failed to complete (exit code ${engagementResult.status}): ${engagementResult.error || 'see above output'}`);

process.exit(0);
