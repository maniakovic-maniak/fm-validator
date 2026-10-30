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

module.exports = { proposeRegistry, slug };
