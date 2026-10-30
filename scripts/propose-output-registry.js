#!/usr/bin/env node
'use strict';
// Usage: node scripts/propose-output-registry.js <model.xlsx|xlsm>
// Writes config/output-registries/<model>.proposed.json. Never overwrites an approved registry.
const fs = require('fs'), path = require('path');
const { parseExcel } = require('../src/parser');
const { runTier0 } = require('../src/validator-tier0');
const { proposeRegistry, slug } = require('../src/utils/output-registry');
(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/propose-output-registry.js <model file>'); process.exit(2); }
  const parsed = await parseExcel(file);
  const t0 = await runTier0(parsed);
  const reg = proposeRegistry(parsed._raw, t0.cellScoreIndex, path.basename(file));
  const dir = path.join(__dirname, '..', 'config', 'output-registries');
  const approved = path.join(dir, slug(path.basename(file)) + '.json');
  if (fs.existsSync(approved)) { console.error('An approved registry already exists: ' + path.relative(process.cwd(), approved) + '. Not overwritten.'); process.exit(1); }
  const out = path.join(dir, slug(path.basename(file)) + '.proposed.json');
  fs.writeFileSync(out, JSON.stringify(reg, null, 2) + '\n');
  console.log(`Wrote ${path.relative(process.cwd(), out)}: ${reg.outputs.length} proposed outputs, status ${reg.status}.`);
})();
