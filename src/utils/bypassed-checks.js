'use strict';
// bypassed-checks.js - Patch 31. Which of the model's own checks could have caught a given error, and which cannot?
//
// A model can carry an error and still show every check at zero, when the checks test a parallel calculation instead of
// the cell that is wrong. Found by an independent review of a licence model: FinRatios RoRE decomposition!AP38 counts a
// subtotal twice (239.45 against -4.71), yet the six checks beneath it (AP55:AP60) all reconcile to about zero, because
// each tests the separate calculation in AP45:AP52, not AP38 or the cells built on it.
//
// Given a cell, this finds the check rows in the same column and sheet, and reads each check's precedents (ranges included,
// to a depth of 8) to see whether the cell is among them:
//   - a check row is a cell in that column whose saved value is about zero and which sits within 12 rows below a heading
//     that starts with "check", or whose own row label contains "check" or "reconcil",
//   - "reads the cell" means the cell is reachable from the check formula through the formulas in the workbook.
// The result names the checks that do not read the cell. It does not say a check is badly built: only that it was not
// positioned to catch this error. Anything the walk cannot follow (depth, size) is counted, not guessed.

const { parseRef, makeReader, colNum, addr, isNum } = require('./path-checks-common');
const { fullFormula } = require('./formula-store');

const TOKEN = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(])/g;
const MAX_VISITED = 60000, MAX_RANGE = 600, MAX_DEPTH = 40;

function precedents(formula, ownSheet) {
  const out = []; TOKEN.lastIndex = 0; let m;
  while ((m = TOKEN.exec(formula)) !== null) {
    const before = formula[m.index - 1];
    if (!m[1] && !m[2] && before && /[A-Za-z0-9_.$]/.test(before)) continue;
    const sheet = m[1] ? m[1].replace(/''/g, "'") : (m[2] || ownSheet);
    const c1 = colNum(m[3]), r1 = +m[4], c2 = m[5] ? colNum(m[5]) : c1, r2 = m[6] ? +m[6] : r1;
    out.push({ sheet, r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) });
  }
  return out;
}

function reaches(startKey, targetKey, cellScoreIndex) {
  const [tSheet, tAddr] = [targetKey.slice(0, targetKey.lastIndexOf('!')), targetKey.slice(targetKey.lastIndexOf('!') + 1)];
  const tp = parseRef(tAddr);
  const seen = new Set([startKey]); let frontier = [startKey]; let truncated = false;
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const next = [];
    for (const key of frontier) {
      const info = cellScoreIndex[key]; if (!info) continue;
      const f = fullFormula(cellScoreIndex, key, info); if (!f) continue;
      const own = key.slice(0, key.lastIndexOf('!'));
      for (const p of precedents(f, own)) {
        if (p.sheet === tSheet && tp.r1 >= p.r1 && tp.r1 <= p.r2 && tp.c1 >= p.c1 && tp.c1 <= p.c2) return { reads: true, truncated };
        if ((p.r2 - p.r1 + 1) * (p.c2 - p.c1 + 1) > MAX_RANGE) { truncated = true; continue; }
        for (let r = p.r1; r <= p.r2; r++) for (let c = p.c1; c <= p.c2; c++) {
          const k = `${p.sheet}!${addr(r, c)}`;
          if (!seen.has(k) && cellScoreIndex[k]) { seen.add(k); next.push(k); if (seen.size > MAX_VISITED) return { reads: false, truncated: true }; }
        }
      }
    }
    frontier = next;
  }
  return { reads: false, truncated: truncated || frontier.length > 0 };
}

function labelOf(rd, sheet, row) {
  for (let c = 1; c <= 6; c++) { const v = rd.value(sheet, row, c); if (typeof v === 'string' && v.trim() && isNaN(Number(v))) return v.trim(); }
  return '';
}

function findBypassedChecks(workbook, cellScoreIndex, sheet, cell, opts = {}) {
  const rd = makeReader(workbook);
  const p = parseRef(cell); if (!p) return { checks: [], bypassed: [], reading: [] };
  const col = p.c1, row = p.r1, span = opts.span || 60;
  const targetKey = `${sheet}!${cell}`;
  const heads = [];
  const labels = {};
  for (let r = Math.max(1, row - span); r <= row + span; r++) { const l = labelOf(rd, sheet, r); labels[r] = l; if (/^checks?\b/i.test(l)) heads.push(r); }
  const checks = [];
  for (let r = Math.max(1, row - span); r <= row + span; r++) {
    if (r === row) continue;
    const key = `${sheet}!${addr(r, col)}`;
    if (!cellScoreIndex[key]) continue;
    const v = rd.value(sheet, r, col);
    if (!isNum(v) || Math.abs(v) > 1e-3) continue;
    const underHeading = heads.some(h => r > h && r - h <= 12);
    const named = /\bchecks?\b|reconcil/i.test(labels[r] || '');
    if (!underHeading && !named) continue;
    checks.push({ cell: addr(r, col), label: labels[r] || '', value: v, key });
  }
  const results = checks.map(c => ({ ...c, ...reaches(c.key, targetKey, cellScoreIndex) }));
  return {
    target: targetKey,
    checks: results.map(({ key, ...rest }) => rest),
    bypassed: results.filter(r => !r.reads).map(r => r.cell),
    reading: results.filter(r => r.reads).map(r => r.cell),
  };
}

module.exports = { findBypassedChecks };
