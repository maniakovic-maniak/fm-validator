'use strict';
// recalc-findings.js - Patch 28. The T0-RECALC-* findings, built in one place for both pipelines (server.js and
// index.js each carried an identical copy). Reads the result of src/recalc_check.py.
//
//   T0-RECALC-001  cells whose saved number differs from the recalculated number
//   T0-RECALC-004  cells whose saved text or true/false result differs (a Query: often 15-digit comparison, see below)
//   T0-RECALC-002  circular groups that did not converge
//   T0-RECALC-003  differences held back because they trace to a known engine limitation (a Query, never silent)

function show(v) {
  if (v === null || v === undefined) return '(blank)';
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('en-US') : String(Math.round(v * 1e6) / 1e6);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return JSON.stringify(String(v)).slice(0, 40);
}

function sampleOf(list, n) {
  return list.slice(0, n).map(m => `${m.sheet}!${m.cell} (shows ${show(m.cached)}, recalculates to ${show(m.recalculated)})`).join(', ');
}

function ledgerSentence(r) {
  const l = r.ledger;
  if (!l) return `${(r.formula_cells_checked || 0).toLocaleString()} formula cells checked`;
  return `${l.compared.toLocaleString()} of ${l.population.toLocaleString()} formula cells compared (${l.matched.toLocaleString()} matched)`;
}

function buildRecalcFindings(r) {
  const out = [];
  if (!r || r.status !== 'success') return out;

  // Numeric differences are the stale-or-wrong-value finding. Text, Boolean and type differences are listed apart as a
  // Query: they are often a numeric comparison that Excel evaluates to 15 significant digits and this engine does not
  // (for example =SUM(A1:A5)=1), so they are shown, with that caveat, rather than raised as a confirmed error.
  const allMis = r.mismatches || [];
  const numeric = allMis.filter(m => (m.type || 'number') === 'number');
  const flags = allMis.filter(m => (m.type || 'number') !== 'number');

  if (numeric.length > 0) {
    out.push({
      id: 'T0-RECALC-001',
      label: `${numeric.length} formula cell(s) recalculate to a different value than their cached result`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `A genuine, full-workbook recalculation (${ledgerSentence(r)}, correctly resolving ${r.genuine_circular_groups} genuine circular dependency group(s) via iterative calculation) found ${numeric.length} cell(s) whose displayed, cached value doesn't match what the formula actually computes: ${sampleOf(numeric, 8)}. This means either the file wasn't recalculated and saved with calculation enabled before delivery, or a genuine formula error exists. Comparison policy: ${r.comparison_policy || 'see Scope and Reliance'}.`,
      reason: `${numeric.length} cell(s) show a cached value inconsistent with a fresh recalculation`,
      corrective_action: 'Open the file in Excel, force a full recalculation (Ctrl+Alt+F9), and re-save. If mismatches persist after recalculation, investigate each flagged cell\'s formula directly.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Stale or incorrect cached formula result',
      model_risk: 'Every displayed figure in this model is only as trustworthy as its cached value — this check found cells where that trust is misplaced.',
      key_output_impact: 'Yes', method: 'automated', needs_retest: true,
      root_cause: 'Cached formula result does not match a genuine recalculation', escalation_flag: true,
      urgency: 'Before next reliance', confidence: 95
    });
  }

  if (flags.length > 0) {
    out.push({
      id: 'T0-RECALC-004',
      label: `${flags.length} text or true/false result(s) differ between the saved value and the recalculation`,
      severity: 'medium', status: 'fail',
      sheet: flags[0].sheet, cell: flags[0].cell, category: 'Structure',
      condition: `${sampleOf(flags, 6)}${flags.length > 6 ? ' and others' : ''}. These results are text or TRUE/FALSE, not numbers. A common cause is a test such as =SUM(...)=1 that Excel evaluates to 15 significant digits and the recalculation engine evaluates exactly, so the two disagree on a sum that is 1 to the displayed precision. They may also be a real difference. ${ledgerSentence(r)}.`,
      reason: `${flags.length} text or true/false result(s) the recalculation does not reproduce`,
      corrective_action: 'Open each cell in Excel. If the saved result is what Excel shows after a full recalculation, no action is needed. If a check cell shows an error flag, find the cause upstream.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Text or true/false result differs from recalculation',
      model_risk: 'A check or status flag that reads differently on recalculation can show a model passing its own tests when it does not, or the reverse.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Saved text or Boolean result differs from recalculation', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 55, record_type: 'Query'
    });
  }

  if (r.unconverged_circular_groups > 0) {
    out.push({
      id: 'T0-RECALC-002',
      label: `${r.unconverged_circular_groups} circular calculation group(s) did not converge`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${r.unconverged_circular_groups} circular dependency group(s) were still changing after the maximum iteration count, rather than settling to a stable value — a genuine, unresolved circularity, not the common and usually-benign interest-on-average-balance pattern that normally converges cleanly.`,
      reason: `${r.unconverged_circular_groups} circular group(s) failed to converge`,
      corrective_action: 'Investigate the specific formulas involved — an unstable circularity can mean the underlying logic is genuinely unbounded or oscillating, not just slow to settle.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Unconverged circular calculation',
      model_risk: 'A circular calculation that never settles means the model\'s displayed values may depend on exactly how many iterations Excel happened to run, not on a stable, well-defined answer.',
      key_output_impact: 'Yes', method: 'automated', needs_retest: true,
      root_cause: 'Circular calculation did not converge within the iteration limit', escalation_flag: true,
      urgency: 'Before next reliance', confidence: 90
    });
  }

  const held = r.mismatches_held_back || [];
  if (held.length > 0) {
    const roots = {};
    for (const m of held) roots[m.root_label || 'an engine limitation'] = (roots[m.root_label || 'an engine limitation'] || 0) + 1;
    const rootNote = Object.entries(roots).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${v} via ${k}`).join('; ');
    out.push({
      id: 'T0-RECALC-003',
      label: `${held.length} cell(s) differ from the recalculation but trace to a known engine limitation`,
      severity: 'medium', status: 'fail',
      sheet: held[0].sheet, cell: held[0].cell, category: 'Structure',
      condition: `${sampleOf(held, 6)}${held.length > 6 ? ' and others' : ''}. These saved values differ from the recalculated ones, but each depends on a formula the recalculation engine is known to evaluate differently from Excel (${rootNote}). They are not confirmed errors and not confirmed correct: the recalculation cannot settle them, so the saved value has no independent support.`,
      reason: `${held.length} difference(s) the recalculation cannot settle`,
      corrective_action: 'Recalculate the file in Excel and compare these cells to the saved values. If Excel agrees with the saved values, no action is needed.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Recalculation difference not settled',
      model_risk: 'A difference hidden by an engine limitation could be a real error that the independent recalculation is unable to confirm.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Recalculation limited by engine behaviour', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 50, record_type: 'Query'
    });
  }
  return out;
}

module.exports = { buildRecalcFindings, ledgerSentence };
