'use strict';
// Rule-scope exclusions for the audit-completion figure.
//
// A rule that cannot apply to this model type (e.g. toll-road tests on an
// electricity system operator) is removed from the completion denominator, from
// the Validation Matrix and from the Issue Log. The decision is logged and
// stored server-side ONLY (data/rule-exclusions/<run>.json) - the report says
// nothing about it by design.
//
// Safety properties (all enforced here, all configurable in
// config/rule-exclusions.json):
//   - exclude-list only: an unrecognised or new rule always counts
//   - never excludes fatal-gate rules
//   - never excludes a rule that reached a Pass / Issue verdict
//   - never excludes a rule that was not returned at all (keeps "Not Run" honest)
//   - only excludes rules whose finding is an ABSENCE statement ("No X appears...");
//     a substantive finding stays in the report even if its family is listed
//   - warns loudly if more than maxExcludedShare of planned rules are excluded

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'rule-exclusions.json');
const RECORD_DIR = path.join(__dirname, '..', '..', 'data', 'rule-exclusions');
// A finding counts as an ABSENCE statement ("this model has no X") when it opens with one, or says
// early on that the content does not exist. It is vetoed (rule stays in scope) if it hedges that
// something analogous does exist - that is partial relevance, not "not applicable".
const ABSENCE_START_RE = /^\s*(no |there (is|are) no |none of |not applicable|n\/a)/i;
const ABSENCE_EARLY_RE = /\b(contains?|has|have|includes?|shows?|holds?|exists?)\s+(any\s+)?no\b|\bnone of\b|\bno\b[^.;]{0,80}\b(exist|exists|appear|appears|present|found|visible|content)\b/i;
const HEDGE_RE = /\b(although|however|analogous|does contain|do contain|partial(ly)?|similar)\b/i;
function isAbsenceFinding(text) {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (HEDGE_RE.test(t)) return false;
  return ABSENCE_START_RE.test(t) || ABSENCE_EARLY_RE.test(t.slice(0, 220));
}

function familyMatches(testName, families) {
  const t = String(testName || '');
  return families.some(f => t === f || t.startsWith(f + '_'));
}

function resultsForRule(ruleId, results) {
  return results.filter(r => r && (r.id === ruleId || String(r.id || '').startsWith(ruleId + '-')));
}

function noop(reason) {
  return { applied: false, reason, excludedIds: [], isExcluded: () => false, record: null };
}

function applyRuleExclusions({ checklist, t1Results = [], t2Results, domainFile, modelText, originalName, log = console.log, config = null }) {
  let cfg = config;
  if (!cfg) {
    try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
    catch (e) { log(`   \u26a0\ufe0f  Rule-scope exclusions unavailable (${e.message}) - all rules counted`); return noop('config_unreadable'); }
  }
  const text = String(modelText || '').toLowerCase();
  const profile = (cfg.profiles || []).find(p =>
    p.appliesToDomainSkill === domainFile && (p.matchAny || []).some(k => text.includes(String(k).toLowerCase())));
  if (!profile) return noop('no_profile_matched');

  const g = cfg.guardrails || {};
  const active = [];
  for (const [tierName, t] of Object.entries(profile.tiers || {})) {
    if (t && t.enabled) active.push({
      tierName, families: t.families || [],
      // explicitScope: a tier that names rule ids directly (a human scope decision) instead of
      // matching test families. allowFatal lets it exclude fatal-gate rules, which family tiers never may.
      ruleIds: t.ruleIds || [], explicitScope: Array.isArray(t.ruleIds) && t.ruleIds.length > 0,
      allowFatal: t.allowFatal === true, decision: t.decision || null
    });
  }
  if (!active.length) return noop('no_tier_enabled');

  const applies = r => {
    const src = r.source_id || '';
    return !(typeof src === 'string' && src.startsWith('skill-') && src.endsWith('.md')) || src === domainFile;
  };
  const planned = checklist.tier1.length + checklist.tier2.filter(applies).length;

  const excluded = [];
  const protectedRules = [];
  for (const rule of checklist.tier2) {
    if (rule.source_id !== profile.appliesToDomainSkill) continue;
    const hit = active.find(a => familyMatches(rule.test, a.families));
    if (!hit) continue;
    const res = resultsForRule(rule.id, t2Results);
    const prot = reason => protectedRules.push({ id: rule.id, test: rule.test, tier: hit.tierName, reason });
    if ((g.neverExcludeSeverity || []).includes(rule.severity)) { prot('fatal_severity'); continue; }
    if ((g.neverExcludeSourceSectionContains || []).some(s => String(rule.source_section || '').toLowerCase().includes(s))) { prot('fatal_gate_section'); continue; }
    if (!res.length) { prot('not_returned'); continue; }
    if (g.neverExcludeWhenConcluded !== false && res.some(r => r.status !== 'uncertain')) { prot('concluded_verdict'); continue; }
    const finding = res.map(r => String(r.condition || r.finding || r.label || '')).find(s => s.trim()) || '';
    if (g.requireAbsenceTypeFinding !== false && !isAbsenceFinding(finding)) { prot('substantive_finding'); continue; }
    excluded.push({ id: rule.id, test: rule.test, tier: hit.tierName, confidence: res[0].confidence ?? null, finding: finding.slice(0, 240) });
  }

  // Explicit scope decisions: named rule ids, any tier (Tier 1 included), any section. The decision
  // is a human one about the model TYPE, so the absence-wording test does not apply. Two things still
  // protect a rule: a Pass/Issue verdict (real evidence always wins over a scope decision), and a
  // rule that was never returned (so a failed batch still shows as Not Run, not as out of scope).
  const allResults = [...t1Results, ...t2Results];
  const checklistById = new Map([...checklist.tier1, ...checklist.tier2].map(r => [r.id, r]));
  const alreadyExcluded = new Set(excluded.map(e => e.id));
  for (const a of active.filter(x => x.explicitScope)) {
    for (const rid of a.ruleIds) {
      if (alreadyExcluded.has(rid)) continue;
      const rule = checklistById.get(rid);
      const prot = reason => protectedRules.push({ id: rid, test: rule ? (rule.test || rule.label || null) : null, tier: a.tierName, reason });
      if (!rule) { prot('unknown_rule_id'); continue; }
      const isFatal = rule.severity === 'fatal' || (g.neverExcludeSourceSectionContains || []).some(s => String(rule.source_section || '').toLowerCase().includes(s));
      if (isFatal && !a.allowFatal) { prot('fatal_severity'); continue; }
      const res = resultsForRule(rid, allResults);
      if (!res.length) { prot('not_returned'); continue; }
      if (g.neverExcludeWhenConcluded !== false && res.some(r => r.status !== 'uncertain')) { prot('concluded_verdict'); continue; }
      excluded.push({
        id: rid, test: rule.test || null, label: rule.label || null, tier: a.tierName,
        severity: rule.severity || null, decision: a.decision,
        confidence: res[0].confidence ?? null,
        finding: String(res[0].condition || res[0].finding || res[0].reason || '').slice(0, 240)
      });
      alreadyExcluded.add(rid);
    }
  }

  const excludedIds = excluded.map(e => e.id);
  const set = new Set(excludedIds);
  const isExcluded = id => {
    if (!id) return false;
    if (set.has(id)) return true;
    const m = String(id).match(/^(T2-S\d+-\d+)-/);
    return m ? set.has(m[1]) : false;
  };

  const share = planned ? excluded.length / planned : 0;
  const record = {
    generatedAt: new Date().toISOString(),
    originalName: originalName || null,
    domainFile, profileId: profile.id,
    tiersEnabled: active.map(a => a.tierName),
    plannedBefore: planned, excludedCount: excluded.length, plannedAfter: planned - excluded.length,
    excludedShare: Math.round(share * 1000) / 1000,
    protectedByReason: protectedRules.reduce((a, p) => (a[p.reason] = (a[p.reason] || 0) + 1, a), {}),
    excluded, protected: protectedRules
  };

  try {
    fs.mkdirSync(RECORD_DIR, { recursive: true });
    const base = path.parse(String(originalName || 'run')).name.replace(/[^A-Za-z0-9._-]/g, '_');
    fs.writeFileSync(path.join(RECORD_DIR, `${base}.json`), JSON.stringify(record, null, 2));
  } catch (e) { log(`   \u26a0\ufe0f  Could not store rule-exclusion record: ${e.message}`); }

  log(`   \u2139\ufe0f  Rule scope (${profile.id}): ${excluded.length} of ${planned} planned procedures excluded as not applicable to this model type (server log and stored record only) - ${planned - excluded.length} remain`);
  const explicitFatal = excluded.filter(e => e.decision && e.severity === 'fatal');
  if (explicitFatal.length) log(`      Of which ${explicitFatal.length} fatal-gate rule(s) excluded by explicit scope decision: ${explicitFatal.map(e => e.id).join(', ')}`);
  const pr = record.protectedByReason;
  if (Object.keys(pr).length) log(`      Kept in scope despite matching a listed family: ${Object.entries(pr).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  if (share > (g.maxExcludedShare ?? 0.5)) {
    log(`   \u26a0\ufe0f  ${Math.round(share * 100)}% of planned procedures excluded - above the ${Math.round((g.maxExcludedShare ?? 0.5) * 100)}% review threshold. Check data/rule-exclusions/ before relying on the completion figure.`);
  }
  return { applied: true, profileId: profile.id, excludedIds, isExcluded, record };
}

module.exports = { applyRuleExclusions };
