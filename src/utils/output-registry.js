'use strict';
// output-registry.js - drafts the list of outputs a reader of the model relies on, for a person to approve.
// The draft is "proposed" only. It uses sheet and row labels, because Tier 0 holds sheet-level links only until the
// shared reference service (Patch 32) can say which cells feed which. Nothing here changes a verdict.
const { makeReader } = require('./path-checks-common');

const SHEET_HINT = /summary|output|dashboard|returns?|valuation|ratios?|kpi|covenant|scorecard|results/i;
const ROW_HINT = /\b(npv|irr|moic|dscr|llcr|plcr|icr|gearing|leverage|ebitda|equity value|enterprise value|payback|total (assets|liabilities|equity|revenue)|net (income|profit|debt|cash)|check)\b/i;
const MAX_OUTPUTS = 60;

function slug(name) { return String(name || 'model').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'model'; }

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
const fs = require('fs'), path = require('path');
const REG_DIR = path.join(__dirname, '..', '..', 'config', 'output-registries');
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function loadRegistryState(modelName, dir = REG_DIR) {
  const base = slug(modelName);
  const read = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; } };
  const reg = read(base + '.json');
  if (reg) {
    const by = String(reg.approved_by || '').trim(), on = String(reg.approved_on || '').trim();
    if (reg.status === 'approved' && by && ISO_DATE.test(on) && !isNaN(Date.parse(on))) {
      return { status: 'approved', approved_by: by, approved_on: on, outputs: (reg.outputs || []).length, file: base + '.json' };
    }
    return { status: 'invalid', approved_by: by || null, approved_on: on || null, outputs: (reg.outputs || []).length, file: base + '.json',
      note: 'A registry file exists but is not a complete approval (status, approver and ISO date are all required).' };
  }
  const prop = read(base + '.proposed.json');
  if (prop) return { status: 'proposed', approved_by: null, approved_on: null, outputs: (prop.outputs || []).length, file: base + '.proposed.json' };
  return { status: 'none', approved_by: null, approved_on: null, outputs: 0, file: null };
}

/** { capsTopTier, text } - the highest tier needs an approved list of priority outputs. */
function registryCeiling(state) {
  const approved = !!state && state.status === 'approved';
  return {
    capsTopTier: !approved,
    text: approved
      ? `Priority outputs were approved by ${state.approved_by} on ${state.approved_on} (${state.outputs} listed).`
      : state && state.status === 'proposed'
        ? 'A draft list of priority outputs exists but nobody has approved it, so the highest reliance tier is not available.'
        : state && state.status === 'invalid'
          ? 'A priority-output file exists but is not a complete approval, so the highest reliance tier is not available.'
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
  return { ...proposed, status: 'approved', approved_by: by, approved_on: on, note: 'Approved list of priority outputs for this model.' };
}

module.exports = { proposeRegistry, slug, loadRegistryState, registryCeiling, approveRegistry, REG_DIR };
