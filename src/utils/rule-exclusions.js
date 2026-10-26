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

function loadExclusionConfig(log = console.log) {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); }
  catch (e) { log(`   \u26a0\ufe0f  Rule-scope exclusions unavailable (${e.message}) - all rules counted`); return null; }
}

// One place decides which profile (if any) a run falls under, so the pre-run scope plan and the
// post-run exclusion pass can never disagree about it.
// A profile is chosen by what the model IS (its description), not by which domain skill the classifier happened
// to load: the same electricity-transmission model is classed "infrastructure" on one run and "corporate" on the
// next, and a scope decision about the model type must not depend on that. A profile sets
// appliesToAnyDomainSkill to say its keywords are specific enough to stand alone; otherwise it still needs the
// named domain skill as well.
function matchProfile(cfg, domainFile, modelText) {
  const text = String(modelText || '').toLowerCase();
  return ((cfg && cfg.profiles) || []).find(p =>
    (p.appliesToAnyDomainSkill === true || p.appliesToDomainSkill === domainFile) &&
    (p.matchAny || []).some(k => text.includes(String(k).toLowerCase()))) || null;
}

// The explicit scope-decision tiers of a profile: tiers that name rule ids directly.
function explicitScopeTiers(profile) {
  return Object.entries((profile && profile.tiers) || {})
    .filter(([, t]) => t && t.enabled && Array.isArray(t.ruleIds) && t.ruleIds.length > 0)
    // category: a tier may record its rules as 'evidence_required' (the workbook cannot settle them) instead of the
    // default 'not_applicable'; the two are shown differently in the report.
    .map(([tierName, t]) => ({ tierName, ruleIds: t.ruleIds, allowFatal: t.allowFatal === true, decision: t.decision || null, category: t.category === 'evidence_required' ? 'evidence_required' : 'not_applicable' }));
}

// preExcluded: rules removed from scope BEFORE the run (not applicable to the model type, needs evidence
// the workbook cannot hold, or deliberately left out of a standard run). They never reach the reviewer, so
// they have no result to protect; they simply leave the planned set, and are recorded here with the
// category they were removed under so every downstream layer reads one record.
function applyRuleExclusions({ checklist, t1Results = [], t2Results, domainFile, modelText, originalName, log = console.log, config = null, preExcluded = [] }) {
  let cfg = config;
  if (!cfg) {
    cfg = loadExclusionConfig(log);
    if (!cfg) { if (!preExcluded.length) return noop('config_unreadable'); cfg = { guardrails: {}, profiles: [] }; }
  }
  const profile = matchProfile(cfg, domainFile, modelText);
  if (!profile && !preExcluded.length) return noop('no_profile_matched');

  const g = cfg.guardrails || {};
  const active = [];
  for (const [tierName, t] of Object.entries((profile && profile.tiers) || {})) {
    if (t && t.enabled) active.push({
      tierName, families: t.families || [],
      // explicitScope: a tier that names rule ids directly (a human scope decision) instead of
      // matching test families. allowFatal lets it exclude fatal-gate rules, which family tiers never may.
      ruleIds: t.ruleIds || [], explicitScope: Array.isArray(t.ruleIds) && t.ruleIds.length > 0,
      allowFatal: t.allowFatal === true, decision: t.decision || null
    });
  }
  if (!active.length && !preExcluded.length) return noop('no_tier_enabled');
  const preSet = new Set(preExcluded.map(p => p.id));

  const applies = r => {
    const src = r.source_id || '';
    return !(typeof src === 'string' && src.startsWith('skill-') && src.endsWith('.md')) || src === domainFile;
  };
  const planned = checklist.tier1.length + checklist.tier2.filter(applies).length;

  const excluded = [];
  const protectedRules = [];
  for (const rule of checklist.tier2) {
    if (!profile || rule.source_id !== profile.appliesToDomainSkill) continue;
    if (preSet.has(rule.id)) continue;
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
      if (alreadyExcluded.has(rid) || preSet.has(rid)) continue;
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

  for (const p of preExcluded) {
    if (alreadyExcluded.has(p.id)) continue;
    const rule = checklistById.get(p.id);
    if (!rule) { protectedRules.push({ id: p.id, test: null, tier: p.tier, reason: 'unknown_rule_id' }); continue; }
    excluded.push({
      id: p.id, test: rule.test || null, label: rule.label || null, tier: p.tier, category: p.category,
      severity: rule.severity || null, decision: p.reason || null, confidence: null, finding: '', preRun: true
    });
    alreadyExcluded.add(p.id);
  }
  // Rules removed after the run (family tiers, explicit scope decisions on rules that did return) are
  // 'not_applicable' unless they carry their own category.
  for (const e of excluded) if (!e.category) e.category = 'not_applicable';

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
    domainFile, profileId: profile ? profile.id : 'global_scope',
    tiersEnabled: active.map(a => a.tierName),
    byCategory: excluded.reduce((a, e) => (a[e.category] = (a[e.category] || 0) + 1, a), {}),
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

  log(`   \u2139\ufe0f  Rule scope (${record.profileId}): ${excluded.length} of ${planned} planned procedures out of scope (${Object.entries(record.byCategory).map(([k, v]) => `${v} ${k}`).join(', ')}) - ${planned - excluded.length} remain`);
  const explicitFatal = excluded.filter(e => e.decision && e.severity === 'fatal');
  if (explicitFatal.length) log(`      Of which ${explicitFatal.length} fatal-gate rule(s) excluded by explicit scope decision: ${explicitFatal.map(e => e.id).join(', ')}`);
  const pr = record.protectedByReason;
  if (Object.keys(pr).length) log(`      Kept in scope despite matching a listed family: ${Object.entries(pr).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  // Only judgement-based exclusions count toward the threshold. Procedures held back by the tiering plan
  // (extended_not_run) are a cost decision, not a statement that the model lacks the structure.
  const judged = excluded.filter(e => e.category === 'not_applicable' || e.category === 'evidence_required').length;
  const judgedShare = planned ? judged / planned : 0;
  if (judgedShare > (g.maxExcludedShare ?? 0.5)) {
    log(`   \u26a0\ufe0f  ${Math.round(judgedShare * 100)}% of planned procedures excluded as not applicable or needing evidence - above the ${Math.round((g.maxExcludedShare ?? 0.5) * 100)}% review threshold. Check data/rule-exclusions/ before relying on the completion figure.`);
  }
  return { applied: true, profileId: record.profileId, excludedIds, isExcluded, record };
}

module.exports = { applyRuleExclusions, matchProfile, explicitScopeTiers, loadExclusionConfig, isAbsenceFinding };
