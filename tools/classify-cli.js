#!/usr/bin/env node
// tools/classify-cli.js — updated for the step-3 supervisor
// approve/reject + priority workflow. Replaces the old "category
// 1-4" version, which no longer works against the updated
// classification-store.js.
//
// Usage:
//   node tools/classify-cli.js add <findingId> <engagementId> <approved true|false> [must_fix|nice_to_fix] <reviewedBy> ["note"]
//   node tools/classify-cli.js list <engagementId>
//   node tools/classify-cli.js fix-queue

const { reviewFinding, loadEngagement, loadApprovedFixQueue } = require('../src/classification-store');

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'add') {
  const [, findingId, engagementId, approvedStr, ...rest] = args;
  if (!findingId || !engagementId || !approvedStr) {
    console.error('Usage: node tools/classify-cli.js add <findingId> <engagementId> <approved true|false> [must_fix|nice_to_fix] <reviewedBy> ["note"]');
    process.exit(2);
  }
  const approved = approvedStr === 'true';
  if (approvedStr !== 'true' && approvedStr !== 'false') {
    console.error('   \u26a0\ufe0f  approved must genuinely be "true" or "false" - got "' + approvedStr + '"');
    process.exit(2);
  }

  // If approved, a priority is required as the next arg; if
  // rejected, there's no priority arg at all - just reviewedBy and
  // an optional note.
  let priority, reviewedBy, note;
  if (approved) {
    [priority, reviewedBy, note] = rest;
    if (!reviewedBy) {
      console.error('Usage (approved): node tools/classify-cli.js add <findingId> <engagementId> true <must_fix|nice_to_fix> <reviewedBy> ["note"]');
      process.exit(2);
    }
  } else {
    [reviewedBy, note] = rest;
    if (!reviewedBy) {
      console.error('Usage (rejected): node tools/classify-cli.js add <findingId> <engagementId> false <reviewedBy> ["note"]');
      process.exit(2);
    }
  }

  try {
    const record = reviewFinding({ findingId, engagementId, approved, priority, reviewerNote: note, reviewedBy });
    if (record.approved) {
      console.log(`   \u2705 Approved ${record.findingId} as ${record.priority}`);
    } else {
      console.log(`   \u2705 Marked ${record.findingId} irrelevant`);
    }
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
    console.log(`   No review decisions recorded yet for "${engagementId}".`);
  } else {
    console.log(`   ${records.length} review decision(s) for "${engagementId}":`);
    for (const r of records) {
      const label = r.approved ? `approved (${r.priority})` : 'irrelevant';
      console.log(`   ${r.findingId}  ->  ${label}  by ${r.reviewedBy} at ${r.reviewedAt}${r.reviewerNote ? '  \u2014 ' + r.reviewerNote : ''}`);
    }
  }
} else if (cmd === 'fix-queue') {
  const queue = loadApprovedFixQueue();
  if (queue.length === 0) {
    console.log('   No approved findings in the fix queue yet.');
  } else {
    console.log(`   Real fix queue - ${queue.length} approved finding(s), must_fix first:`);
    for (const r of queue) {
      console.log(`   [${r.priority}]  ${r.findingId}  (${r.engagementId})${r.reviewerNote ? '  \u2014 ' + r.reviewerNote : ''}`);
    }
  }
} else {
  console.log('Usage:');
  console.log('  node tools/classify-cli.js add <findingId> <engagementId> true <must_fix|nice_to_fix> <reviewedBy> ["note"]');
  console.log('  node tools/classify-cli.js add <findingId> <engagementId> false <reviewedBy> ["note"]');
  console.log('  node tools/classify-cli.js list <engagementId>');
  console.log('  node tools/classify-cli.js fix-queue');
}
