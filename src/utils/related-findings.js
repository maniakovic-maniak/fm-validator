'use strict';
// related-findings.js - link findings from different checks that touch the same cells.
//
// An independent review of a licence model counted one defect (ten #REF! literals at FinancialRatios!AP138:AT139)
// as two findings, one from the formula scan (T0-ERRLITERAL-001) and one from the reviewer (T2-S4-006), and one
// duplicated calculation as three. Matching on shared cells is a safe signal: two findings that name the same cell
// are about the same place, whatever the wording. This does NOT merge or drop anything. It adds a visible
// cross-reference to each finding in a group, a shared group id, and the list of related ids, so the report can
// show one repair-and-retest unit instead of several look-alike entries. Pattern findings that cover hundreds of
// cells (formula-pattern screens, daisy chains) are left out, or everything would link to them.

const MAX_CELLS_PER_FINDING = 300;     // a finding naming more cells than this is a screen, not a pinpoint
const MAX_RANGE_CELLS = 400;

function colNum(c) { let n = 0; for (const ch of c.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; }

const REF_RE = /(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;

function expand(sheet, c1, r1, c2, r2, out) {
  const ca = colNum(c1), cb = c2 ? colNum(c2) : ca, ra = +r1, rb = r2 ? +r2 : ra;
  const cols = Math.abs(cb - ca) + 1, rows = Math.abs(rb - ra) + 1;
  if (cols * rows > MAX_RANGE_CELLS) return false;
  for (let c = Math.min(ca, cb); c <= Math.max(ca, cb); c++) for (let r = Math.min(ra, rb); r <= Math.max(ra, rb); r++) out.add(`${sheet}!${c}:${r}`);
  return true;
}

// Every cell a finding names: its affected_cells list, its own sheet/cell, and any Sheet!A1 or Sheet!A1:B2 in its text.
function cellsOf(f) {
  const out = new Set();
  const addRef = ref => {
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/.exec(String(ref).trim());
    if (m) expand((m[1] || m[2]).replace(/''/g, "'"), m[3], m[4], m[5], m[6], out);
  };
  for (const a of f.affected_cells || []) addRef(a);
  if (f.sheet && f.cell && /^\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/.test(String(f.cell)) && f.cell !== 'A1') addRef(`${f.sheet}!${f.cell}`);
  const text = [f.condition, f.reason, f.what_wrong, f.detail].filter(Boolean).join(' ');
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(text)) !== null) expand((m[1] || m[2]).replace(/''/g, "'"), m[3], m[4], m[5], m[6], out);
  return out;
}

function linkRelatedFindings(findings) {
  const sets = findings.map(cellsOf);
  const index = new Map();              // cell -> [finding index]
  sets.forEach((set, i) => {
    if (set.size === 0 || set.size > MAX_CELLS_PER_FINDING) return;
    for (const c of set) { if (!index.has(c)) index.set(c, []); index.get(c).push(i); }
  });
  // union-find over findings that share at least one cell
  const parent = findings.map((_, i) => i);
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const shared = new Map();            // "i|j" -> count
  for (const list of index.values()) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const i = list[a], j = list[b];
      if (findings[i].id === findings[j].id) continue;
      const k = i + '|' + j;
      shared.set(k, (shared.get(k) || 0) + 1);
    }
  }
  // A pair is related only when the overlap is substantial: a single cell that two long texts happen to mention
  // (a denominator both quote, say) must not chain unrelated findings together.
  const strong = new Map();            // index -> Set of directly related indexes
  for (const [k, n] of shared) {
    const [i, j] = k.split('|').map(Number);
    if (n / Math.min(sets[i].size, sets[j].size) < 0.5) continue;
    parent[find(i)] = find(j);
    if (!strong.has(i)) strong.set(i, new Set());
    if (!strong.has(j)) strong.set(j, new Set());
    strong.get(i).add(j); strong.get(j).add(i);
  }
  const groups = new Map();
  for (const i of strong.keys()) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }

  const MAX_GROUP = 8, MAX_LISTED = 5;
  const linked = [];
  for (const real of groups.values()) {
    if (real.length < 2) continue;
    const ids = real.map(i => findings[i].id);
    const groupId = real.length <= MAX_GROUP ? 'RC-' + [...ids].sort()[0] : null;
    for (const i of real) {
      const direct = [...strong.get(i)].map(x => findings[x].id).filter(x => x !== findings[i].id);
      findings[i].related_ids = direct;
      if (groupId) findings[i].related_group_id = groupId;
      const shown = direct.slice(0, MAX_LISTED).join(', ') + (direct.length > MAX_LISTED ? ` and ${direct.length - MAX_LISTED} more` : '');
      const note = ` (Same cell(s) are also reported by ${shown}: one repair and one retest cover them.)`;
      if (!String(findings[i].condition || '').includes('Same cell(s) are also reported by')) findings[i].condition = (findings[i].condition || '') + note;
    }
    linked.push({ groupId: groupId || 'RC-large', ids });
  }
  return linked;
}

module.exports = { linkRelatedFindings, cellsOf };
