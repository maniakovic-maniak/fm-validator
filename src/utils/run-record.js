'use strict';
// run-record.js - Patch 40. The automated assessment of one run, bound to what it rests on.
//
// This replaces the reviewerApproved flag. That flag was never passed from the server, so the highest reliance tier could
// not be reached at all, and a flag set to true would have proved nothing. The owner's decision (30 Oct 2026) is that no
// human sign-off is compulsory: the system issues its own assessment, and says where the evidence is incomplete.
//
// The record holds no opinion about the model. It holds the evidence the assessment rests on and the list of gaps in it:
//   - who/what was assessed: model identity, workbook hash, the settings and code in force (rule set, config file hashes,
//     code commit), the priority-output list and its file hash
//   - what the tests actually showed: independent recalculation, path checks, the review batches, provenance
//   - gaps: each piece of evidence the highest reliance tier needs and this run does not have
// build_report.py reads `gaps` to decide whether the highest tier is available and prints them. Because every gap names a
// test result, the tier cannot be reached by setting a field; it is reached when the tests support it.
//
// The fingerprint is a hash of the bound content (not the creation time), so the same input, settings and evidence give the
// same fingerprint and any change in one of them changes it.
const fs = require('fs');
const crypto = require('crypto');
const { normalizeModelIdentity } = require('./finding-history');
const { registryCeiling } = require('./output-registry');
const { pathCheckRows } = require('./path-checks');

const SCHEMA = 1;
const MIN_RECALC_COVERAGE_PCT = 90;

const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x);

function recalcEvidence(r) {
  if (!r || typeof r !== 'object') return { status: 'not_run', detail: 'no recalculation result was supplied' };
  if (r.status !== 'success') return { status: 'not_completed', detail: `recalculation status: ${r.status || 'unknown'}` };
  const excluded = ['offset_cells_excluded', 'multicell_named_range_cells_excluded', 'external_reference_cells_excluded', 'tainted_downstream_cells_excluded'].reduce((a, k) => a + (Number(r[k]) || 0), 0);
  const checked = Number(r.formula_cells_checked) || 0;
  const total = checked + excluded;
  return {
    status: 'completed', cells_checked: checked, cells_excluded: excluded,
    coverage_pct: total > 0 ? Math.round(checked / total * 100) : null,
    mismatches: Number(r.mismatch_count) || 0, unresolved_errors: Number(r.unresolved_error_count) || 0,
  };
}

function pathEvidence(pathChecks) {
  // A path-check run that produced nothing at all is a failure, not a clean result.
  if (!pathChecks) return { criteria: [], failed: ['all path checks (the run produced no result)'] };
  const summary = pathCheckRows(pathChecks).summary || [];
  return { criteria: summary.map(s => ({ criterion: s.criterion, tested: s.tested || 0, failed: s.failed || null, not_completed: s.notCompleted || 0 })), failed: summary.filter(s => s.failed).map(s => s.criterion) };
}

/** The gaps: each is { key, text } and each keeps the highest reliance tier from being issued. */
function evidenceGaps(ev) {
  const gaps = [];
  const reg = ev.registry;
  if (!reg || !reg.usable) gaps.push({ key: 'priority_outputs', text: reg ? reg.text : 'no approved list of priority outputs exists for this model' });
  const rc = ev.recalculation;
  if (!rc || rc.status !== 'completed') gaps.push({ key: 'recalculation', text: `no independent recalculation was completed (${(rc && rc.detail) || 'not run'}), so the model's own saved values are not independently confirmed` });
  else {
    if (rc.mismatches > 0) gaps.push({ key: 'recalculation', text: `the independent recalculation disagreed with the saved values in ${rc.mismatches} cell(s)` });
    if (rc.coverage_pct !== null && rc.coverage_pct < MIN_RECALC_COVERAGE_PCT) gaps.push({ key: 'recalculation_coverage', text: `the independent recalculation covered ${rc.coverage_pct}% of formula cells (at least ${MIN_RECALC_COVERAGE_PCT}% is needed)` });
  }
  if (ev.path_checks.failed.length) gaps.push({ key: 'path_checks', text: `path check(s) did not complete: ${ev.path_checks.failed.join(', ')}` });
  if (ev.batches.failed > 0) gaps.push({ key: 'review_batches', text: `${ev.batches.failed} review batch(es) failed to complete` });
  if (!ev.provenance.input_sha256 || ev.provenance.input_sha256 === 'unknown') gaps.push({ key: 'provenance', text: 'the audited file could not be hashed, so the assessment cannot be tied to a file revision' });
  return gaps;
}

/**
 * @param ctx { originalName, provenance, registryState, recalcCheckResult, pathChecks, batchFailures }
 *   registryState is the result of loadRegistryState, then checkRegistryAgainstWorkbook.
 */
function buildRunRecord(ctx = {}) {
  const prov = ctx.provenance || {};
  const regState = ctx.registryState || { status: 'none' };
  const ceiling = registryCeiling(regState);
  const evidence = {
    registry: { status: regState.status, usable: !ceiling.capsTopTier, text: ceiling.text, file: regState.file || null, file_sha256: regState.sha256 || null, outputs_defined: regState.outputs || 0, outputs_found: regState.resolved ?? null, unresolved: (regState.unresolved || []).slice(0, 10) },
    recalculation: recalcEvidence(ctx.recalcCheckResult),
    path_checks: pathEvidence(ctx.pathChecks),
    batches: { failed: Array.isArray(ctx.batchFailures) ? ctx.batchFailures.length : 0 },
    provenance: { input_sha256: prov.input_sha256 || 'unknown' },
  };
  const binding = {
    schema: SCHEMA,
    model: normalizeModelIdentity(ctx.originalName || prov.input_name || 'unknown'),
    workbook_sha256: prov.input_sha256 || 'unknown',
    code_commit: prov.code_commit || 'unknown',
    rule_version: prov.rule_version || 'unknown',
    config_files: prov.config_files || {},
    registry_file_sha256: regState.sha256 || null,
    evidence,
  };
  const gaps = evidenceGaps(evidence);
  return Object.assign({ created_at: new Date().toISOString(), issued_by: 'automated review' }, binding, { gaps, fingerprint: crypto.createHash('sha256').update(stable(Object.assign({}, binding, { gaps }))).digest('hex') });
}

function recordPathFor(reportPath) { return String(reportPath).replace(/\.xlsx$/i, '') + '.runrecord.json'; }
function writeRunRecord(reportPath, rec) {
  try { fs.writeFileSync(recordPathFor(reportPath), JSON.stringify(rec, null, 2)); return true; }
  catch (e) { console.error('   ⚠️  Could not write run record:', e.message); return false; }
}

module.exports = { buildRunRecord, evidenceGaps, recalcEvidence, writeRunRecord, recordPathFor, MIN_RECALC_COVERAGE_PCT };
