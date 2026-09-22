#!/usr/bin/env node
// tools/classify-cli.js — the minimal manual classification script
// for the 4-category feedback loop. No UI yet, by design (see the
// design doc's recommended sequencing) - this is the cheap first
// step that lets real data start accumulating immediately.
//
// Usage:
//   node tools/classify-cli.js add <findingId> <engagementId> <category 1-4> <reviewedBy> ["note"]
//   node tools/classify-cli.js list <engagementId>
//   node tools/classify-cli.js aggregate

const { classify, loadEngagement, aggregateByRule, CATEGORY_LABELS } = require('../src/classification-store');

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'add') {
  const [, findingId, engagementId, categoryStr, reviewedBy, note] = args;
  if (!findingId || !engagementId || !categoryStr || !reviewedBy) {
    console.error('Usage: node tools/classify-cli.js add <findingId> <engagementId> <category 1-4> <reviewedBy> ["note"]');
    process.exit(2);
  }
  const category = parseInt(categoryStr, 10);
  try {
    const record = classify({ findingId, engagementId, category, reviewerNote: note, reviewedBy });
    console.log(`   \u2705 Classified ${record.findingId} as category ${record.category} (${record.categoryLabel})`);
  } catch (err) {
    console.error(`   \u26a0\ufe0f  ${err.message}`);
    process.exit(1);
  }
} else if (cmd === 'list') {
  const [, engagementId] = args;
  if (!engagementId) {
    console.error('Usage: node tools/classify-cli.js list <engagementId>');
    process.exit(2);
  }
  const records = loadEngagement(engagementId);
  if (records.length === 0) {
    console.log(`   No classifications recorded yet for "${engagementId}".`);
  } else {
    console.log(`   ${records.length} classification(s) for "${engagementId}":`);
    for (const r of records) {
      console.log(`   ${r.findingId}  ->  category ${r.category} (${r.categoryLabel})  by ${r.reviewedBy} at ${r.reviewedAt}${r.reviewerNote ? '  — ' + r.reviewerNote : ''}`);
    }
  }
} else if (cmd === 'aggregate') {
  const byRule = aggregateByRule();
  const ruleIds = Object.keys(byRule);
  if (ruleIds.length === 0) {
    console.log('   No classifications recorded yet across any engagement.');
  } else {
    console.log(`   Real category distribution across ${ruleIds.length} real, distinct finding ID(s):`);
    for (const ruleId of ruleIds) {
      const d = byRule[ruleId];
      console.log(`   ${ruleId}: ${d.total} total  (1:${d[1]}  2:${d[2]}  3:${d[3]}  4:${d[4]})`);
    }
  }
} else {
  console.log('Usage:');
  console.log('  node tools/classify-cli.js add <findingId> <engagementId> <category 1-4> <reviewedBy> ["note"]');
  console.log('  node tools/classify-cli.js list <engagementId>');
  console.log('  node tools/classify-cli.js aggregate');
  console.log();
  console.log('Categories:');
  for (const [n, label] of Object.entries(CATEGORY_LABELS)) {
    console.log(`  ${n} - ${label}`);
  }
}
