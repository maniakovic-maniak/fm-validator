'use strict';
// dedup-findings.js - Patch 55 (Review R5). The old rule kept one finding per (id + sheet). A reviewer that raised the same
// rule twice on one sheet, at different cells or about different claims, lost the later one, and with it a possible critical
// concern. Identity is now the occurrence: rule id + sheet + cell + the claim. Only a true duplicate (all four equal) is
// collapsed, and it is collapsed losslessly: the survivor takes the highest severity, the union of affected cells, and
// records how many reports it stands for. A second, different occurrence of the same rule is kept and given an occurrence
// suffix (-002, -003) so it can be told apart downstream; the matrix, exclusions and master-finding identity already fold
// that suffix back to the rule.
const SEV_RANK = { fatal: 0, critical: 1, high: 2, medium: 3, low: 4, info: 5 };
const sevRank = s => (String(s || '').toLowerCase() in SEV_RANK ? SEV_RANK[String(s).toLowerCase()] : 6);

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 !:$.,%()=<>+\-*/']/g, '').trim().slice(0, 240);
const claimOf = f => norm(f.condition || f.what_wrong || f.reason || f.label || f.finding || '');
const cellOf = f => String(f.cell || '').replace(/\$/g, '').toUpperCase();

function occurrenceKey(f) {
  const id = f.id || f.reason || f.label || JSON.stringify(f);
  return [id, f.sheet || '', cellOf(f), claimOf(f)].join('|');
}

/** Returns { kept, merged:[{id,into,reports}], split:[{id,as}] }. Does not mutate the input array; may add fields to kept findings. */
function dedupFindings(findings) {
  const byOcc = new Map();      // occurrence key -> kept finding
  const perId = new Map();      // id -> number of distinct occurrences kept so far
  const kept = [], merged = [], split = [];
  for (const orig of findings) {
    let f = Object.assign({}, orig);          // work on a copy so the caller's findings are never changed
    const key = occurrenceKey(f);
    if (byOcc.has(key)) {
      const k = byOcc.get(key);
      k.duplicate_reports = (k.duplicate_reports || 1) + 1;
      if (sevRank(f.severity) < sevRank(k.severity)) k.severity = f.severity;
      if (Array.isArray(f.affected_cells) && f.affected_cells.length) {
        k.affected_cells = [...new Set([...(k.affected_cells || []), ...f.affected_cells])];
      }
      merged.push({ id: f.id, into: k.id, reports: k.duplicate_reports });
      continue;
    }
    const baseId = f.id;
    if (baseId) {
      const n = (perId.get(baseId) || 0) + 1;
      perId.set(baseId, n);
      if (n > 1) {
        const suffixed = `${baseId}-${String(n).padStart(3, '0')}`;
        split.push({ id: baseId, as: suffixed });
        f.id = suffixed; f.base_id = baseId;
      }
    }
    byOcc.set(key, f);
    kept.push(f);
  }
  return { kept, merged, split };
}

module.exports = { dedupFindings, occurrenceKey };
