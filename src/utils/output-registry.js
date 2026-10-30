'use strict';
// output-registry.js - drafts the list of outputs a reader of the model relies on, for a person to approve.
// The draft is "proposed" only. It uses sheet and row labels, because Tier 0 holds sheet-level links only until the
// shared reference service (Patch 32) can say which cells feed which. Nothing here changes a verdict.
const { makeReader } = require('./path-checks-common');

const SHEET_HINT = /summary|output|dashboard|returns?|valuation|ratios?|kpi|covenant|scorecard|results/i;
const ROW_HINT = /\b(npv|irr|moic|dscr|llcr|plcr|icr|gearing|leverage|ebitda|equity value|enterprise value|payback|total (assets|liabilities|equity|revenue)|net (income|profit|debt|cash)|check)\b/i;
const MAX_OUTPUTS = 60;

// The upload step appends a timestamp to the file name (Model-1793358051904.xlsm), so the raw name differs on every upload.
// The registry is keyed by the same model identity the finding history uses, so one approval follows the model across uploads.
const { normalizeModelIdentity } = require('./finding-history');
function slug(name) { return String(normalizeModelIdentity(name || 'model') || name || 'model').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'model'; }

function proposeRegistry(workbook, cellScoreIndex, modelName) {
  const rd = makeReader(workbook);
  const byRow = new Map();           // "sheet|row" -> { sheet, row, label, cells: [...] }
  for (const key of Object.keys(cellScoreIndex)) {
    const bang = key.lastIndexOf('!'); const sheet = key.slice(0, bang); const a = key.slice(bang + 1);
    const m = /^([A-Z]+)(\d+)$/.exec(a); if (!m) continue;
    const sheetOk = SHEET_HINT.test(sheet);
    const row = +m[2];
    const rk = `${sheet}|${row}`;
    let e = byRow.get(rk);
    if (!e) {
      let label = '';
      for (let c = 1; c <= 6 && !label; c++) { const v = rd.value(sheet, row, c); if (typeof v === 'string' && v.trim() && isNaN(Number(v))) label = v.trim(); }
      e = { sheet, row, label, sheetOk, rowOk: ROW_HINT.test(label), cells: [] };
      byRow.set(rk, e);
    }
    if (e.cells.length < 3) e.cells.push(a);
    e.count = (e.count || 0) + 1;
  }
  const picked = [...byRow.values()].filter(e => e.label && (e.rowOk && (e.sheetOk || !/check/i.test(e.label))) || (e.sheetOk && e.rowOk))
    .sort((a, b) => (b.sheetOk - a.sheetOk) || (b.count - a.count)).slice(0, MAX_OUTPUTS);
  return {
    status: 'proposed', model: modelName || null, generated_from: 'sheet and row labels',
    approved_by: null, approved_on: null,
    note: 'Draft for a named person to review. Not relied on until approved.',
    outputs: picked.map(e => ({ sheet: e.sheet, row: e.row, label: e.label, example_cells: e.cells, formula_cells_in_row: e.count })),
  };
}

// ---- approval state ------------------------------------------------------------------------------------------------
// A registry is approved only when config/output-registries/<slug>.json exists with status "approved", a named approver
// and a real approval date. A draft (<slug>.proposed.json), a file with an empty name or date, or no file at all gives
// no approval. The state only ever lowers the highest verdict tier; it never holds or blocks a report.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const REG_DIR = path.join(__dirname, '..', '..', 'config', 'output-registries');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Shape of one output definition: a sheet name and a row (or a cell), and a label to show.
function definitionProblems(o, i) {
  const where = `output ${i + 1}`;
  if (!o || typeof o !== 'object') return [`${where} is not an object`];
  const out = [];
  if (typeof o.sheet !== 'string' || !o.sheet.trim()) out.push(`${where} has no sheet`);
  const rowOk = Number.isInteger(o.row) && o.row >= 1;
  const cellOk = typeof o.cell === 'string' && /^[A-Za-z]{1,3}\d{1,7}$/.test(o.cell.trim());
  if (!rowOk && !cellOk) out.push(`${where} has no row or cell`);
  if (typeof o.label !== 'string' || !o.label.trim()) out.push(`${where} has no label`);
  return out;
}

function loadRegistryState(modelName, dir = REG_DIR) {
  const base = slug(modelName);
  const readText = f => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { return null; } };
  const parse = t => { try { return t === null ? null : JSON.parse(t); } catch (_) { return null; } };
  const regText = readText(base + '.json');
  const reg = parse(regText);
  if (reg) {
    const by = String(reg.approved_by || '').trim(), on = String(reg.approved_on || '').trim();
    const outs = Array.isArray(reg.outputs) ? reg.outputs : [];
    const problems = [];
    if (reg.status !== 'approved') problems.push('status is not "approved"');
    if (!by) problems.push('no approver named');
    if (!ISO_DATE.test(on) || isNaN(Date.parse(on))) problems.push('no real approval date');
    if (!outs.length) problems.push('the approved list is empty');
    outs.forEach((o, i) => problems.push(...definitionProblems(o, i)));
    const dupes = new Set(); const seen = new Set();
    outs.forEach(o => { if (o && o.sheet) { const k = `${o.sheet}|${o.row || o.cell}`; if (seen.has(k)) dupes.add(k); seen.add(k); } });
    if (dupes.size) problems.push(`duplicate output(s): ${[...dupes].slice(0, 3).join(', ')}`);
    const sha256 = crypto.createHash('sha256').update(regText).digest('hex');
    if (!problems.length) {
      return { status: 'approved', approved_by: by, approved_on: on, outputs: outs.length, file: base + '.json', sha256, definitions: outs.map(o => ({ sheet: o.sheet, row: o.row || null, cell: o.cell || null, label: o.label })) };
    }
    return { status: 'invalid', approved_by: by || null, approved_on: on || null, outputs: outs.length, file: base + '.json', sha256, problems,
      note: 'A registry file exists but is not a complete approval: ' + problems.slice(0, 3).join('; ') + (problems.length > 3 ? ` (and ${problems.length - 3} more)` : '') + '.' };
  }
  const prop = parse(readText(base + '.proposed.json'));
  if (prop) return { status: 'proposed', approved_by: null, approved_on: null, outputs: (prop.outputs || []).length, file: base + '.proposed.json' };
  return { status: 'none', approved_by: null, approved_on: null, outputs: 0, file: null };
}

/**
 * An approval belongs to one revision of the model. Each approved output must be found in this workbook: the sheet
 * exists and the row (or cell) holds at least one formula. Anything else means the list no longer describes this file,
 * and the approval does not carry over to it. Adds { usable, resolved, unresolved:[{label, reason}] } to the state.
 */
function checkRegistryAgainstWorkbook(state, workbook, cellScoreIndex) {
  if (!state || state.status !== 'approved' || !Array.isArray(state.definitions)) return state;
  const names = new Set(((workbook && workbook.worksheets) || []).map(w => w.name));
  const rows = new Set(), cells = new Set();
  for (const key of Object.keys(cellScoreIndex || {})) {
    const bang = key.lastIndexOf('!'); const m = /^([A-Z]+)(\d+)$/.exec(key.slice(bang + 1)); if (!m) continue;
    rows.add(`${key.slice(0, bang)}|${m[2]}`); cells.add(key.toUpperCase());
  }
  const unresolved = [];
  for (const d of state.definitions) {
    if (!names.has(d.sheet)) { unresolved.push({ label: d.label, reason: `no sheet "${d.sheet}" in this workbook` }); continue; }
    const holds = d.cell ? cells.has(`${d.sheet}!${d.cell}`.toUpperCase()) : rows.has(`${d.sheet}|${d.row}`);
    if (!holds) unresolved.push({ label: d.label, reason: `${d.cell ? 'cell ' + d.cell : 'row ' + d.row} on "${d.sheet}" holds no formula in this workbook` });
  }
  return Object.assign({}, state, { resolved: state.definitions.length - unresolved.length, unresolved, usable: unresolved.length === 0 });
}

/** { capsTopTier, text } - the highest tier needs an approved list of priority outputs. */
function registryCeiling(state) {
  const approved = !!state && state.status === 'approved' && state.usable !== false;
  return {
    capsTopTier: !approved,
    text: approved
      ? `Priority outputs were approved by ${state.approved_by} on ${state.approved_on} (${state.outputs} listed).`
      : state && state.status === 'approved'
        ? `The approved list of priority outputs does not match this workbook (${(state.unresolved || []).length} of ${state.outputs} not found: ${(state.unresolved || []).slice(0, 2).map(u => `${u.label} - ${u.reason}`).join('; ')}), so the highest reliance tier is not available.`
        : state && state.status === 'proposed'
          ? 'A draft list of priority outputs exists but nobody has approved it, so the highest reliance tier is not available.'
          : state && state.status === 'invalid'
            ? `A priority-output file exists but is not a complete approval (${(state.problems || []).slice(0, 2).join('; ') || 'incomplete'}), so the highest reliance tier is not available.`
            : 'No approved list of priority outputs exists for this model, so the highest reliance tier is not available.',
  };
}

/** Turns a proposed registry into an approved one. Returns the object to write; the caller writes it. */
function approveRegistry(proposed, { approvedBy, approvedOn } = {}) {
  const by = String(approvedBy || '').trim();
  const on = String(approvedOn || '').trim();
  if (!by) throw new Error('An approver name is required.');
  if (!ISO_DATE.test(on) || isNaN(Date.parse(on))) throw new Error('The approval date must be YYYY-MM-DD.');
  if (!proposed || !Array.isArray(proposed.outputs) || proposed.outputs.length === 0) throw new Error('The registry lists no outputs.');
  const bad = proposed.outputs.flatMap((o, i) => definitionProblems(o, i));
  if (bad.length) throw new Error('The registry has incomplete output definitions: ' + bad.slice(0, 3).join('; '));
  return { ...proposed, status: 'approved', approved_by: by, approved_on: on, note: 'Approved list of priority outputs for this model.' };
}

module.exports = { proposeRegistry, slug, loadRegistryState, checkRegistryAgainstWorkbook, registryCeiling, approveRegistry, definitionProblems, REG_DIR };
