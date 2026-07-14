#!/usr/bin/env node
// tools/review-domains.js — the human review gate for draft domain skills.
//
// Scans config/domains/ for skill-{type}.draft.md files, runs
// eval-domain-skill.js's checks against each one (using the metadata
// sidecar domain-synthesiser.js saves alongside every draft), and lets a
// human approve (promote to the live config/skill-{type}.md) or reject
// (delete) each one. A draft NEVER reaches the live config/ location
// through any path except this tool — domain-synthesiser.js only ever
// writes to config/domains/.
//
// Usage:
//   node tools/review-domains.js                 List all drafts with eval results
//   node tools/review-domains.js --interactive    Walk through each draft, prompting approve/reject/skip
//   node tools/review-domains.js --approve NAME   Promote skill-NAME.draft.md to config/skill-NAME.md
//   node tools/review-domains.js --reject NAME    Delete skill-NAME.draft.md and its metadata

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { evalDomainSkillDraft } = require('../src/eval-domain-skill');

const configDir = path.join(__dirname, '..', 'config');
const draftsDir = path.join(configDir, 'domains');

function listDrafts() {
  if (!fs.existsSync(draftsDir)) return [];
  return fs.readdirSync(draftsDir)
    .filter(f => f.endsWith('.draft.md'))
    .map(f => f.replace(/\.draft\.md$/, '').replace(/^skill-/, ''));
}

function loadDraft(modelType) {
  const draftPath = path.join(draftsDir, `skill-${modelType}.draft.md`);
  const metaPath = path.join(draftsDir, `skill-${modelType}.draft.meta.json`);
  if (!fs.existsSync(draftPath)) {
    throw new Error(`No draft found for "${modelType}" at ${draftPath}`);
  }
  const draftContent = fs.readFileSync(draftPath, 'utf8');
  let meta = null;
  if (fs.existsSync(metaPath)) {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  }
  return { draftPath, metaPath, draftContent, meta };
}

function runEval(modelType) {
  const { draftContent, meta } = loadDraft(modelType);
  if (!meta) {
    console.log(`   ⚠️  No metadata sidecar found for "${modelType}" — running eval without weighting-guidance/residue checks.`);
    return evalDomainSkillDraft(draftContent, modelType, null, null);
  }
  return evalDomainSkillDraft(draftContent, modelType, meta.weightingGuidance, meta.structuralExampleDomain);
}

function printEvalReport(modelType, result) {
  console.log(`\n=== ${modelType} ===`);
  console.log(result.summary);
  if (result.failedCount > 0) {
    console.log('Failed checks:');
    result.checks.filter(c => !c.passed && !c.skipped).forEach(c => console.log(`   ✗ ${c.check}`));
  }
}

function approve(modelType) {
  const { draftPath, metaPath, draftContent } = loadDraft(modelType);
  const livePath = path.join(configDir, `skill-${modelType}.md`);
  if (fs.existsSync(livePath)) {
    console.log(`   ⚠️  config/skill-${modelType}.md already exists — refusing to overwrite. Remove it manually first if this is intentional.`);
    return false;
  }
  fs.writeFileSync(livePath, draftContent);
  fs.unlinkSync(draftPath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  console.log(`   ✅ Promoted to ${livePath}. classifier.js's loadDomainSkill() will pick this up on the next run classifying this model type — no restart needed, it's read from disk per run.`);
  return true;
}

function reject(modelType) {
  const { draftPath, metaPath } = loadDraft(modelType);
  fs.unlinkSync(draftPath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  console.log(`   🗑️  Rejected and removed draft for "${modelType}".`);
  return true;
}

async function interactiveReview() {
  const drafts = listDrafts();
  if (drafts.length === 0) {
    console.log('No drafts pending review in config/domains/.');
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));

  for (const modelType of drafts) {
    const result = runEval(modelType);
    printEvalReport(modelType, result);
    if (!result.readyForReview) {
      console.log('   This draft has failed checks above — recommend reject or manual fix before approving.');
    }
    const answer = (await ask(`   [${modelType}] Approve (a) / Reject (r) / Skip (s)? `)).trim().toLowerCase();
    if (answer === 'a') approve(modelType);
    else if (answer === 'r') reject(modelType);
    else console.log('   Skipped — left as-is for next time.');
  }
  rl.close();
}

// ── CLI entry point ─────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--approve')) {
  const name = args[args.indexOf('--approve') + 1];
  if (!name) { console.error('Usage: --approve <modelType>'); process.exit(2); }
  const result = runEval(name);
  printEvalReport(name, result);
  approve(name);
} else if (args.includes('--reject')) {
  const name = args[args.indexOf('--reject') + 1];
  if (!name) { console.error('Usage: --reject <modelType>'); process.exit(2); }
  reject(name);
} else if (args.includes('--interactive')) {
  interactiveReview();
} else {
  // Default: list all drafts with their eval results, no action taken.
  const drafts = listDrafts();
  if (drafts.length === 0) {
    console.log('No drafts pending review in config/domains/.');
  } else {
    console.log(`${drafts.length} draft(s) pending review:`);
    for (const modelType of drafts) {
      printEvalReport(modelType, runEval(modelType));
    }
    console.log('\nRun with --interactive to approve/reject, or --approve <type> / --reject <type> directly.');
  }
}

module.exports = { listDrafts, runEval, approve, reject };
