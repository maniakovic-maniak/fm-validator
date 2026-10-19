'use strict';
// finding-class.js - rate and group findings from named Tier 2 procedures (config/finding-class.json).
//
// An independent review of a licence-model report called five governance absences (no change log, no checks sheet,
// no version register, no issues register) "governance improvement, consolidate, low priority" and two missing
// stress cases "design preference". Both are real observations about the workbook, but rating them P2 as if they
// were calculation defects buries the findings that matter. This applies the recorded decision:
//   - rules that share one remedy are grouped (all models);
//   - for a matched scope profile, governance absences are capped at low severity and design-preference rules
//     become Observations, with a visible note saying why.
// It changes presentation only. Whether a procedure counts as performed or raised an issue is not touched.

const path = require('path');
const fs = require('fs');

let _cfg = null;
function loadConfig() {
  if (_cfg) return _cfg;
  try { _cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'finding-class.json'), 'utf8')); }
  catch (e) { _cfg = { sameRemediationGroups: [], profiles: {} }; }
  return _cfg;
}

const SEV_RANK = { fatal: 4, critical: 3, high: 2, medium: 1, low: 0 };
const baseId = id => String(id || '').split(/[\s(]/)[0];
const addNote = (f, note) => {
  if (!note || String(f.condition || '').includes(note)) return;
  f.condition = (f.condition || '') + ` (${note})`;
};

/**
 * @param findings  allFlagged (mutated in place)
 * @param opts.profileId  matched scope profile id, or null/undefined
 * @param opts.config     override config (tests)
 * @returns {{capped:string[], observations:string[], groups:string[]}}
 */
function applyFindingClasses(findings, { profileId = null, config = null } = {}) {
  const cfg = config || loadConfig();
  const out = { capped: [], observations: [], groups: [] };
  const profile = profileId && cfg.profiles ? cfg.profiles[profileId] : null;

  if (profile && profile.governanceImprovement) {
    const g = profile.governanceImprovement;
    const ids = new Set(g.ruleIds);
    for (const f of findings) {
      if (!ids.has(baseId(f.id)) || f.record_type) continue;
      const sev = String(f.severity || '').toLowerCase();
      if ((SEV_RANK[sev] ?? 0) > (SEV_RANK[g.maxSeverity] ?? 0)) {
        f.severity_before_class = f.severity;
        f.severity = g.maxSeverity;
        addNote(f, g.note);
        out.capped.push(f.id);
      }
    }
  }
  if (profile && profile.designPreference) {
    const d = profile.designPreference;
    const ids = new Set(d.ruleIds);
    for (const f of findings) {
      if (!ids.has(baseId(f.id)) || f.record_type) continue;
      f.record_type = d.recordType || 'Observation';
      addNote(f, d.note);
      out.observations.push(f.id);
    }
  }
  return out;
}

// Group findings that share one remedy by rule id. Run AFTER linkRelatedFindings: a group found from shared cells wins.
function groupSameRemediation(findings, { config = null } = {}) {
  const cfg = config || loadConfig();
  const groups = [];
  for (const g of cfg.sameRemediationGroups || []) {
    const ids = new Set(g.ruleIds);
    const members = findings.filter(f => ids.has(baseId(f.id)));
    if (members.length < 2) continue;
    for (const f of members) {
      const others = members.filter(m => m !== f).map(m => m.id);
      f.related_ids = [...new Set([...(f.related_ids || []), ...others])];
      if (!f.related_group_id) f.related_group_id = g.id;
      const note = `Same remedy as ${others.join(', ')}: ${g.note || g.label}`;
      if (!String(f.condition || '').includes('Same remedy as')) f.condition = (f.condition || '') + ` (${note})`;
    }
    groups.push(g.id);
  }
  return groups;
}

module.exports = { applyFindingClasses, groupSameRemediation };
