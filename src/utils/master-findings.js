'use strict';
// master-findings.js - Patch 19. The P1/P2/P3 memo asks for one master finding per root cause, with its occurrences,
// so repeated or look-alike findings do not inflate the count. related-findings.js and finding-class.js already link
// findings that share cells or a remedy (related_group_id). This step adds the counting side, without dropping or
// merging any row:
//   master_finding_id   the group id, or the finding's own id when it stands alone
//   master_priority     the highest priority of any member of the group
//   linked_findings     how many findings share the group
//   occurrence_count    distinct cells this finding names (1 when it names none)
//   master_occurrences  distinct cells named by the whole group
// Patch 49: a group can hold more than one distinct issue (two detectors on the same cell, a different defect each). The owner's
// rule: merging is fine, but each issue must be clearly defined. Inside a group of more than one issue every member gets
//   issue_no / issue_count / issue_label ("Issue 1 of 2")   findings from the same check count as ONE issue (its occurrences)
// and the group carries issue_summaries so a reader sees what each issue is. Counts (countMasters) are unchanged.
const { cellsOf } = require('./related-findings');

const RANK = { P1: 1, P2: 2, P3: 3 };
// Only a Confirmed Finding has a P1/P2/P3 (framework: Query, Critical Query and Observation sit outside the hierarchy).
// The priority comes from severity, exactly as build_report.py priority() does: fatal/critical -> P1, high/medium -> P2,
// anything else -> P3. f.priority is the reviewer's own label and does not always agree with that rule, so it is not used.
function prio(f) {
  if ((f.record_type || 'Confirmed Finding') !== 'Confirmed Finding') return null;
  const sev = String(f.severity || '').toLowerCase();
  if (sev === 'fatal' || sev === 'critical') return 'P1';
  if (sev === 'high' || sev === 'medium') return 'P2';
  return 'P3';
}

// The check a finding came from. Findings from one check inside a group are occurrences of one issue.
function issueKey(f) {
  return String(f.rule_id || f.check_id || f.id || '').replace(/-\d{3}$/, '') || String(f.id);
}

function defineIssues(members) {
  const byKey = new Map();
  for (const f of members) {
    const k = issueKey(f);
    if (!byKey.has(k)) byKey.set(k, { key: k, title: f.label || f.title || f.id, priority: prio(f), members: [] });
    const i = byKey.get(k);
    i.members.push(f);
    const p = prio(f);
    if (p && (!i.priority || RANK[p] < RANK[i.priority])) i.priority = p;
  }
  const list = [...byKey.values()].sort((a, b) => (RANK[a.priority] || 9) - (RANK[b.priority] || 9) || a.key.localeCompare(b.key));
  list.forEach((i, n) => { i.no = n + 1; });
  const byMember = new Map();
  list.forEach(i => i.members.forEach(m => byMember.set(m, i)));
  return { list, byMember };
}

function annotateMasterFindings(findings) {
  const groups = new Map();
  for (const f of findings) {
    const mid = f.related_group_id || f.id;
    f.master_finding_id = mid;
    const cells = cellsOf(f);
    f.occurrence_count = Math.max(1, cells.size, Array.isArray(f.affected_cells) ? f.affected_cells.length : 0);
    if (!groups.has(mid)) groups.set(mid, { members: [], cells: new Set(), best: null });
    const g = groups.get(mid);
    g.members.push(f);
    for (const c of cells) g.cells.add(c);
    const p = prio(f);
    if (p && (!g.best || RANK[p] < RANK[g.best])) g.best = p;
  }
  for (const g of groups.values()) {
    g.issues = defineIssues(g.members);
    for (const f of g.members) {
      const iss = g.issues.byMember.get(f);
      f.issue_count = g.issues.list.length;
      f.issue_no = g.issues.list.length > 1 ? iss.no : null;
      f.issue_label = g.issues.list.length > 1 ? `Issue ${iss.no} of ${g.issues.list.length}` : null;
      f.issue_summaries = g.issues.list.length > 1 ? g.issues.list.map(i => ({ no: i.no, id: i.key, title: i.title, priority: i.priority })) : null;
      f.master_priority = g.best || prio(f);
      f.linked_findings = g.members.length;
      f.master_occurrences = Math.max(g.cells.size, ...g.members.map(m => m.occurrence_count));
    }
  }
  return groups;
}

// Master findings per priority: a group counts once, at its highest priority.
function countMasters(findings) {
  const seen = { P1: new Set(), P2: new Set(), P3: new Set() };
  for (const f of findings) {
    const p = prio(f);
    if (!p) continue;
    if ((f.master_priority || p) !== p) continue;
    seen[p].add(f.master_finding_id || f.id);
  }
  return { P1: seen.P1.size, P2: seen.P2.size, P3: seen.P3.size };
}

module.exports = { annotateMasterFindings, countMasters, priorityOf: prio };
