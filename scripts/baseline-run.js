#!/usr/bin/env node
// scripts/baseline-run.js - Patch 27. One timed, deterministic pass over a workbook (no Claude calls, no cost):
// parse, Tier 0, the SUM-range scan and the recalculation check, with wall time and peak memory for each stage and the
// counts that matter. The output is a JSON record in baseline/, named by the file and its hash, so a later patch can be
// compared with this one on the identical input.
//
// Usage:  node scripts/baseline-run.js "/path/to/model.xlsm" [--no-recalc]
//
// Run it once on the VPS for Hidden Gem before Patches 30 and 32, which change how formulas are stored and parsed.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { parseExcel } = require(path.join(ROOT, 'src/parser'));
const { runTier0 } = require(path.join(ROOT, 'src/validator-tier0'));
const { scanSumRanges } = require(path.join(ROOT, 'src/utils/sum-range-scan'));
const { buildRunProvenance } = require(path.join(ROOT, 'src/utils/run-provenance'));

const WRAPPER = [
  'import sys, json, time, resource',
  'sys.path.insert(0, sys.argv[1])',
  'import recalc_check as r',
  't = time.time()',
  'res = r.run(sys.argv[2])',
  'kb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss',
  'if sys.platform == "darwin": kb = kb // 1024',
  'keep = ["status","reason","formula_cells_checked","mismatch_count","mismatches_likely_masked_upstream_error_count","unresolved_error_count","unconverged_circular_groups","converged_circular_groups","offset_cells_excluded","multicell_named_range_cells_excluded","external_reference_cells_excluded","tainted_downstream_cells_excluded","formula_cells","threshold"]',
  'print(json.dumps({"summary": {k: res.get(k) for k in keep if k in res}, "peak_rss_mb": round(kb/1024), "seconds": round(time.time()-t, 1)}))'
].join('\n');

function recalc(file) {
  return new Promise(resolve => {
    const p = spawn('python3', ['-c', WRAPPER, path.join(ROOT, 'src'), file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', () => {});                       // progress lines go to stderr; the record needs only the result
    const timer = setTimeout(() => p.kill('SIGKILL'), 30 * 60 * 1000);
    p.on('close', code => {
      clearTimeout(timer);
      try { const lines = out.trim().split('\n'); resolve(JSON.parse(lines[lines.length - 1])); }
      catch (_) { resolve({ summary: { status: 'failed_to_run', exit_code: code }, peak_rss_mb: null, seconds: null }); }
    });
  });
}

async function timed(label, fn, rec) {
  const t = Date.now();
  let value, error = null;
  try { value = await fn(); } catch (e) { error = e.message; }
  rec.stages[label] = { seconds: +((Date.now() - t) / 1000).toFixed(1), node_rss_mb_after: Math.round(process.memoryUsage().rss / 1048576), error };
  console.log(`  ${label.padEnd(14)} ${rec.stages[label].seconds}s  node rss ${rec.stages[label].node_rss_mb_after} MB${error ? '  ERROR ' + error : ''}`);
  return value;
}

(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) { console.error('usage: node scripts/baseline-run.js <workbook> [--no-recalc]'); process.exit(1); }
  const rec = { schema: 1, provenance: await buildRunProvenance({ filePath: file, originalName: path.basename(file) }), platform: process.platform, stages: {}, counts: {} };
  console.log(`Baseline run: ${rec.provenance.input_name}\n  sha256 ${rec.provenance.input_sha256}\n  commit ${String(rec.provenance.code_commit).slice(0, 12)}`);

  const parsed = await timed('parse', () => parseExcel(file), rec);
  if (!parsed) process.exit(2);
  const tier0 = await timed('tier0', () => runTier0(parsed), rec);
  if (tier0) {
    const s = tier0.stats || {};
    rec.counts.formula_cells = s.totalFormulaCells; rec.counts.unique_formulas = s.uniqueFormulaCount;
    rec.counts.sheets = parsed.sheetNames.length;
  }
  const scan = await timed('sum_range_scan', () => scanSumRanges(parsed._raw), rec);
  if (scan) rec.counts.sum_range = { cells_scanned: scan.cellsScanned, rows_scanned: scan.rowsScanned, flagged: scan.flaggedCount };
  if (!process.argv.includes('--no-recalc')) {
    const t = Date.now();
    const r = await recalc(file);
    rec.stages.recalc = { seconds: r.seconds != null ? r.seconds : +((Date.now() - t) / 1000).toFixed(1), python_peak_rss_mb: r.peak_rss_mb };
    rec.counts.recalc = r.summary;
    console.log(`  recalc         ${rec.stages.recalc.seconds}s  python peak rss ${r.peak_rss_mb} MB  status ${r.summary && r.summary.status}`);
  }
  rec.node_peak_rss_mb = Math.round((process.resourceUsage().maxRSS || 0) / 1024);
  console.log(`  node peak rss  ${rec.node_peak_rss_mb} MB`);

  const safe = path.basename(file).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
  const out = path.join(ROOT, 'baseline', `${safe}.${String(rec.provenance.input_sha256).slice(0, 12)}.${process.platform}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(rec, null, 2));
  console.log('Written: ' + path.relative(ROOT, out));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(3); });
