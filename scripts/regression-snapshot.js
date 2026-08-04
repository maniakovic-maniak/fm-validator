#!/usr/bin/env node
// scripts/regression-snapshot.js
//
// Found necessary via a direct conversation about running check
// tuning "continuously" without a human in the loop: the dynamic
// fixture discovery built earlier this session (fixtures-helper.js)
// means new files get tested automatically, but an UNKNOWN file's
// finding count was only ever logged, never compared against a prior
// run — there is no assertion for a file with no pre-verified
// expected count, by design (that's what makes dropping a genuinely
// new file safe). This script closes that specific gap: it takes a
// snapshot of every registered check's finding count against every
// fixture file, and diffs it against a committed baseline, flagging
// ANY change — known-file or not — as worth a human looking at.
//
// This is deliberately read-only in normal use: it never fixes
// anything, never auto-commits, never silently accepts a new number
// as correct. A genuine, deliberate change to a check's behavior
// still needs a human to run --update-baseline and commit the result,
// the same explicit-confirmation discipline used throughout this
// project's own remediation work.
//
// Usage:
//   node scripts/regression-snapshot.js                 — compare current state against the baseline, exit non-zero on any drift
//   node scripts/regression-snapshot.js --update-baseline — after reviewing a change is intentional, write the current state as the new baseline

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { getFixtureFiles } = require('../fixtures-helper.js');

const BASELINE_PATH = path.join(__dirname, '..', 'regression-baseline.json');

// The registry of checks tracked by this job. Deliberately starts
// with the checks built/modified this session — the ones with the
// most recent tuning history and demonstrated regression risk (one
// genuinely spiked to 1,307 findings during development before being
// caught and reverted). Extend this list over time by adding more
// { name, load } entries — `load` returns the check function itself,
// deferred so a missing/renamed module doesn't crash the whole run.
const CHECK_REGISTRY = [
  { name: 'checkMasterControlFailure', load: () => require('../src/utils/master-control-failure-check.js').checkMasterControlFailure },
  { name: 'checkImpossibleCountaTarget', load: () => require('../src/utils/impossible-counta-target-check.js').checkImpossibleCountaTarget },
  { name: 'checkMismatchedBasisComparison', load: () => require('../src/utils/mismatched-basis-comparison-check.js').checkMismatchedBasisComparison },
  { name: 'checkReleaseGateCoverage', load: () => require('../src/utils/release-gate-coverage-check.js').checkReleaseGateCoverage },
  { name: 'checkHardcodedCheckCells', load: () => require('../src/utils/hardcoded-check-cells.js').checkHardcodedCheckCells },
  { name: 'checkNonexistentSheetReferences', load: () => require('../src/utils/nonexistent-sheet-reference-check.js').checkNonexistentSheetReferences },
  { name: 'checkDegenerateCovenantBranch', load: () => require('../src/utils/degenerate-covenant-branch-check.js').checkDegenerateCovenantBranch },
  { name: 'checkEquityComponentBackwardSolved', load: () => require('../src/utils/equity-component-backward-solved-check.js').checkEquityComponentBackwardSolved },
  { name: 'checkHardcodedMajorAsset', load: () => require('../src/utils/hardcoded-major-asset-check.js').checkHardcodedMajorAsset },
];

async function buildSnapshot() {
  const fixtures = getFixtureFiles();
  const snapshot = {};
  const workbookCache = new Map(); // filename -> loaded workbook, so each file is only parsed once across all checks

  for (const { path: filePath, filename } of fixtures) {
    if (!workbookCache.has(filename)) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(filePath);
      workbookCache.set(filename, wb);
    }
  }

  for (const { name, load } of CHECK_REGISTRY) {
    let fn;
    try {
      fn = load();
    } catch (e) {
      console.error(`   \u26a0\ufe0f  Could not load check "${name}": ${e.message} — skipping this check for this run.`);
      continue;
    }
    snapshot[name] = {};
    for (const { filename } of fixtures) {
      const wb = workbookCache.get(filename);
      try {
        const result = fn(wb);
        snapshot[name][filename] = result.flaggedCount ?? (result.found ? 1 : 0);
      } catch (e) {
        snapshot[name][filename] = `ERROR: ${e.message}`;
      }
    }
  }

  return snapshot;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return null;
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function diffSnapshots(baseline, current) {
  const changes = [];
  const allChecks = new Set([...Object.keys(baseline || {}), ...Object.keys(current)]);
  for (const checkName of allChecks) {
    const baseFiles = (baseline && baseline[checkName]) || {};
    const curFiles = current[checkName] || {};
    const allFiles = new Set([...Object.keys(baseFiles), ...Object.keys(curFiles)]);
    for (const filename of allFiles) {
      const before = baseFiles[filename];
      const after = curFiles[filename];
      if (before === undefined) {
        changes.push({ checkName, filename, kind: 'new file/check combination', before: 'n/a', after });
      } else if (after === undefined) {
        changes.push({ checkName, filename, kind: 'file/check combination no longer present', before, after: 'n/a' });
      } else if (before !== after) {
        changes.push({ checkName, filename, kind: 'count changed', before, after });
      }
    }
  }
  return changes;
}

async function main() {
  const updateBaseline = process.argv.includes('--update-baseline');

  console.log('   Building current snapshot across all registered checks and discovered fixture files...');
  const current = await buildSnapshot();
  const fixtureCount = getFixtureFiles().length;
  console.log(`   Ran ${CHECK_REGISTRY.length} check(s) against ${fixtureCount} fixture file(s).`);

  if (updateBaseline) {
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
    console.log(`   \u2705 Baseline updated: ${BASELINE_PATH}`);
    console.log('   Review this diff before committing — it should only ever reflect a change you reviewed and intended.');
    return;
  }

  const baseline = loadBaseline();
  if (!baseline) {
    console.log('   No baseline found — this looks like the first run. Writing the current snapshot as the initial baseline.');
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
    console.log(`   \u2705 Initial baseline written: ${BASELINE_PATH}`);
    return;
  }

  const changes = diffSnapshots(baseline, current);
  if (changes.length === 0) {
    console.log('   \u2705 No drift detected — every tracked check/file combination matches the committed baseline.');
    return;
  }

  console.log(`\n   \u26a0\ufe0f  ${changes.length} change(s) detected since the last baseline:\n`);
  for (const c of changes) {
    console.log(`   [${c.kind}] ${c.checkName} on ${c.filename}: ${c.before} -> ${c.after}`);
  }
  console.log('\n   This does not mean something is broken — it means something changed and a human should look at it.');
  console.log('   If the change is genuine and intended, review it, then run: node scripts/regression-snapshot.js --update-baseline');
  process.exitCode = 1;
}

main().catch(e => { console.error('Regression snapshot failed:', e); process.exitCode = 1; });
