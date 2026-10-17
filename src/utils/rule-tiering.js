// rule-tiering.js - splits the planned procedures into a CORE set (run every time) and an EXTENDED set
// (optional deep review), using only two domain-neutral signals: the rule's severity, and its track record
// of actually reaching a verdict in earlier runs of the same domain. No per-model or per-domain lists.
//
// A rule is CORE when any of these holds:
//   - it is a Tier 1 (deterministic, free) rule
//   - its severity is in config.alwaysCoreSeverities (fatal / critical / high by default)
//   - it has reached a Pass or Raised Issue verdict in at least one earlier run of this domain
//   - it falls in this run's rotating exploration sample (so a rule that starts concluding after a skill
//     improvement can earn its way in, and the history never goes stale)
// Everything else is EXTENDED. A domain with fewer than config.minRunsBeforeTiering recorded runs is not
// tiered at all: every rule runs until there is enough history to judge.
'use strict';

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

function assignTiers({ plannedIds, severityById = {}, history = null, config = {}, runKey = '' }) {
  const cfg = Object.assign({ enabled: true, minRunsBeforeTiering: 2, alwaysCoreSeverities: ['fatal', 'critical', 'high'], explorationRate: 0.10 }, config);
  const all = Array.from(plannedIds);
  if (!cfg.enabled) return { applied: false, reason: 'tiering disabled in config', core: all, extended: [], explored: [] };
  if (!history || !history.rules || (history.runs || 0) < cfg.minRunsBeforeTiering) {
    return { applied: false, reason: `only ${history ? history.runs || 0 : 0} recorded run(s) for this domain (need ${cfg.minRunsBeforeTiering}) - running every procedure to build history`, core: all, extended: [], explored: [] };
  }
  const alwaysCore = new Set(cfg.alwaysCoreSeverities);
  const core = [], extended = [], explored = [];
  for (const id of all) {
    if (id.startsWith('T1-')) { core.push(id); continue; }
    if (alwaysCore.has(severityById[id])) { core.push(id); continue; }
    const h = history.rules[id];
    if (h && h.concluded > 0) { core.push(id); continue; }
    if (fnv1a(`${id}|${runKey}`) % 1000 < Math.round(cfg.explorationRate * 1000)) { core.push(id); explored.push(id); continue; }
    extended.push(id);
  }
  return { applied: true, reason: `${history.runs} recorded run(s) for this domain`, core, extended, explored };
}

// Pure: returns a new history object with this run's verdicts folded in. 'Not Performed' (a rule the
// reviewer skipped) says nothing about whether the rule can conclude, so it is not counted.
function foldRunIntoHistory(history, domain, ruleStatuses) {
  const next = { domain, runs: (history && history.runs) || 0, updated: new Date().toISOString().slice(0, 10), rules: Object.assign({}, history && history.rules) };
  next.runs += 1;
  for (const [id, status] of Object.entries(ruleStatuses)) {
    if (status === 'Not Performed' || status == null) continue;
    const e = Object.assign({ runs: 0, concluded: 0, last: null }, next.rules[id]);
    e.runs += 1; if (status === 'Pass' || status === 'Raised Issue') e.concluded += 1; e.last = status;
    next.rules[id] = e;
  }
  return next;
}

module.exports = { assignTiers, foldRunIntoHistory, fnv1a };
