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
const { cellsOf } = require('./related-findings');

const RANK = { P1: 1, P2: 2, P3: 3 };
// Only a Confirmed Finding has a P1/P2/P3 (framework: Query, Critical Query and Observation sit outside the hierarchy).
// f.priority is also set on those records from severity, so it is ignored for them here.
function prio(f) {
  if ((f.record_type || 'Confirmed Finding') !== 'Confirmed Finding') return null;
  const p = String(f.priority || '');
  return RANK[p] ? p : null;
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
    for (const f of g.members) {
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

module.exports = { annotateMasterFindings, countMasters };
