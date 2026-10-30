'use strict';
// path-checks.js - Patch 31. Runs the focused checks on the paths that feed a model's outputs, and turns their results
// into findings (built once, used by both pipelines) and into the rows of the Path Checks tab.
//
//   lookup contract          which source row an exact-match lookup selects, and whether the key is unique
//   average completeness     whether an AVERAGE over a run of periods is given every period as a number
//   fallback propagation     what a text fallback (IFERROR(lookup, "")) does in the cells that read it
//   bypassed checks          which of the model's own checks could not have caught a given error
//   check independence       whether a check row's two sides are built from the same calculation (Patch 35)
//   volatile timestamp       a cell that is only NOW() or TODAY(), used as a run date (Patch 35)
//
// Every tested criterion gets a verdict of its own: passed, defect, query, control weakness, or not applicable. A formula
// can pass one criterion and fail another (a saved value that reproduces, with fallback handling that is a weakness).
// Passed results are listed on the Path Checks tab and raise no finding.

const { checkLookupContracts } = require('./lookup-contract');
const { checkAverageCompleteness } = require('./average-completeness');
const { checkFallbackPropagation } = require('./fallback-propagation');
const { findBypassedChecks } = require('./bypassed-checks');
const { checkIndependence } = require('./check-independence');
const { checkVolatileTimestamps } = require('./volatile-timestamp');
const { buildRootCauseFields } = require('./root-cause-consolidation');

const VERDICT_LABEL = { passed: 'Passed', defect: 'Defect', query: 'Query', control_weakness: 'Control weakness', not_applicable: 'Not applicable', not_completed: 'Not completed' };

function runPathChecks(workbook, cellScoreIndex, opts = {}) {
  const run = (name, fn, empty) => { try { return fn(); } catch (e) { console.error(`   ⚠️  ${name} failed:`, e.message); return Object.assign({ applicable: false, error: e.message }, empty || {}); } };
  const lookup = run('Lookup contract check', () => checkLookupContracts(workbook, cellScoreIndex, opts.lookup), { records: [], counts: {} });
  const average = run('Average completeness check', () => checkAverageCompleteness(workbook, cellScoreIndex, opts.average), { records: [], counts: {} });
  const fallback = run('Fallback propagation check', () => checkFallbackPropagation(cellScoreIndex, opts.fallback), { records: [], counts: {} });
  const independence = run('Check independence', () => checkIndependence(workbook, cellScoreIndex, opts.independence), { records: [], counts: {} });
  const timestamp = run('Volatile timestamp check', () => checkVolatileTimestamps(workbook, cellScoreIndex), { records: [], counts: {} });
  return { lookup, average, fallback, independence, timestamp };
}

// Names the model's own checks that do not read a double-counted total (Patch 31, acceptance case 13).
function addBypassedChecks(nestedSubtotalCheck, workbook, cellScoreIndex, limit = 5) {
  if (!nestedSubtotalCheck || !Array.isArray(nestedSubtotalCheck.findings)) return nestedSubtotalCheck;
  for (const f of nestedSubtotalCheck.findings.slice(0, limit)) {
    try {
      const r = findBypassedChecks(workbook, cellScoreIndex, f.sheet, f.cell);
      if (!r.checks.length) { f.bypassedChecks = null; continue; }
      f.bypassedChecks = r;
      const names = r.checks.map(c => `${c.cell}${c.label ? ' (' + c.label + ')' : ''}`);
      const unread = r.checks.filter(c => !c.reads && !c.truncated).map(c => c.cell);
      const readers = r.reading;
      f.note += ` The model's own checks in this column (${names.join(', ')}) all show about zero. ` +
        (unread.length ? `${unread.join(', ')} ${unread.length === 1 ? 'does' : 'do'} not read ${f.cell} or anything built on it, so ${unread.length === 1 ? 'it' : 'they'} could not have caught this error.` : '') +
        (readers.length ? ` ${readers.join(', ')} ${readers.length === 1 ? 'reads' : 'read'} ${f.cell} and still show${readers.length === 1 ? 's' : ''} about zero.` : '');
    } catch (_) { /* leave the finding as it was */ }
  }
  return nestedSubtotalCheck;
}

const sample = (list, n, fmt) => list.slice(0, n).map(fmt).join('; ');

function buildPathCheckFindings(pc) {
  const out = [];
  if (!pc) return out;
  const cells = list => ({ findings: list.map(r => ({ sheet: r.sheet, cell: r.cell })) });
  const common = { method: 'automated', needs_retest: true, escalation_flag: false, urgency: 'Before next reliance', category: 'Structure', workstream: 'Structure' };

  const lk = (pc.lookup && pc.lookup.records) || [];
  const missing = lk.filter(r => r.verdict === 'defect'), dup = lk.filter(r => r.verdict === 'query');
  if (missing.length) {
    out.push({
      id: 'T0-LOOKUP-001', label: `${missing.length} lookup(s) select no source row, or a different row from the one saved`,
      severity: 'high', status: 'fail', sheet: missing[0].sheet, cell: missing[0].cell,
      condition: `${sample(missing, 4, r => `${r.sheet}!${r.cell}: ${r.text} Keys: ${r.keyParts.map(k => k.value).join(' | ')}`)}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}.`,
      reason: `${missing.length} exact-match lookup(s) do not agree with their source block`,
      corrective_action: 'Check each key against the source block (spelling, scenario or sensitivity name, trailing spaces) and recalculate; if the key is valid, the source block is missing the row.',
      issue_type: 'Lookup key not found or stale', model_risk: 'A lookup that finds no row returns an error or its fallback, so the figure that depends on it is missing, zero or text without a visible cause.',
      key_output_impact: 'Unknown', root_cause: 'Lookup key does not select a source row', confidence: 85,
      ...common, ...buildRootCauseFields('T0-LOOKUP-001', cells(missing), { commonRemediationAction: 'Correct the key or the source row.' }),
    });
  }
  if (dup.length) {
    out.push({
      id: 'T0-LOOKUP-002', label: `${dup.length} lookup(s) select a key that appears in more than one source row`,
      severity: 'medium', status: 'fail', sheet: dup[0].sheet, cell: dup[0].cell,
      condition: `${sample(dup, 4, r => `${r.sheet}!${r.cell}: ${r.text}`)}${dup.length > 4 ? ` and ${dup.length - 4} more` : ''}.`,
      reason: `${dup.length} exact-match lookup(s) depend on source order`,
      corrective_action: 'Confirm which source row is intended and add the missing key component, or remove the duplicate row.',
      issue_type: 'Lookup key not unique', model_risk: 'Excel returns the first matching row, so the result changes if the source block is re-sorted or a row is inserted above the intended one.',
      key_output_impact: 'Unknown', root_cause: 'Lookup key is not unique in the source block', confidence: 80,
      ...common, ...buildRootCauseFields('T0-LOOKUP-002', cells(dup), { commonRemediationAction: 'Make the key unique.' }),
    });
  }

  const av = (pc.average && pc.average.records) || [];
  const swing = r => (r.sensitivity ? Math.abs(r.sensitivity.change) : 0);
  const avDef = av.filter(r => r.verdict === 'defect'), avWeak = av.filter(r => r.verdict === 'control_weakness').sort((x, y) => swing(y) - swing(x));
  if (avDef.length) {
    out.push({
      id: 'T0-AVGCOMP-001', label: `${avDef.length} average(s) silently drop a period that is a formula returning text`,
      severity: 'high', status: 'fail', sheet: avDef[0].sheet, cell: avDef[0].cell,
      condition: `${sample(avDef, 4, r => `${r.sheet}!${r.cell}: ${r.text}`)}${avDef.length > 4 ? ` and ${avDef.length - 4} more` : ''}.`,
      reason: `${avDef.length} AVERAGE(s) over a run of periods are given fewer numbers than periods`,
      corrective_action: 'Find why the period returns text (usually a failed lookup behind IFERROR(..., "")), correct it, and make the average show an error or a visible flag when a period is missing.',
      issue_type: 'Average over incomplete periods', model_risk: 'AVERAGE ignores text, so a lost period gives a plausible average over fewer periods with no error, and everything built on it shifts.',
      key_output_impact: 'Unknown', root_cause: 'Average range contains a period that returns text', confidence: 85,
      ...common, ...buildRootCauseFields('T0-AVGCOMP-001', cells(avDef), { commonRemediationAction: 'Restore the missing period and flag any future gap.' }),
    });
  }
  if (avWeak.length) {
    out.push({
      id: 'T0-AVGCOMP-002', label: `${avWeak.length} average(s) would silently drop a period if one lookup failed`,
      severity: 'low', status: 'fail', sheet: avWeak[0].sheet, cell: avWeak[0].cell,
      condition: `${sample(avWeak, 3, r => `${r.sheet}!${r.cell}: ${r.text}`)}${avWeak.length > 3 ? ` and ${avWeak.length - 3} more` : ''}. All periods are numeric today.`,
      reason: `${avWeak.length} AVERAGE(s) read periods that return text on failure`,
      corrective_action: 'Add a completeness test next to each average (COUNT of the range equals the number of periods) or let a failed lookup show an error. How a genuinely unavailable period should be treated is for the model owner to decide.',
      issue_type: 'Average without completeness test', model_risk: 'Not an error today. If a lookup feeding one period failed, the average would change by the amount shown without any error appearing.',
      key_output_impact: 'Unknown', root_cause: 'Fallback text is ignored by AVERAGE', confidence: 75,
      ...common, ...buildRootCauseFields('T0-AVGCOMP-002', cells(avWeak), { commonRemediationAction: 'Add a COUNT check beside the average.' }),
    });
  }

  const fb = ((pc.fallback && pc.fallback.records) || []).filter(r => r.verdict === 'control_weakness');
  if (fb.length) {
    out.push({
      id: 'T0-FALLBACK-001', label: `${fb.length} lookup fallback(s) turn a failed lookup into text that other cells then misread`,
      severity: 'low', status: 'fail', sheet: fb[0].sheet, cell: fb[0].cell,
      condition: `${sample(fb, 3, r => r.text)}${fb.length > 3 ? ` and ${fb.length - 3} more` : ''}.`,
      reason: `${fb.length} IFERROR(lookup, text) result(s) are read by arithmetic or totals`,
      corrective_action: 'Decide what a failed lookup should do: show an error that stops the dependants, or a visible flag. A blank text result that totals skip and arithmetic rejects gives two different symptoms for the same cause.',
      issue_type: 'Text fallback with different downstream effects', model_risk: 'The same failed lookup shows as #VALUE! in one cell and as a quietly short total in another, and neither points to the missing key.',
      key_output_impact: 'Unknown', root_cause: 'Lookup failure converted to text', confidence: 80,
      ...common, ...buildRootCauseFields('T0-FALLBACK-001', cells(fb), { commonRemediationAction: 'Define the failed-lookup behaviour and apply it consistently.' }),
    });
  }
  const ci = ((pc.independence && pc.independence.records) || []).filter(r => r.verdict === 'query');
  if (ci.length) {
    out.push({
      id: 'T0-CHECKIND-001', label: `${ci.length} check row(s) compare two sides built from the same calculation`,
      severity: 'medium', status: 'fail', record_type: 'Query', sheet: ci[0].sheet, cell: ci[0].cell,
      condition: `${sample(ci, 3, r => r.evidence)}${ci.length > 3 ? ` and ${ci.length - 3} more` : ''}`,
      reason: `${ci.length} check(s) could not show a difference caused by an error in the shared calculation`,
      corrective_action: 'Confirm that each check is meant to compare a figure with something built from it. If the check is meant to catch errors in that calculation, rebuild one side from an independent source (the opening balance plus the movement from the statements, say).',
      issue_type: 'Check that may not be able to fail', model_risk: 'A check that reads the same calculation on both sides stays at zero when that calculation is wrong, so the model shows assurance it has not earned.',
      key_output_impact: 'Unknown', root_cause: 'Check built from the calculation it tests', confidence: 50,
      ...common, ...buildRootCauseFields('T0-CHECKIND-001', cells(ci), { commonRemediationAction: 'Give each check an independent side.' }),
    });
  }
  const ts = (pc.timestamp && pc.timestamp.records) || [];
  if (ts.length) {
    out.push({
      id: 'T0-VOLTIME-001', label: `${ts.length} cell(s) are NOW() or TODAY() on its own, which changes on every recalculation`,
      severity: 'low', status: 'fail', record_type: 'Observation', sheet: ts[0].sheet, cell: ts[0].cell,
      condition: `${sample(ts, 3, r => r.text)}${ts.length > 3 ? ` and ${ts.length - 3} more` : ''}`,
      reason: `${ts.length} volatile date cell(s) that may be read as a run date`,
      corrective_action: 'If the cell is meant to record when a scenario was run, have the macro paste the date as a value at the end of the run, and state this beside the cell.',
      issue_type: 'Volatile timestamp', model_risk: 'A reader of the archive sees the date of the last recalculation or save and takes it for the date the results were produced.',
      key_output_impact: 'No', root_cause: 'Run date held as a volatile function', confidence: 75,
      ...common, urgency: 'When convenient', ...buildRootCauseFields('T0-VOLTIME-001', cells(ts), { commonRemediationAction: 'Freeze the run date as a value.' }),
    });
  }
  return out;
}

// Rows for the Path Checks tab: every criterion tested, with its verdict, passed ones included.
function pathCheckRows(pc, limitPerKind = 400) {
  if (!pc) return { rows: [], summary: [] };
  const rows = [];
  const add = (criterion, recs, evidence) => {
    const order = { defect: 0, control_weakness: 1, query: 2, passed: 3, not_applicable: 4 };
    const sorted = [...recs].sort((a, b) => (order[a.verdict] ?? 9) - (order[b.verdict] ?? 9));
    for (const r of sorted.slice(0, limitPerKind)) rows.push({ criterion, location: `${r.sheet}!${r.cell}`, verdict: VERDICT_LABEL[r.verdict] || r.verdict, evidence: evidence(r) });
    return Math.max(0, sorted.length - limitPerKind);
  };
  const cut = [
    add('Lookup contract', pc.lookup.records || [], r => `${r.text} Keys: ${r.keyParts.map(k => `${k.part} = ${JSON.stringify(k.value)}`).join('; ')}. Source: ${r.source} (${r.sourceRows} rows).`),
    add('Average completeness', pc.average.records || [], r => r.text),
    add('Check independence', (pc.independence && pc.independence.records || []).filter(r => r.verdict !== 'not_applicable'), r => r.evidence),
    add('Volatile timestamp', (pc.timestamp && pc.timestamp.records) || [], r => r.text),
    add('Fallback propagation', pc.fallback.records || [], r => r.text + (r.examples && r.examples.length ? ' Readers: ' + r.examples.map(e => `${e.cell} (${e.formula})`).join('; ') + '.' : '')),
  ];
  const sum = (name, c) => ({ criterion: name, tested: c.tested ?? c.families ?? 0, counts: c.counts || {}, notCompleted: c.notCompleted || 0, reasons: c.notCompletedReasons || {}, stopped: c.stopped || null });
  return {
    rows, omitted: cut.reduce((a, b) => a + b, 0),
    summary: [sum('Lookup contract', pc.lookup), sum('Average completeness', pc.average), sum('Fallback propagation', pc.fallback)].concat(pc.independence && pc.independence.applicable ? [sum('Check independence', pc.independence)] : [], pc.timestamp && pc.timestamp.applicable ? [sum('Volatile timestamp', pc.timestamp)] : []),
  };
}

module.exports = { runPathChecks, buildPathCheckFindings, addBypassedChecks, pathCheckRows, VERDICT_LABEL };
