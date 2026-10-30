'use strict';
// run-provenance.js - Patch 27. A record of exactly what was audited and by what, so a later reader can tell whether
// two reports describe the same input, the same code and the same rules. It answers "which file, which commit, which
// rule set" from the report itself instead of from memory (the AP242 dispute in the 29 Oct independent review could
// not be settled for want of this).
//
// Everything here is cheap: one streaming hash of the upload, one hash per config file, and a read of .git/HEAD.
// It never throws; a field it cannot determine is the string 'unknown', so a run is never blocked by provenance.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const SCHEMA = 1;

function sha256File(filePath) {
  return new Promise(resolve => {
    try {
      const h = crypto.createHash('sha256');
      const s = fs.createReadStream(filePath);
      s.on('data', d => h.update(d));
      s.on('error', () => resolve({ sha256: 'unknown', bytes: null }));
      s.on('end', () => { let bytes = null; try { bytes = fs.statSync(filePath).size; } catch (_) {} resolve({ sha256: h.digest('hex'), bytes }); });
    } catch (_) { resolve({ sha256: 'unknown', bytes: null }); }
  });
}

function sha256Text(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

// The commit the running code was checked out at. GIT_COMMIT (set by a deploy script) wins; otherwise .git is read
// directly, so no git binary or child process is needed on the server.
function codeCommit(root = ROOT) {
  if (process.env.GIT_COMMIT) return String(process.env.GIT_COMMIT).trim();
  try {
    const head = fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) return head;
    const ref = head.slice(4).trim();
    const loose = path.join(root, '.git', ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim();
    const packed = fs.readFileSync(path.join(root, '.git', 'packed-refs'), 'utf8').split('\n');
    const line = packed.find(l => l.trim().endsWith(' ' + ref));
    if (line) return line.trim().split(' ')[0];
  } catch (_) {}
  return 'unknown';
}

// The files that decide what is checked and how the reviewer is told to check it.
function ruleFiles(root = ROOT) {
  const out = [];
  const cfg = path.join(root, 'config');
  try {
    for (const f of fs.readdirSync(cfg).sort()) {
      if (/^(checklist|rule-exclusions|rule-scope|rule-tiering|finding-class|chunking)\.json$/.test(f) || /^(skill.*|soul)\.md$/.test(f)) out.push(path.join(cfg, f));
    }
  } catch (_) {}
  // The recorded rule outcomes that seed the scope plan (rule-tiering reads them).
  try {
    const seed = path.join(cfg, 'rule-history-seed');
    for (const f of fs.readdirSync(seed).sort()) if (/\.json$/.test(f)) out.push(path.join(seed, f));
  } catch (_) {}
  return out;
}

function configHashes(root = ROOT) {
  const files = {};
  for (const f of ruleFiles(root)) {
    try { files[path.basename(f)] = sha256Text(fs.readFileSync(f, 'utf8')).slice(0, 12); } catch (_) {}
  }
  // One short id for the whole rule set: change any rule, exclusion or skill file and it changes.
  const rule_version = Object.keys(files).length ? sha256Text(Object.keys(files).map(k => k + ':' + files[k]).join('|')).slice(0, 12) : 'unknown';
  return { rule_version, files };
}

// The Claude model names written in the source (the calls name them literally). Reported as found, not assumed.
function modelIds(root = ROOT) {
  const ids = new Set();
  for (const rel of ['src/validator-tier2.js', 'src/validator-formula-deepdive.js']) {
    try {
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      const re = /model:\s*'(claude-[a-z0-9.-]+)'/g;
      let m; while ((m = re.exec(text)) !== null) ids.add(m[1]);
    } catch (_) {}
  }
  return [...ids].sort();
}

async function buildRunProvenance({ filePath, originalName, extra } = {}) {
  const input = filePath ? await sha256File(filePath) : { sha256: 'unknown', bytes: null };
  const cfg = configHashes();
  return Object.assign({
    schema: SCHEMA,
    created_at: new Date().toISOString(),
    input_name: originalName || (filePath ? path.basename(filePath) : 'unknown'),
    input_sha256: input.sha256,
    input_bytes: input.bytes,
    code_commit: codeCommit(),
    rule_version: cfg.rule_version,
    config_files: cfg.files,
    model_ids: modelIds(),
    node: process.version
  }, extra || {});
}

// reports/<name>.xlsx -> reports/<name>.provenance.json, beside the report so the 30-day sweep treats them alike.
function provenancePathFor(reportPath) { return String(reportPath).replace(/\.xlsx$/i, '') + '.provenance.json'; }

function writeProvenance(reportPath, prov) {
  try { fs.writeFileSync(provenancePathFor(reportPath), JSON.stringify(prov, null, 2)); return true; }
  catch (e) { console.error('   ⚠️  Could not write provenance record:', e.message); return false; }
}

// The lines the Scope and Reliance tab shows. Kept here so the wording is tested in one place.
function provenanceRows(prov) {
  if (!prov) return [];
  const short = s => (s && s !== 'unknown' ? String(s).slice(0, 12) : 'unknown');
  return [
    ['Input file hash (SHA-256)', prov.input_sha256 && prov.input_sha256 !== 'unknown' ? prov.input_sha256 : 'unknown'],
    ['Input size', prov.input_bytes != null ? `${Number(prov.input_bytes).toLocaleString('en-US')} bytes` : 'unknown'],
    ['Validator code version', short(prov.code_commit)],
    ['Rule set version', short(prov.rule_version)],
    ['Reviewer model(s)', (prov.model_ids && prov.model_ids.length) ? prov.model_ids.join(', ') : 'unknown']
  ];
}

module.exports = { buildRunProvenance, writeProvenance, provenancePathFor, provenanceRows, sha256File, codeCommit, configHashes, modelIds };
