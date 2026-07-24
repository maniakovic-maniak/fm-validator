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
//   node scripts/bug-scan-agent.js --all         — scan EVERY tracked .js/.py file in the repo, batched (slower, real API cost — not the routine post-commit mode)
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

// Every tracked .js/.py file in the repo — `git ls-files` rather than a
// filesystem walk specifically because it respects .gitignore
// automatically (no separate node_modules/logs/uploads exclusion list
// to keep in sync by hand) and only returns files actually tracked by
// the project, not stray untracked scratch files.
function getAllReviewableFiles() {
  const raw = execSync('git ls-files', { cwd: REPO_ROOT, encoding: 'utf8' });
  return raw.split('\n')
    .map(f => f.trim())
    .filter(Boolean)
    .filter(f => REVIEWABLE_EXTENSIONS.has(path.extname(f)))
    .filter(f => fs.existsSync(path.join(REPO_ROOT, f)));
}

// ── Dependency-aware batching ────────────────────────────────────────────
// Plain size-based batching (walking files in git ls-files' alphabetical
// order) has a real, confirmed limitation: two files with a genuine
// producer/consumer relationship — one calling a function from the
// other, or a JS file invoking a specific Python script via execFile —
// can easily land in different batches purely because of where they
// fall alphabetically, meaning Claude reviewing one has zero visibility
// into the other. This is exactly the class of bug that mattered most
// this session (a function's actual return shape not matching what its
// caller assumed, a field silently dropped by a bridge file in
// between). The fix: build a real (lightweight) dependency graph from
// require() calls and Python-script invocations, then walk files in
// graph-proximity (BFS) order rather than alphabetical order before
// handing them to the existing size-based batcher — so related files
// end up adjacent in the sequence, and therefore much more likely to
// co-occur in the same batch, without needing to force an entire
// (potentially huge) connected component into one giant batch.

// Extracts the local files one JS file depends on: relative require()
// targets, resolved to a repo-relative path, plus any .py filename
// referenced as a string literal anywhere in the file (deliberately
// broad rather than fully parsing execFile/spawn call syntax — the
// goal is linking the JS file to the Python script it invokes, not a
// complete call-graph).
function parseLocalRequires(repoRelPath) {
  const content = fs.readFileSync(path.join(REPO_ROOT, repoRelPath), 'utf8');
  const deps = new Set();
  const dir = path.dirname(repoRelPath);

  const requireRe = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m;
  while ((m = requireRe.exec(content))) {
    let resolved = path.normalize(path.join(dir, m[1]));
    if (!resolved.endsWith('.js')) resolved += '.js';
    if (fs.existsSync(path.join(REPO_ROOT, resolved))) deps.add(resolved);
  }

  const pyRe = /['"]([\w./-]+\.py)['"]/g;
  while ((m = pyRe.exec(content))) {
    const raw = m[1];
    for (const candidate of [path.normalize(path.join(dir, raw)), path.normalize(raw)]) {
      if (fs.existsSync(path.join(REPO_ROOT, candidate))) { deps.add(candidate); break; }
    }
  }
  return [...deps];
}

// Builds an undirected graph (a producer/consumer relationship matters
// for review purposes regardless of which direction the require()
// points) over just the given file set — a file requiring something
// outside that set (e.g. an npm package, or a file excluded from this
// scan) correctly produces no edge.
function buildDependencyGraph(files) {
  const graph = new Map();
  for (const f of files) graph.set(f, new Set());
  for (const f of files) {
    if (path.extname(f) !== '.js') continue; // only JS files have parseable requires here
    for (const d of parseLocalRequires(f)) {
      if (!graph.has(d)) continue;
      graph.get(f).add(d);
      graph.get(d).add(f);
    }
  }
  return graph;
}

// Re-orders files via BFS so graph-adjacent files end up sequence-
// adjacent, starting from index.js/server.js (the two real entry
// points) so their most immediate dependencies get priority placement,
// then continuing from every remaining unvisited file so nothing is
// dropped.
function orderByDependencyProximity(files, graph) {
  const visited = new Set();
  const ordered = [];
  const entryPoints = files.filter(f => /^(index|server)\.js$/.test(f));
  for (const start of [...entryPoints, ...files]) {
    if (visited.has(start)) continue;
    const queue = [start];
    while (queue.length > 0) {
      const f = queue.shift();
      if (visited.has(f)) continue;
      visited.add(f);
      ordered.push(f);
      for (const neighbor of (graph.get(f) || [])) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
  }
  return ordered;
}

// Builds, for a single batch, a small human-readable map of which
// files in that batch require which other files ALSO in that batch —
// included directly in the review prompt so Claude has explicit
// knowledge of the relationship rather than needing to infer it from
// reading two files' worth of code.
function describeInBatchDependencies(batch, graph) {
  const batchSet = new Set(batch);
  const lines = [];
  for (const f of batch) {
    const relevant = [...(graph.get(f) || [])].filter(d => batchSet.has(d));
    if (relevant.length > 0) lines.push(`${f} depends on: ${relevant.join(', ')}`);
  }
  return lines;
}

// Groups files into batches by cumulative character count, not just
// file count — a handful of large files (index.js, server.js,
// build_report.py) can each individually be 5-10x the size of most
// utility files, so a fixed files-per-batch count would produce wildly
// uneven, sometimes-too-large batches. ~50,000 characters per batch
// (~16-17K tokens) matches the rough scale of validator-tier2.js's own
// existing batches, leaving real headroom for the response.
const MAX_BATCH_CHARS = 50000;

function batchFiles(files, graph) {
  // Walk files in dependency-proximity order rather than the raw
  // (alphabetical) order they were passed in, when a graph is
  // supplied — a plain incremental scan of 1-4 changed files doesn't
  // pass a graph at all, since proximity ordering only matters once
  // there's more than a handful of files to potentially split across
  // batch boundaries.
  const orderedFiles = graph ? orderByDependencyProximity(files, graph) : files;
  const batches = [];
  let current = [];
  let currentChars = 0;
  for (const f of orderedFiles) {
    let size;
    try {
      size = fs.statSync(path.join(REPO_ROOT, f)).size;
    } catch (e) {
      continue; // file vanished between listing and stat -- skip it
    }
    // A single file larger than the whole batch budget gets its own
    // solo batch rather than being silently skipped or breaking the
    // running total.
    if (currentChars > 0 && currentChars + size > MAX_BATCH_CHARS) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(f);
    currentChars += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function buildReviewPrompt(files, graph) {
  const fileBlocks = files.map(f => {
    const content = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8');
    return `<file path="${f}">\n${content}\n</file>`;
  }).join('\n\n');

  const dependencyLines = graph ? describeInBatchDependencies(files, graph) : [];
  const dependencySection = dependencyLines.length > 0
    ? `\nDependency relationships among these files:\n${dependencyLines.map(l => `- ${l}`).join('\n')}\n\nFor any pair of files with a dependency relationship above, specifically check whether the DEPENDENT file's assumptions about the other file's exports still hold: does it call a function that still exists with the same name and argument order, does it read a field on a returned object that the other file's code actually still sets, does it assume a data shape (an array vs. a single object, a specific key name) that matches what the other file actually produces? A mismatch here is exactly the kind of bug that's easy to miss reviewing either file alone.\n`
    : '';

  return `You are reviewing code that was just committed to a financial-model-audit tool, looking ONLY for genuine bugs — not style preferences, not subjective opinions, not things that merely could be written differently. A "bug" here means: a logic error, an undefined/null reference risk, an off-by-one, a broken or stale reference to a function/field/file that no longer exists or was renamed, inconsistent behavior between two places that are supposed to agree, a race condition, or a case that will silently produce a wrong result rather than an error. This includes cross-file bugs — a function's actual return shape not matching what a caller in a different file assumes, a field one file expects that another file no longer sets, two files that are supposed to stay consistent (e.g. a duplicated list or constant) having silently drifted apart.
${dependencySection}
If you find nothing wrong, return an empty bugs array — do not invent minor nitpicks to seem useful. It is normal and expected for most scans to return zero bugs.

For each genuine bug found, you MUST provide old_code as an EXACT, VERBATIM, UNIQUE substring of the file it comes from (copy it exactly, whitespace and all) — this will be used for an automated, literal string-replacement fix, so it must match the file's actual content precisely and must not appear more than once in that file. old_code and new_code must both come from the SAME file (the one named in "file") — a cross-file bug still gets fixed one file at a time.

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

Files to review:

${fileBlocks}`;
}

// Calls Claude once for a single batch of files, returning the parsed
// bugs array (or null on a parse failure, already logged). Shared by
// both scanChangedFiles (always exactly one small batch) and
// scanAllFiles (potentially many batches).
async function reviewFileBatch(client, files, graph) {
  const prompt = buildReviewPrompt(files, graph);
  // FIX: a real run's batch 19 showed a second, distinct failure mode
  // from the thinking-truncation one above — stop_reason 'end_turn'
  // (not truncated at all), content block types 'thinking, text', but
  // the text block was natural-language prose analysis ("Looking
  // through all these test files carefully...") instead of the
  // requested JSON, despite the prompt explicitly saying "ONLY a JSON
  // object... no other text". Prefilling the assistant turn with the
  // JSON's own opening is a standard, reliable way to force the model
  // to continue in that format rather than choosing prose — the API
  // only returns the continuation, so the prefill is prepended back on
  // before parsing.
  const jsonPrefill = '{\n  "bugs": [';
  const response = await client.messages.create({
    model: 'claude-sonnet-5',
    // FIX: a real --all run showed the actual root cause via the
    // diagnostics added in the previous fix — stop_reason: 'max_tokens',
    // content block types: 'thinking' (sometimes 'thinking' alone, no
    // 'text' block at all), rawText length: 0. Extended thinking was
    // consuming the ENTIRE budget before generating any of the actual
    // requested JSON output, in the large majority of batches. Raising
    // max_tokens alone (the previous fix, 8000 -> 16000) did not
    // resolve this, since thinking has no inherent bound tied to that
    // number. Explicitly disabling thinking removes the failure mode
    // deterministically rather than hoping a larger budget happens to
    // leave enough room — verified against the installed SDK's own
    // type definitions (ThinkingConfigDisabled), not guessed.
    thinking: { type: 'disabled' },
    max_tokens: 16000,
    messages: [
      { role: 'user', content: prompt },
      { role: 'assistant', content: jsonPrefill },
    ],
  });

  const rawText = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
  // The prefill isn't echoed back by the API — only the continuation
  // is. Prepend it so the combined text is the complete JSON document.
  const fullText = jsonPrefill + rawText;

  try {
    // Claude may still wrap the JSON in a code fence or add stray
    // whitespace despite the prefill — stripped defensively rather
    // than fail the whole batch over it.
    const cleaned = fullText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed.bugs) ? parsed.bugs : [];
  } catch (e) {
    // FIX: this branch previously only printed rawText itself, which
    // showed as a blank line when rawText was empty — no way to tell
    // WHY. Print real diagnostics so a future failure is diagnosable
    // on the first occurrence rather than requiring another guess.
    console.error('   \u26a0\ufe0f  Could not parse the review response as JSON for this batch — diagnostics below, continuing with remaining batches:');
    console.error(`     stop_reason: ${response.stop_reason}`);
    console.error(`     content block types: ${response.content.map(b => b.type).join(', ') || '(none)'}`);
    console.error(`     rawText length (continuation only, before prefill): ${rawText.length}`);
    if (rawText.length > 0) {
      console.error(`     rawText (first 500 chars): ${rawText.slice(0, 500)}`);
    }
    return [];
  }
}

async function scanChangedFiles(sinceRef) {
  const files = getChangedFiles(sinceRef);
  if (files.length === 0) {
    console.log('   No reviewable files (.js/.py) changed in this commit — nothing to scan.');
    saveFindings([], []);
    return;
  }
  console.log(`   Reviewing ${files.length} changed file(s): ${files.join(', ')}`);

  // Cheap (no API cost, just local regex parsing) even for a handful of
  // files — surfaces a real relationship if the commit touched two
  // files that depend on each other together, the same pattern this
  // project's own commits followed all session (e.g. index.js and a
  // new utility file landing in the same commit).
  const graph = buildDependencyGraph(files);

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment, same as validator-tier2.js

  const bugs = await reviewFileBatch(client, files, graph);
  saveFindings(files, bugs);
  printFindings(bugs);
}

// Scans EVERY tracked .js/.py file in the repo, batched. Deliberately a
// separate, explicitly-invoked mode (--all) rather than something the
// post-commit hook ever runs automatically — a full-repo review costs
// real time and real API spend on every single commit, which is not
// what "did this deployment just introduce a bug" needs.
async function scanAllFiles() {
  const files = getAllReviewableFiles();
  if (files.length === 0) {
    console.log('   No reviewable (.js/.py) tracked files found in the repo.');
    saveFindings([], []);
    return;
  }
  const graph = buildDependencyGraph(files);
  const batches = batchFiles(files, graph);
  console.log(`   Reviewing all ${files.length} tracked file(s) across ${batches.length} batch(es), ordered by dependency proximity (this takes longer and costs real API usage — not the routine post-commit mode).\n`);

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();

  const allBugs = [];
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const totalChars = batch.reduce((sum, f) => sum + fs.statSync(path.join(REPO_ROOT, f)).size, 0);
    console.log(`   Batch ${i + 1}/${batches.length}: ${batch.length} file(s), ~${Math.round(totalChars / 3)} tokens — ${batch.join(', ')}`);
    const bugs = await reviewFileBatch(client, batch, graph);
    console.log(`     -> ${bugs.length} bug(s) found in this batch.\n`);
    allBugs.push(...bugs);
  }

  saveFindings(files, allBugs);
  printFindings(allBugs);
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
  } else if (args[0] === '--all') {
    await scanAllFiles();
  } else {
    await scanChangedFiles();
  }
}

// Guarded so this file can be require()'d for its pure functions (see
// module.exports below, used by test-bug-scan-agent.js) without also
// triggering a live CLI run and an API call as a side effect of import.
if (require.main === module) {
  main().catch(e => {
    console.error('   \u26a0\ufe0f  bug-scan-agent error:', e.message);
    // Deliberately exits 0, not 1 — this is an informational tool, not a
    // deploy gate (unlike pre-deploy-check.js). A scan failure (e.g. no
    // API key configured, a transient network error) should never block
    // or appear to block a commit that has already happened.
    process.exit(0);
  });
}

module.exports = {
  getChangedFiles, getAllReviewableFiles,
  parseLocalRequires, buildDependencyGraph, orderByDependencyProximity,
  describeInBatchDependencies, batchFiles, buildReviewPrompt,
};
