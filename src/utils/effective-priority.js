'use strict';
// effective-priority.js - Patch 44. SHADOW MODE: a second priority that asks whether the consequence is substantiated.
//
// Today's priority comes from severity alone (build_report.py priority(), master-findings.js prio()). The independent review
// (30 Oct 2026, point 4) asks for one effective priority with these meanings:
//   P1  a confirmed defect with a substantiated, decision-threatening consequence
//   P2  a confirmed defect with a substantiated material, but contained, consequence
//   P3  a confirmed defect of low consequence
//   Impact pending   a confirmed defect whose consequence has not been substantiated yet (kept explicit, never hidden)
// "Substantiated" means the finding carries evidence of consequence: a quantified effect (dollar_impact) AND a stated effect on
// a key output (key_output_impact). Distance from an output, occurrence counts and propagation breadth are investigation aids,
// not materiality tests, and an incomplete dependency graph is never a reason to lower a priority. None of them is read here.
//
// This module changes no finding's record type, no report row and no verdict. It writes effective_priority,
// effective_priority_basis and effective_priority_differs onto each Confirmed Finding, logs how the two priorities compare, and
// saves the comparison to its own folder (never the finding history). Switch off with FM_EFFECTIVE_PRIORITY_SHADOW=off.
const fs = require('fs'), path = require('path');
const { priorityOf } = require('./master-findings');

const NO_IMPACT = new Set(['', 'unknown', 'no', 'none', 'n/a', 'na', 'not applicable', 'false', 'nil', '-', '—']);
const SHADOW_DIR = path.join(__dirname, '..', '..', 'data', 'shadow', 'effective-priority');

function isQuantified(f) {
  const d = String(f.dollar_impact == null ? '' : f.dollar_impact).trim().toLowerCase();
  return !!d && !d.startsWith('unquantified') && !NO_IMPACT.has(d);
}
function statesKeyOutputImpact(f) { return !NO_IMPACT.has(String(f.key_output_impact == null ? '' : f.key_output_impact).trim().toLowerCase()); }

/** @returns {{priority, basis}} for one finding, or null when it is not a Confirmed Finding. */
function effectivePriority(f) {
  if ((f.record_type || 'Confirmed Finding') !== 'Confirmed Finding') return null;
  const base = priorityOf(f);
  if (!base) return null;
  if (base === 'P3') return { priority: 'P3', basis: 'low severity; no consequence evidence needed for P3' };
  const q = isQuantified(f), k = statesKeyOutputImpact(f);
  if (q && k) return { priority: base, basis: 'consequence substantiated: quantified effect and a stated effect on a key output' };
  if (q) return { priority: 'P2', basis: 'quantified effect, but no stated effect on a key output: material but contained' };
  return { priority: 'Impact pending', basis: k ? 'confirmed defect; a key output is named but the effect is not quantified' : 'confirmed defect; the consequence is neither quantified nor tied to a key output' };
}

function assignEffectivePriorities(findings) {
  const out = { total: 0, same: 0, differs: 0, byBase: {}, byEffective: {}, changes: [] };
  for (const f of findings) {
    const e = effectivePriority(f);
    if (!e) continue;
    const base = priorityOf(f);
    f.effective_priority = e.priority; f.effective_priority_basis = e.basis; f.effective_priority_differs = e.priority !== base;
    out.total++; out.byBase[base] = (out.byBase[base] || 0) + 1; out.byEffective[e.priority] = (out.byEffective[e.priority] || 0) + 1;
    if (e.priority !== base) { out.differs++; out.changes.push({ id: f.id, from: base, to: e.priority, basis: e.basis }); } else out.same++;
  }
  return out;
}

function runShadow(findings, { runId } = {}) {
  if (String(process.env.FM_EFFECTIVE_PRIORITY_SHADOW || '').toLowerCase() === 'off') return null;
  const s = assignEffectivePriorities(findings);
  try {
    fs.mkdirSync(SHADOW_DIR, { recursive: true });
    const safe = String(runId || 'run').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    fs.writeFileSync(path.join(SHADOW_DIR, `${safe}.json`), JSON.stringify({ runId: runId || null, at: new Date().toISOString(), ...s }, null, 2));
  } catch (_) { /* the comparison file is best-effort */ }
  return s;
}

function logLine(s) {
  if (!s || !s.total) return null;
  const fmt = o => Object.keys(o).sort().map(k => `${k} ${o[k]}`).join(', ') || 'none';
  return `Effective priority (shadow, no change to this report): severity-based ${fmt(s.byBase)} | evidence-based ${fmt(s.byEffective)}; ${s.differs} of ${s.total} confirmed finding(s) would differ`;
}

module.exports = { effectivePriority, assignEffectivePriorities, runShadow, logLine, isQuantified, statesKeyOutputImpact };
