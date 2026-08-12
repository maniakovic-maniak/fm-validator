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
  const verificationPath = path.join(draftsDir, `skill-${modelType}.draft.verification.json`);
  const checklistAdditionsPath = path.join(draftsDir, `skill-${modelType}.draft.checklist-additions.json`);
  if (!fs.existsSync(draftPath)) {
    throw new Error(`No draft found for "${modelType}" at ${draftPath}`);
  }
  const draftContent = fs.readFileSync(draftPath, 'utf8');
  let meta = null;
  if (fs.existsSync(metaPath)) {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  }
  let verification = null;
  if (fs.existsSync(verificationPath)) {
    verification = JSON.parse(fs.readFileSync(verificationPath, 'utf8'));
  }
  let checklistAdditions = undefined;
  if (fs.existsSync(checklistAdditionsPath)) {
    checklistAdditions = JSON.parse(fs.readFileSync(checklistAdditionsPath, 'utf8'));
  }
  return { draftPath, metaPath, verificationPath, checklistAdditionsPath, draftContent, meta, verification, checklistAdditions };
}

function runEval(modelType) {
  const { draftContent, meta, checklistAdditions } = loadDraft(modelType);
  if (!meta) {
    console.log(`   ⚠️  No metadata sidecar found for "${modelType}" — running eval without weighting-guidance/residue checks.`);
    return evalDomainSkillDraft(draftContent, modelType, null, null, checklistAdditions, undefined);
  }
  return evalDomainSkillDraft(draftContent, modelType, meta.weightingGuidance, meta.structuralExampleDomain, checklistAdditions, meta.sourceSheetNames);
}

function printEvalReport(modelType, result) {
  console.log(`\n=== ${modelType} ===`);
  console.log(result.summary);
  if (result.failedCount > 0) {
    console.log('Failed checks:');
    result.checks.filter(c => !c.passed && !c.skipped).forEach(c => console.log(`   ✗ ${c.check}`));
  }
}

function printVerificationReport(verification) {
  if (!verification) {
    console.log('   ℹ️  No source-verification report yet (still running, or drafted before this feature existed).');
    return;
  }
  if (!verification.applicable) {
    console.log(`   ⚠️  Source verification did not complete: ${verification.error}`);
    return;
  }
  console.log(`   Source verification: ${verification.summary}`);
  const contradicted = verification.claims.filter(c => c.verdict === 'contradicted');
  if (contradicted.length > 0) {
    console.log('   ⚠️  CONTRADICTED claims — review before approving:');
    contradicted.forEach(c => {
      console.log(`      • "${c.claim}"`);
      console.log(`        ${c.note}${c.source_description ? ` (Tier ${c.source_tier}: ${c.source_description})` : ''}`);
    });
  }
}

function approve(modelType) {
  const { draftPath, metaPath, checklistAdditionsPath, draftContent, checklistAdditions } = loadDraft(modelType);
  const livePath = path.join(configDir, `skill-${modelType}.md`);
  if (fs.existsSync(livePath)) {
    console.log(`   ⚠️  config/skill-${modelType}.md already exists — refusing to overwrite. Remove it manually first if this is intentional.`);
    return false;
  }

  // FIX: merge the staged checklist-additions sidecar into the live
  // checklist.json as part of the same approval action — closes the
  // gap this session found manually, twice, for mining and property:
  // a draft with graded tests but no registered rules is not actually
  // deployable, and previously nothing in this flow did anything about
  // that until a human noticed and built the fix by hand.
  if (checklistAdditions && checklistAdditions.length > 0) {
    const checklistPath = path.join(configDir, 'checklist.json');
    const checklist = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));
    const existingIds = new Set(checklist.tier2.map(r => r.id));
    const collisions = checklistAdditions.filter(r => existingIds.has(r.id));
    if (collisions.length > 0) {
      console.log(`   ⚠️  ${collisions.length} checklist ID(s) already exist in checklist.json (${collisions.map(r => r.id).join(', ')}) — refusing to merge. Resolve manually before approving.`);
      return false;
    }
    checklist.tier2.push(...checklistAdditions);
    fs.writeFileSync(checklistPath, JSON.stringify(checklist, null, 2));
    console.log(`   ✅ Merged ${checklistAdditions.length} new rule(s) into checklist.json (now ${checklist.tier2.length} Tier 2 rules).`);
  }

  fs.writeFileSync(livePath, draftContent);
  fs.unlinkSync(draftPath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  if (fs.existsSync(checklistAdditionsPath)) fs.unlinkSync(checklistAdditionsPath);
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
    const { verification } = loadDraft(modelType);
    const result = runEval(modelType);
    printEvalReport(modelType, result);
    printVerificationReport(verification);
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
  const { verification } = loadDraft(name);
  const result = runEval(name);
  printEvalReport(name, result);
  printVerificationReport(verification);
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
      const { verification } = loadDraft(modelType);
      printEvalReport(modelType, runEval(modelType));
      printVerificationReport(verification);
    }
    console.log('\nRun with --interactive to approve/reject, or --approve <type> / --reject <type> directly.');
  }
}

module.exports = { listDrafts, runEval, approve, reject };
