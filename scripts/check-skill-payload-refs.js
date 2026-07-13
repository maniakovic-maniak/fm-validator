#!/usr/bin/env node
// check-skill-payload-refs.js
//
// Consistency linter — confirms every payload field skill.md's test
// instructions reference (workbookStats.X, riskSummary.Y, namedRangeSummary.Z,
// vbaSummary.W) is actually present in what validator-tier2.js/validator-tier0.js
// construct and send to Claude. This is the exact class of bug found and
// fixed once already this project: skill.md described tests as permanently
// unanswerable, or referenced fields, that weren't actually wired into the
// Tier 2 payload — a silent mismatch that took a full manual read-through
// to catch. Run this before every deploy that touches skill.md,
// validator-tier2.js, or validator-tier0.js.
//
// Deliberately NOT a hardcoded schema — it parses the actual source files
// at lint-time, so it keeps catching drift automatically as the payload
// shape evolves, rather than needing its own manual updates every time
// someone adds a field.
//
// Usage: node check-skill-payload-refs.js [path/to/skill.md] [path/to/validator-tier2.js] [path/to/validator-tier0.js]
// Exit code 0 = clean, 1 = mismatches found.

const fs = require('fs');
const path = require('path');

const skillPath  = process.argv[2] || path.join(__dirname, '..', 'config', 'skill.md');
const tier2Path  = process.argv[3] || path.join(__dirname, '..', 'src', 'validator-tier2.js');
const tier0Path  = process.argv[4] || path.join(__dirname, '..', 'src', 'validator-tier0.js');

function readOrDie(p, label) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.error(`❌ Could not read ${label} at ${p}: ${e.message}`);
    process.exit(2);
  }
}

const skillMd    = readOrDie(skillPath, 'skill.md');
const tier2Source = readOrDie(tier2Path, 'validator-tier2.js');
const tier0Source = readOrDie(tier0Path, 'validator-tier0.js');

// ── Step 1: extract ground-truth field names from the actual payload code ──

// workbookStats / riskSummary ground truth — validator-tier0.js's
// buildEmptyResult() return statement is the single clean declaration of
// every field these two objects can ever contain (with default values),
// so it's the most reliable source to parse rather than the live
// computation path (which builds fields incrementally across the file).
function extractObjectBlock(source, blockName) {
  // Two patterns in use across this codebase:
  //   1. `blockName: {` — object literal as a value (buildEmptyResult's return statement)
  //   2. `const blockName = (...) ? {` — ternary-based ForPrompt declarations in validator-tier2.js
  const patterns = [
    new RegExp(`${blockName}\\s*:\\s*\\{`),
    new RegExp(`${blockName}\\s*=[^{]*?\\?\\s*\\{`),
  ];
  let m = null;
  for (const re of patterns) {
    m = re.exec(source);
    if (m) break;
  }
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    i++;
  }
  return source.slice(start, i - 1);
}

function extractKeysFromBlock(block) {
  if (!block) return new Set();
  // Matches `key:` or `key :` at the start of a line/after a comma —
  // deliberately simple (not a full JS parser) since this only needs to
  // catch top-level key declarations in a plain object literal.
  const keyRe = /(?:^|[,{])\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*:/gm;
  const keys = new Set();
  let mm;
  while ((mm = keyRe.exec(block)) !== null) {
    keys.add(mm[1]);
  }
  return keys;
}

const buildEmptyResultBody = (() => {
  const fnMarker = /function\s+buildEmptyResult\s*\(\s*\)\s*\{/;
  const m = fnMarker.exec(tier0Source);
  if (!m) return tier0Source; // fall back to whole file if not found
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < tier0Source.length && depth > 0) {
    if (tier0Source[i] === '{') depth++;
    else if (tier0Source[i] === '}') depth--;
    i++;
  }
  return tier0Source.slice(start, i - 1);
})();

const statsKeys          = extractKeysFromBlock(extractObjectBlock(buildEmptyResultBody, 'stats'));
const riskIndicatorsKeys = extractKeysFromBlock(extractObjectBlock(buildEmptyResultBody, 'riskIndicators'));

// namedRangeSummary / vbaSummary ground truth — parsed directly from
// validator-tier2.js's own construction of the *ForPrompt objects.
const namedRangeSummaryKeys = extractKeysFromBlock(extractObjectBlock(tier2Source, 'namedRangeSummaryForPrompt'));
const vbaSummaryKeys        = extractKeysFromBlock(extractObjectBlock(tier2Source, 'vbaSummaryForPrompt'));

const KNOWN_OBJECTS = {
  workbookStats: statsKeys,
  riskSummary: riskIndicatorsKeys,
  namedRangeSummary: namedRangeSummaryKeys,
  vbaSummary: vbaSummaryKeys,
};

// ── Step 2: extract every `object.field` reference skill.md makes ─────────
// Matches backtick-quoted references like `workbookStats.totalHardcodes` or
// `vbaSummary.hasVbaProject` — the consistent style skill.md already uses
// for every payload field reference.
const refRe = /`(workbookStats|riskSummary|namedRangeSummary|vbaSummary)\.([A-Za-z_$][A-Za-z0-9_$]*)`/g;
const referenced = []; // {object, field, lineNumber}
const lines = skillMd.split('\n');
lines.forEach((line, idx) => {
  let mm;
  const lineRe = new RegExp(refRe.source, 'g');
  while ((mm = lineRe.exec(line)) !== null) {
    referenced.push({ object: mm[1], field: mm[2], line: idx + 1 });
  }
});

// ── Step 3: compare ──────────────────────────────────────────────────────
let hasErrors = false;
const seenPairs = new Set();

console.log('=== skill.md ↔ Tier 2 payload consistency check ===\n');

for (const ref of referenced) {
  const key = `${ref.object}.${ref.field}`;
  if (seenPairs.has(key)) continue; // report each distinct field once
  seenPairs.add(key);

  const knownKeys = KNOWN_OBJECTS[ref.object];
  if (!knownKeys) {
    console.log(`❌ skill.md:${ref.line} references unknown payload object '${ref.object}' — not one of workbookStats/riskSummary/namedRangeSummary/vbaSummary.`);
    hasErrors = true;
    continue;
  }
  if (!knownKeys.has(ref.field)) {
    console.log(`❌ skill.md:${ref.line} references \`${key}\`, but this field was not found in the actual payload construction (checked validator-tier0.js's buildEmptyResult() and validator-tier2.js's *ForPrompt objects).`);
    console.log(`   Known fields for ${ref.object}: ${[...knownKeys].join(', ') || '(none found — check the ground-truth parser itself)'}`);
    hasErrors = true;
  }
}

if (!hasErrors) {
  console.log(`✅ All ${seenPairs.size} distinct payload field reference(s) in skill.md resolve to real fields in the actual payload.`);
}

// Informational only — fields that exist in the payload but skill.md never
// mentions. Not an error (a field may not need a dedicated test yet), just
// visibility into unused payload surface.
console.log('\n=== Informational — payload fields not referenced anywhere in skill.md ===');
for (const [objName, keys] of Object.entries(KNOWN_OBJECTS)) {
  const unused = [...keys].filter(k => !seenPairs.has(`${objName}.${k}`));
  if (unused.length > 0) {
    console.log(`   ${objName}: ${unused.join(', ')}`);
  }
}

process.exit(hasErrors ? 1 : 0);
