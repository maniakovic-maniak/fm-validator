'use strict';
// rule-scope.js - the ONE place that decides which procedures are in scope for a run, and the ONE
// place (on the JavaScript side) that turns results into completion figures.
//
// Why it exists: the report, the Validation Matrix, the completion tile, the hold gate, Improvement
// Signals and the Partner Review export all need the same answer to "which procedures were planned for
// this model?". Before this module each layer worked it out for itself, so a change to scope had to be
// repeated by hand in several places. Now:
//
//   buildScopePlan()      runs once, BEFORE Tier 2. Decides what is out of scope and why.
//   applyRuleExclusions() (rule-exclusions.js) records that decision, plus the post-run exclusions,
//                         in data/rule-exclusions/<run>.json and hands the full list of excluded ids on.
//   everything downstream reads that one list (report builder, nurse gather, Partner Review export).
//   computeCompletion()   is the JS twin of src/completion.py; test-scope-sync.js proves they agree.
//
// Three reasons a procedure can leave the plan, all knowable before the run and independent of how the
// run turns out (a procedure that was run and could not conclude is NEVER removed - that is a real gap):
//   not_applicable     - does not apply to this model type (explicit scope decisions in rule-exclusions.json)
//   evidence_required  - needs records outside the workbook (config/rule-scope.json, domain-independent)
//   extended_not_run   - lower-severity procedure with no verdict in earlier reviews of this model type
//                        (rule-tiering.js); a "full review" (fullScope) runs these too.

const fs = require('fs');
const path = require('path');
const { assignTiers, foldRunIntoHistory } = require('./rule-tiering');
const { matchProfile, explicitScopeTiers, loadExclusionConfig } = require('./rule-exclusions');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_DIRS = {
  scopeConfig: path.join(ROOT, 'config', 'rule-scope.json'),
  tieringConfig: path.join(ROOT, 'config', 'rule-tiering.json'),
  historyDir: path.join(ROOT, 'data', 'rule-history'),          // runtime, gitignored (/data/)
  seedDir: path.join(ROOT, 'config', 'rule-history-seed')       // shipped starting point
};

// Same test validator-tier2.js uses to drop rules that belong to another domain's skill file.
const DOMAIN_SPECIFIC_SOURCE_RE = /^skill-(?!generic\.md$)[\w-]+\.md$/;
const FCH = new Set(['fatal', 'critical', 'high']);
const WEIGHTS = { fatal: 5, critical: 4, high: 3 };

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }

function domainKey(domainFile) {
  const b = path.basename(String(domainFile || '')).replace(/^skill-/, '').replace(/\.md$/, '');
  return b || 'generic';
}

// Tier 2 rules that belong in this run at all (right domain). Mirrors validator-tier2.js.
function applicableTier2(checklist, domainFile) {
  return (checklist.tier2 || []).filter(r => {
    const src = r.source_id || '';
    return !DOMAIN_SPECIFIC_SOURCE_RE.test(src) || src === path.basename(String(domainFile || ''));
  });
}

// Every rule counted as "planned" for this model: Tier 1 + domain-applicable Tier 2, minus excluded ids.
function plannedRules(checklist, domainFile, excludedIds = []) {
  const ex = new Set(excludedIds);
  return [...(checklist.tier1 || []), ...applicableTier2(checklist, domainFile)].filter(r => !ex.has(r.id));
}

function loadHistory(key, dirs = DEFAULT_DIRS) {
  return readJson(path.join(dirs.historyDir, `${key}.json`)) || readJson(path.join(dirs.seedDir, `${key}.json`));
}

function saveHistory(key, history, dirs = DEFAULT_DIRS) {
  fs.mkdirSync(dirs.historyDir, { recursive: true });
  const target = path.join(dirs.historyDir, `${key}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(history, null, 1));
  fs.renameSync(tmp, target);          // atomic: a crash never leaves a half-written history
}

/**
 * Procedures whose own instruction starts "Trigger: ..." apply only when that pattern is in the workbook.
 * config/rule-scope.json lists, per procedure, the facts any one of which keeps it in scope. Facts come from the
 * file (sheet names, Tier 0 OFFSET count, the VBA scan) - never from a run's outcome. No facts, or an unknown
 * fact type, keeps the procedure in scope.
 * @returns {Array<{id:string, reason:string}>}
 */
function evaluatePreconditions(cfg, facts) {
  if (!cfg || cfg.enabled === false || !facts) return [];
  const holds = c => {
    switch (c && c.fact) {
      case 'sheetNameMatches': { try { const re = new RegExp(c.pattern, 'i'); return (facts.sheetNames || []).some(n => re.test(String(n))); } catch (_) { return true; } }
      case 'offsetCountAtLeast': return typeof facts.offsetCount === 'number' ? facts.offsetCount >= (c.value || 1) : true;
      case 'vbaManipulatesCalculation': return typeof facts.vbaManipulatesCalculation === 'boolean' ? facts.vbaManipulatesCalculation : true;
      default: return true;                         // unknown condition: do not remove anything
    }
  };
  const out = [];
  for (const r of cfg.rules || []) {
    if ((r.requiresAny || []).some(holds)) continue;
    for (const id of r.ruleIds || []) out.push({ id, reason: r.reason || 'Trigger not present in this workbook.' });
  }
  return out;
}

function buildScopePlan({ checklist, domainFile, modelText = '', runKey = '', fullScope = false, log = console.log, configs = {}, dirs = DEFAULT_DIRS, facts = null }) {
  const t2 = applicableTier2(checklist, domainFile);
  const t2Ids = new Set(t2.map(r => r.id));
  const sev = Object.fromEntries(t2.map(r => [r.id, r.severity]));
  const preExcluded = [];
  const taken = new Set();
  const take = (id, category, tier, reason) => { if (!taken.has(id)) { taken.add(id); preExcluded.push({ id, category, tier, reason }); } };

  // 1. Not applicable to this model type: explicit scope decisions naming Tier 2 rules. (Tier 1 rules in
  //    those tiers stay in the post-run pass: they are deterministic and free, so there is nothing to save.)
  const exCfg = configs.exclusions || loadExclusionConfig(log);
  const profile = exCfg ? matchProfile(exCfg, path.basename(String(domainFile || '')), modelText) : null;
  for (const t of explicitScopeTiers(profile)) {
    for (const id of t.ruleIds) {
      if (!t2Ids.has(id)) continue;
      if (sev[id] === 'fatal' && !t.allowFatal) continue;
      take(id, t.category === 'evidence_required' ? 'evidence_required' : 'not_applicable', t.tierName, t.decision);
    }
  }

  const scopeCfg = configs.scope || readJson(dirs.scopeConfig) || {};

  // 1b. Trigger not present in this workbook (the procedure's own precondition), independent of domain.
  for (const p of evaluatePreconditions(scopeCfg.preconditions, facts)) {
    if (!t2Ids.has(p.id)) continue;
    if (sev[p.id] === 'fatal' && !(scopeCfg.preconditions || {}).allowFatal) continue;
    take(p.id, 'not_applicable', 'P_precondition_absent', p.reason);
  }

  // 2. Needs evidence outside the workbook: domain-independent list.
  const ev = scopeCfg.evidenceRequired;
  if (ev && ev.enabled) {
    for (const id of ev.ruleIds || []) {
      if (!t2Ids.has(id)) continue;
      if (sev[id] === 'fatal' && !ev.allowFatal) continue;
      take(id, 'evidence_required', 'E_evidence_required', ev.reason || null);
    }
  }

  // 3. Extended tier: lower-severity rules with no verdict in earlier reviews of this domain.
  const key = domainKey(domainFile);
  const history = configs.history !== undefined ? configs.history : loadHistory(key, dirs);
  let tiering = { applied: false, reason: 'full review requested', core: [], extended: [], explored: [] };
  if (!fullScope) {
    const remaining = t2.map(r => r.id).filter(id => !taken.has(id));
    const tcfg = configs.tiering || readJson(dirs.tieringConfig) || {};
    tiering = assignTiers({ plannedIds: remaining, severityById: sev, history, config: tcfg, runKey });
    const maxShare = (scopeCfg.limits && scopeCfg.limits.maxSkipShareOfTier2) ?? 0.6;
    const wouldSkip = preExcluded.length + tiering.extended.length;
    if (tiering.applied && t2.length && wouldSkip / t2.length > maxShare) {
      log(`   ⚠️  Scope plan would leave out ${wouldSkip} of ${t2.length} Tier 2 procedures (above the ${Math.round(maxShare * 100)}% limit) - running the extended tier this time`);
      tiering = Object.assign({}, tiering, { applied: false, reason: 'skip share above limit', extended: [] });
    }
    for (const id of tiering.extended) {
      take(id, 'extended_not_run', 'X_extended_not_run', `No verdict in earlier reviews of this model type (${tiering.reason}); runs in a full review.`);
    }
  }

  const counts = preExcluded.reduce((a, p) => (a[p.category] = (a[p.category] || 0) + 1, a), {});
  const plan = {
    domainKey: key, fullScope: !!fullScope, preExcluded,
    skipRuleIds: new Set(preExcluded.map(p => p.id)),
    tiering: { applied: tiering.applied, reason: tiering.reason, explored: tiering.explored },
    counts, tier2Applicable: t2.length, tier2ToRun: t2.length - preExcluded.length
  };
  log(`   ℹ️  Scope plan (${key}${fullScope ? ', full review' : ''}): ${plan.tier2ToRun} of ${t2.length} Tier 2 procedures will run` +
      (preExcluded.length ? ` - left out before the run: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}` : '') +
      (tiering.applied ? ` [tiering: ${tiering.reason}; ${tiering.explored.length} exploration pick(s)]` : (fullScope ? '' : ` [tiering off: ${tiering.reason}]`)));
  return plan;
}

// What the report is allowed to say about scope: counts by category, plus the evidence-required items by
// name (those are real work the client can still do with source documents).
function summarizeScopeForReport(exclusionRecord, plan, scopeCfg) {
  const cfg = scopeCfg || readJson(DEFAULT_DIRS.scopeConfig) || {};
  const ex = (exclusionRecord && exclusionRecord.excluded) || [];
  const by = c => ex.filter(e => e.category === c);
  return {
    discloseInReport: cfg.discloseInReport !== false,
    notApplicable: by('not_applicable').length,
    evidenceRequired: by('evidence_required').map(e => ({ id: e.id, label: e.label })),
    extendedNotRun: by('extended_not_run').length,
    fullReview: !!(plan && plan.fullScope),
    tier2Sent: plan && Number.isFinite(plan.tier2ToRun) ? plan.tier2ToRun : null      // Patch 36: how many Tier 2 procedures the reviewer was asked to answer
  };
}

function matches(ruleId, resultId) { return resultId === ruleId || String(resultId || '').startsWith(`${ruleId}-`); }

// Status of one planned rule, exactly as the Validation Matrix derives it.
function ruleStatus(ruleId, ruleResults) {
  const res = ruleResults.filter(r => r && matches(ruleId, r.id));
  if (!res.length) return 'Not Performed';
  if (res.some(r => r.status !== 'pass' && r.status !== 'uncertain')) return 'Raised Issue';
  if (res.some(r => r.status === 'uncertain')) return 'Uncertain';
  return 'Pass';
}

// JS twin of src/completion.py. Same inputs, same outputs; test-scope-sync.js keeps them identical.
function computeCompletion(planned, ruleResults) {
  const c = { planned: planned.length, pass: 0, issue: 0, uncertain: 0, notRun: 0, fch: { planned: 0, concluded: 0 }, weighted: { total: 0, concluded: 0 } };
  const statusById = {};
  for (const rule of planned) {
    const st = ruleStatus(rule.id, ruleResults);
    statusById[rule.id] = st;
    const w = WEIGHTS[rule.severity] || 1;
    const done = st === 'Pass' || st === 'Raised Issue';
    if (st === 'Pass') c.pass++; else if (st === 'Raised Issue') c.issue++; else if (st === 'Uncertain') c.uncertain++; else c.notRun++;
    c.weighted.total += w; if (done) c.weighted.concluded += w;
    if (FCH.has(rule.severity)) { c.fch.planned++; if (done) c.fch.concluded++; }
  }
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0);   // note: JS rounds .5 up; completion.py mirrors this
  c.concludedPct = pct(c.pass + c.issue, c.planned);
  c.fchPct = pct(c.fch.concluded, c.fch.planned);
  c.weightedPct = pct(c.weighted.concluded, c.weighted.total);
  return { counts: c, statusById };
}

// After a finished run: fold this run's verdicts into the domain history so the next run's extended tier
// reflects what actually concludes. Never throws - history is an optimisation, not a dependency.
function recordRunInHistory({ domainFile, statusById, log = console.log, dirs = DEFAULT_DIRS }) {
  try {
    const key = domainKey(domainFile);
    const prev = loadHistory(key, dirs);
    const next = foldRunIntoHistory(prev, key, statusById);
    saveHistory(key, next, dirs);
    log(`   ℹ️  Rule history for "${key}" updated: ${next.runs} run(s) recorded`);
    return next;
  } catch (e) {
    log(`   ⚠️  Could not update rule history (${e.message}) - next run will use the previous history`);
    return null;
  }
}

module.exports = {
  buildScopePlan, evaluatePreconditions, summarizeScopeForReport, computeCompletion, ruleStatus, plannedRules, applicableTier2,
  recordRunInHistory, loadHistory, saveHistory, domainKey, DEFAULT_DIRS
};
