#!/usr/bin/env node
'use strict';
// Usage: node scripts/approve-output-registry.js <proposed.json> --by "Full Name" [--on YYYY-MM-DD] [--replace]
// Reads a proposed registry (edit it first: remove outputs that are not priority outputs, add any that are missing),
// writes config/output-registries/<model>.json as approved, and leaves the proposed file where it is. Commit the result.
const fs = require('fs'), path = require('path');
const { approveRegistry, slug, REG_DIR } = require('../src/utils/output-registry');
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find(a => !a.startsWith('--') && a !== opt('--by') && a !== opt('--on'));
if (!file || !opt('--by')) { console.error('Usage: node scripts/approve-output-registry.js <proposed.json> --by "Full Name" [--on YYYY-MM-DD] [--replace]'); process.exit(2); }
try {
  const proposed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const on = opt('--on') || new Date().toISOString().slice(0, 10);
  const approved = approveRegistry(proposed, { approvedBy: opt('--by'), approvedOn: on });
  const out = path.join(REG_DIR, slug(proposed.model || path.basename(file).replace(/\.proposed\.json$/, '')) + '.json');
  if (fs.existsSync(out) && !args.includes('--replace')) { console.error(`An approved registry already exists (${path.relative(process.cwd(), out)}). Use --replace to overwrite it.`); process.exit(1); }
  fs.writeFileSync(out, JSON.stringify(approved, null, 2) + '\n');
  console.log(`Wrote ${path.relative(process.cwd(), out)}: ${approved.outputs.length} outputs approved by ${approved.approved_by} on ${approved.approved_on}.`);
} catch (e) { console.error('Not approved: ' + e.message); process.exit(1); }
