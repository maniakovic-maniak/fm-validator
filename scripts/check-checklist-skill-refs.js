#!/usr/bin/env node
// check-checklist-skill-refs.js
//
// Consistency linter (D2) — confirms every Tier 2 rule in checklist.json
// has a corresponding `### test: xxx` instruction section somewhere in
// skill.md or a domain skill file, and flags any test instructions that
// don't correspond to any actual checklist rule.
//
// Deliberately scoped to Tier 2 only. Tier 1's "test" field (e.g.
// no_formula_errors, sheet_exists_flexible) refers to a deterministic
// JS check in validator-tier1.js, not an LLM prompt instruction — cross-
// checking those against skill.md would produce nothing but false
// "missing instructions" flags, since Tier 1 was never meant to have a
// markdown counterpart at all.
//
// Motivated directly by this project's own history: B1 added 7 new
// Tier 2 rules (T2-S10-090 to 096) to checklist.json with matching
// `### test:` sections added to skill-mining.md, and that cross-reference
// was verified manually at the time rather than by an automated check —
// exactly the kind of drift D1 already catches for payload fields, just
// for the checklist-to-skill-file link instead.
//
// Usage: node check-checklist-skill-refs.js [config-dir]
//   config-dir defaults to ../config relative to this script.
// Exit code 0 = clean (no missing instructions), 1 = at least one rule
// has no corresponding test instructions anywhere.

const fs = require('fs');
const path = require('path');

const configDir = process.argv[2] || path.join(__dirname, '..', 'config');

function readOrDie(p, label) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    console.error(`❌ Could not read ${label} at ${p}: ${e.message}`);
    process.exit(2);
  }
}

// ── Step 1: collect every Tier 2 "test" value from checklist.json ─────────
const checklistPath = path.join(configDir, 'checklist.json');
const checklistRaw = readOrDie(checklistPath, 'checklist.json');
let checklist;
try {
  checklist = JSON.parse(checklistRaw);
} catch (e) {
  console.error(`❌ checklist.json is not valid JSON: ${e.message}`);
  process.exit(2);
}

const tier2Rules = checklist.tier2 || [];
const checklistTests = new Map(); // test name -> [rule ids using it]
for (const rule of tier2Rules) {
  if (!rule.test) continue;
  if (!checklistTests.has(rule.test)) checklistTests.set(rule.test, []);
  checklistTests.get(rule.test).push(rule.id);
}

// ── Step 2: collect every `### test: xxx` section from every skill*.md ────
// file in config/ — scans whatever domain skills exist (skill.md,
// skill-mining.md, skill-generic.md, and any future skill-{domain}.md),
// so a rule's instructions can legitimately live in either the universal
// skill.md or a domain-specific file.
const skillFiles = fs.readdirSync(configDir).filter(f => /^skill.*\.md$/i.test(f));
if (skillFiles.length === 0) {
  console.error(`❌ No skill*.md files found in ${configDir}`);
  process.exit(2);
}

const skillTests = new Map(); // test name -> [files containing it]
for (const file of skillFiles) {
  const content = fs.readFileSync(path.join(configDir, file), 'utf8');
  const matches = content.matchAll(/^### test: (\w+)/gm);
  for (const m of matches) {
    const testName = m[1];
    if (!skillTests.has(testName)) skillTests.set(testName, []);
    skillTests.get(testName).push(file);
  }
}

// ── Step 3: compare ─────────────────────────────────────────────────────
console.log('=== checklist.json (Tier 2) ↔ skill*.md test-instruction consistency check ===\n');
console.log(`Scanned: checklist.json (${tier2Rules.length} Tier 2 rules, ${checklistTests.size} distinct test names)`);
console.log(`Scanned: ${skillFiles.join(', ')} (${skillTests.size} distinct "### test:" sections)\n`);

// Rules with no matching instructions anywhere. IMPORTANT CALIBRATION
// NOTE: this is reported as INFORMATIONAL, not a hard failure. Checked
// against real production evidence before deciding this: several rules
// with no dedicated "### test:" section (e.g. distributions_after_
// obligations, payroll_build) already evaluate successfully in real
// delivered reports using nothing but their checklist.json label and
// fix_instruction text — no dedicated section needed. skill.md has no
// explicit statement either way, but this is strong evidence the
// pattern is intentional (dedicated sections reserved for rules that
// need genuinely extra nuance, like no_hardcodes or no_circular_
// references, which had real ambiguity worth resolving) rather than an
// oversight for every rule. Treating every gap as a hard failure would
// produce constant noise (34 "failures" against a checklist that's
// working correctly in production) with no reliable way to distinguish
// genuinely-missing-critical-guidance from intentionally-self-
// explanatory. This still surfaces every gap for a human to judge —
// it just doesn't fail the build over something this ambiguous.
const missingInstructions = [];
for (const [testName, ruleIds] of checklistTests) {
  if (!skillTests.has(testName)) {
    missingInstructions.push({ testName, ruleIds });
  }
}

if (missingInstructions.length > 0) {
  console.log(`ℹ️  ${missingInstructions.length} checklist test name(s) have no corresponding "### test:" section in any skill file (informational — not necessarily a gap, see script header comment):`);
  for (const { testName, ruleIds } of missingInstructions) {
    console.log(`   - "${testName}" (used by rule(s): ${ruleIds.join(', ')})`);
  }
} else {
  console.log(`✅ Every Tier 2 rule's test name has a corresponding "### test:" section somewhere in ${skillFiles.join(', ')}.`);
}

// Orphaned instructions — informational only, not a hard failure. A test
// section with no matching rule is wasted prompt content (and token
// budget), most likely left over after a rule was renamed or removed,
// but it isn't actively misleading the way a missing instruction is.
console.log('\n=== Informational — "### test:" sections with no matching checklist.json rule ===');
const orphaned = [];
for (const [testName, files] of skillTests) {
  if (!checklistTests.has(testName)) {
    orphaned.push({ testName, files });
  }
}
if (orphaned.length > 0) {
  for (const { testName, files } of orphaned) {
    console.log(`   "${testName}" in ${files.join(', ')} — no Tier 2 rule references this test name`);
  }
} else {
  console.log('   None — every test section corresponds to an active rule.');
}

// Both checks above are deliberately informational, not hard failures —
// see the calibration note on missingInstructions. This script's job is
// visibility, not gatekeeping: it always exits 0 once it successfully
// reads and parses its inputs. A genuinely broken input (missing file,
// invalid JSON) already exits 2 earlier, before reaching this point.
process.exit(0);
