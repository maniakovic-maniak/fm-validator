#!/usr/bin/env node
'use strict';
// npm test: runs every test-*.js file in the repo root and the Python decision-threshold tests, one process each.
// A test passes when its process exits 0. Tests listed in scripts/stale-tests.json are known to need repair or retirement:
// they still run and are reported, but do not fail the run, and each carries the reason. Anything else that fails fails the run.
//   node scripts/run-tests.js            run everything
//   node scripts/run-tests.js patch4     run only files whose name contains "patch4"
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const only = process.argv[2] || '';
let stale = {};
try { stale = JSON.parse(fs.readFileSync(path.join(__dirname, 'stale-tests.json'), 'utf8')); } catch (_) {}
const files = fs.readdirSync(root).filter(f => /^test-.*\.js$/.test(f) && f.includes(only)).sort();
const results = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [f], { cwd: root, encoding: 'utf8', timeout: 600000, maxBuffer: 256 * 1024 * 1024 });
  const ok = r.status === 0;
  results.push({ name: f, ok, stale: !!stale[f], secs: Math.round((Date.now() - t0) / 1000), tail: ok ? '' : (r.stdout + r.stderr).split('\n').filter(l => /FAIL|Error|error/.test(l)).slice(0, 3).join(' | ') });
  console.log(`${ok ? 'ok  ' : (stale[f] ? 'STALE' : 'FAIL')} ${f} (${results[results.length - 1].secs}s)`);
}
if (!only || 'decision'.includes(only) || only.includes('decision')) {
  const r = spawnSync('python3', ['-I', path.join(root, 'tests', 'test_decision_threshold.py')], { cwd: root, encoding: 'utf8' });
  const ok = r.status === 0;
  results.push({ name: 'tests/test_decision_threshold.py', ok, stale: false, secs: 0, tail: ok ? '' : (r.stdout + r.stderr).slice(-300) });
  console.log(`${ok ? 'ok  ' : 'FAIL'} tests/test_decision_threshold.py`);
}
const failed = results.filter(r => !r.ok && !r.stale), staleFailed = results.filter(r => !r.ok && r.stale);
console.log(`\n${results.length - failed.length - staleFailed.length} passed, ${failed.length} failed, ${staleFailed.length} known-stale`);
failed.forEach(r => console.log(`  FAILED ${r.name}: ${r.tail}`));
staleFailed.forEach(r => console.log(`  stale  ${r.name}: ${stale[r.name]}`));
process.exit(failed.length ? 1 : 0);
