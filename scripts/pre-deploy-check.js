#!/usr/bin/env node
// pre-deploy-check.js (D3) — orchestrates D1 + D2 into a single pre-
// deploy gate, plus a basic checklist.json validity check that comes
// first and is cheaper than either.
//
// Run manually before pushing:
//   node scripts/pre-deploy-check.js
// Or wire into git via the optional hook — see .githooks/pre-push in
// this same commit. Not installed automatically; see that file's own
// header for the one-line opt-in command.
//
// Exit code 0 = safe to deploy. Exit code 1 = fix something first.

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const configDir = path.join(__dirname, '..', 'config');
const scriptsDir = __dirname;

let hasHardFailure = false;
const summary = [];

function printSummaryAndExit() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════');
  for (const s of summary) {
    const icon = s.status === 'pass' ? '✅' : s.status === 'FAIL' ? '❌' : 'ℹ️ ';
    console.log(`  ${icon} ${s.check}: ${s.status}`);
  }
  console.log();
  if (hasHardFailure) {
    console.log('❌ NOT SAFE TO DEPLOY — fix the failure(s) above first.');
    process.exit(1);
  } else {
    console.log('✅ Safe to deploy.');
    process.exit(0);
  }
}

console.log('═══════════════════════════════════════════════════');
console.log('  fm-validator pre-deploy check (D3)');
console.log('═══════════════════════════════════════════════════\n');

// ── Check 0: checklist.json is valid, parseable JSON ────────────────────
// Directly motivated by a real incident this project hit: a manual merge
// of new rules into checklist.json left a missing comma at the splice
// point, breaking the file for every consumer until caught by hand. This
// is the cheapest, most fundamental check possible, and it comes first
// because both D1 and D2 depend on this file parsing correctly — if it
// doesn't, their own errors would be less specific and more confusing
// than just reporting this directly.
console.log('[0/2] checklist.json JSON validity...');
try {
  const raw = fs.readFileSync(path.join(configDir, 'checklist.json'), 'utf8');
  const parsed = JSON.parse(raw);
  const tier1Count = (parsed.tier1 || []).length;
  const tier2Count = (parsed.tier2 || []).length;
  console.log(`   ✅ Valid JSON — ${tier1Count} Tier 1 rules, ${tier2Count} Tier 2 rules.\n`);
  summary.push({ check: 'checklist.json validity', status: 'pass' });
} catch (e) {
  console.log(`   ❌ checklist.json is not valid JSON: ${e.message}\n`);
  summary.push({ check: 'checklist.json validity', status: 'FAIL' });
  hasHardFailure = true;
  printSummaryAndExit(); // D1/D2 both depend on this file — no point running them against broken JSON
}

// ── Check 1 (D1): skill.md <-> validator-tier2.js payload field refs ───
// HARD FAILURE if this finds a genuine mismatch — a field skill.md
// references that the actual Tier 2 payload doesn't contain is a real,
// silent gap in what Claude can act on, not a judgment call.
console.log('[1/2] D1 — skill.md <-> Tier 2 payload field consistency...');
try {
  execFileSync('node', [path.join(scriptsDir, 'check-skill-payload-refs.js')], { stdio: 'inherit' });
  console.log('   ✅ D1 passed.\n');
  summary.push({ check: 'D1 (payload field refs)', status: 'pass' });
} catch (e) {
  console.log('   ❌ D1 found a mismatch — see output above.\n');
  summary.push({ check: 'D1 (payload field refs)', status: 'FAIL' });
  hasHardFailure = true;
}

// ── Check 2 (D2): checklist.json <-> skill*.md test-name refs ───────────
// INFORMATIONAL ONLY, matching D2's own calibrated design (see that
// script's header comment) — most "missing instruction" cases turned out
// to be an intentional pattern, not a real gap, when checked against real
// production evidence. This never blocks the gate; it still runs and
// prints its findings so a human can judge case by case, which matters
// most right after adding new rules (exactly what B1 needed this for).
console.log('[2/2] D2 — checklist.json <-> skill*.md test-name consistency (informational)...');
try {
  execFileSync('node', [path.join(scriptsDir, 'check-checklist-skill-refs.js')], { stdio: 'inherit' });
} catch (e) {
  // D2 is designed to always exit 0 — this catch is a defensive guard in
  // case that ever changes, and still does not set hasHardFailure.
}
summary.push({ check: 'D2 (test-name refs)', status: 'info (see output above)' });

printSummaryAndExit();
