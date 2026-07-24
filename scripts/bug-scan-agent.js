#!/usr/bin/env node
// bug-scan-agent.js — a mini code-review agent that runs after every
// commit (see .githooks/post-commit), reviews just the files that
// commit changed, and reports genuine bugs it finds — never fixing
// anything automatically. A fix is only ever applied via a separate,
// explicit `--apply <N>` invocation, which shows the exact diff and
// asks for a plain y/n confirmation before touching any file.

require('dotenv').config(); // FIX: index.js/server.js both do this at
// startup so ANTHROPIC_API_KEY (and anything else in .env) is available
// to the rest of the pipeline — this script runs standalone via a git
// hook or directly from the shell, neither of which sources .env on
// its own, so without this line the key was only ever picked up if it
// happened to already be exported in the shell's own environment.
// Found via a real run: "Could not resolve authentication method."
//
// Usage:
//   node scripts/bug-scan-agent.js              — scan the last commit's changed files
//   node scripts/bug-scan-agent.js --scan <ref>  — scan files changed since <ref> instead of HEAD~1
//   node scripts/bug-scan-agent.js --apply <N>   — review and (with confirmation) apply finding #N
//   node scripts/bug-scan-agent.js --list        — re-print the last scan's findings without re-scanning
//
// Design choices, and why:
// - Scoped to files the commit actually touched, not the whole repo —
//   the point is "did this deployment just introduce a bug", not a full
//   audit (that's a separate, much larger task, not this tool's job).
// - Findings are cached to disk (FINDINGS_CACHE_PATH) precisely so scan
//   and apply can be two separate commands, run at different times, by
//   a human deciding in between — the permission gate is real, not
//   theatre, because the apply step cannot run without the human
//   explicitly invoking it and then explicitly confirming.
// - old_code/new_code are required to be exact, unique substrings of
//   the file (the same str_replace discipline used throughout this
//   project's own development) — this is what makes an automated apply
//   safe: it either matches exactly once, or it refuses and says so,
//   never guessing.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const REPO_ROOT = path.join(__dirname, '..');
const FINDINGS_CACHE_PATH = path.join(REPO_ROOT, '.bug-scan-findings.json');

// Extensions worth reviewing. Deliberately excludes generated/vendor
// content and the project's own .xlsx report outputs.
const REVIEWABLE_EXTENSIONS = new Set(['.js', '.py']);

function getChangedFiles(sinceRef) {
  const ref = sinceRef || 'HEAD~1';
  let raw;
  try {
    raw = execSync(`git diff --name-only ${ref} HEAD`, { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (e) {
    // HEAD~1 doesn't exist yet (e.g. the very first commit in the repo) —
    // treat that as "nothing to compare against yet", not a hard error.
    console.log(`   (Could not diff against ${ref} — likely the first commit in the repo. Nothing to scan yet.)`);
    return [];
  }
  return raw.split('\n')
    .map(f => f.trim())
    .filter(Boolean)
    .filter(f => REVIEWABLE_EXTENSIONS.has(path.extname(f)))
    .filter(f => fs.existsSync(path.join(REPO_ROOT, f))); // skip files the commit deleted
}

function buildReviewPrompt(files) {
  const fileBlocks = files.map(f => {
    const content = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
    return `<file path="${f}">\n${content}\n</file>`;
  }).join('\n\n');

  return `You are reviewing code that was just committed to a financial-model-audit tool, looking ONLY for genuine bugs — not style preferences, not subjective opinions, not things that merely could be written differently. A "bug" here means: a logic error, an undefined/null reference risk, an off-by-one, a broken or stale reference to a function/field/file that no longer exists or was renamed, inconsistent behavior between two places that are supposed to agree, a race condition, or a case that will silently produce a wrong result rather than an error.

If you find nothing wrong, return an empty bugs array — do not invent minor nitpicks to seem useful. It is normal and expected for most scans to return zero bugs.

For each genuine bug found, you MUST provide old_code as an EXACT, VERBATIM, UNIQUE substring of the file it comes from (copy it exactly, whitespace and all) — this will be used for an automated, literal string-replacement fix, so it must match the file's actual content precisely and must not appear more than once in that file.

Respond with ONLY a JSON object in this exact shape, no other text:
{
  "bugs": [
    {
      "file": "path/as/shown/above",
      "severity": "high" | "medium" | "low",
      "description": "what the bug is and why it's a problem",
      "old_code": "exact verbatim unique substring to replace",
      "new_code": "the corrected replacement"
    }
  ]
}

Files changed in this commit:

${fileBlocks}`;
}

async function scanChangedFiles(sinceRef) {
  const files = getChangedFiles(sinceRef);
  if (files.length === 0) {
    console.log('   No reviewable files (.js/.py) changed in this commit — nothing to scan.');
    saveFindings([], []);
    return;
  }
  console.log(`   Reviewing ${files.length} changed file(s): ${files.join(', ')}`);

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment, same as validator-tier2.js

  const prompt = buildReviewPrompt(files);
  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  let parsed;
  try {
    // Claude may wrap the JSON in a code fence despite instructions --
    // strip that defensively rather than fail the whole scan over it.
    const cleaned = rawText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('   \u26a0\ufe0f  Could not parse the review response as JSON — printing raw output instead:');
    console.error(rawText);
    return;
  }

  const bugs = Array.isArray(parsed.bugs) ? parsed.bugs : [];
  saveFindings(files, bugs);
  printFindings(bugs);
}

function saveFindings(files, bugs) {
  fs.writeFileSync(FINDINGS_CACHE_PATH, JSON.stringify({ scannedAt: new Date().toISOString(), files, bugs }, null, 2));
}

function loadFindings() {
  if (!fs.existsSync(FINDINGS_CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(FINDINGS_CACHE_PATH, 'utf8'));
  } catch (e) {
    return null;
  }
}

function printFindings(bugs) {
  if (bugs.length === 0) {
    console.log('   \u2705 No bugs found in the files this commit changed.');
    return;
  }
  console.log(`\n   \u26a0\ufe0f  ${bugs.length} potential bug(s) found:\n`);
  bugs.forEach((b, i) => {
    console.log(`   [${i + 1}] ${b.severity.toUpperCase()} — ${b.file}`);
    console.log(`       ${b.description}`);
    console.log('');
  });
  console.log(`   Nothing has been changed. To review and apply a specific fix:`);
  console.log(`     node scripts/bug-scan-agent.js --apply <N>`);
  console.log(`   To re-print this list without re-scanning:`);
  console.log(`     node scripts/bug-scan-agent.js --list`);
}

async function applyFinding(n) {
  const cached = loadFindings();
  if (!cached || !Array.isArray(cached.bugs) || cached.bugs.length === 0) {
    console.log('   No cached findings to apply. Run a scan first: node scripts/bug-scan-agent.js');
    return;
  }
  const bug = cached.bugs[n - 1];
  if (!bug) {
    console.log(`   No finding #${n}. There ${cached.bugs.length === 1 ? 'is' : 'are'} ${cached.bugs.length} finding(s) cached.`);
    return;
  }

  const filePath = path.join(REPO_ROOT, bug.file);
  if (!fs.existsSync(filePath)) {
    console.log(`   ${bug.file} no longer exists — cannot apply this fix.`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const occurrences = content.split(bug.old_code).length - 1;
  if (occurrences === 0) {
    console.log(`   The exact code this finding refers to no longer appears in ${bug.file} — it may already be fixed, or the file has changed since the scan. Refusing to guess; re-scan to get current findings.`);
    return;
  }
  if (occurrences > 1) {
    console.log(`   The code this finding refers to appears ${occurrences} times in ${bug.file}, not once — refusing to apply, since a literal replacement would be ambiguous. This needs a manual fix.`);
    return;
  }

  console.log(`\n   [${n}] ${bug.severity.toUpperCase()} — ${bug.file}`);
  console.log(`   ${bug.description}\n`);
  console.log('   --- current ---');
  console.log('   ' + bug.old_code.split('\n').join('\n   '));
  console.log('   --- proposed ---');
  console.log('   ' + bug.new_code.split('\n').join('\n   '));
  console.log('');

  const confirmed = await askYesNo('   Apply this fix? (y/n) ');
  if (!confirmed) {
    console.log('   Not applied.');
    return;
  }

  const updated = content.replace(bug.old_code, bug.new_code);
  fs.writeFileSync(filePath, updated);
  console.log(`   \u2705 Applied to ${bug.file}. Review the change and commit it yourself when ready — this tool does not commit on your behalf.`);
}

function askYesNo(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  console.log('\u2550'.repeat(55));
  console.log('  fm-validator bug-scan agent');
  console.log('\u2550'.repeat(55) + '\n');

  if (args[0] === '--apply') {
    const n = parseInt(args[1], 10);
    if (!n) { console.log('   Usage: node scripts/bug-scan-agent.js --apply <N>'); process.exit(1); }
    await applyFinding(n);
  } else if (args[0] === '--list') {
    const cached = loadFindings();
    if (!cached) { console.log('   No cached findings. Run a scan first: node scripts/bug-scan-agent.js'); return; }
    console.log(`   Findings from scan at ${cached.scannedAt} (files: ${cached.files.join(', ') || 'none'}):`);
    printFindings(cached.bugs);
  } else if (args[0] === '--scan') {
    await scanChangedFiles(args[1]);
  } else {
    await scanChangedFiles();
  }
}

main().catch(e => {
  console.error('   \u26a0\ufe0f  bug-scan-agent error:', e.message);
  // Deliberately exits 0, not 1 — this is an informational tool, not a
  // deploy gate (unlike pre-deploy-check.js). A scan failure (e.g. no
  // API key configured, a transient network error) should never block
  // or appear to block a commit that has already happened.
  process.exit(0);
});
// test comment
