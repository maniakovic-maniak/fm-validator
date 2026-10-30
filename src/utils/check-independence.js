'use strict';
// check-independence.js - Patch 35. Can a check row ever show a difference?
//
// A Partner Review of a licence model asked whether the model's own check rows (FinancialStatements!AP17, AP60) can fail,
// or whether both sides are driven by the same calculation so that a wrong figure moves both and the check stays at zero.
// The audit had proposed a checks sheet but never tested the checks it already had.
//
// This reads each check row of the form  A - B,  A = B,  ROUND(A - B, n)  or  ABS(A - B),  splits it into its two sides,
// and walks back through the formulas behind each side (ranges included, to a bounded depth). Two outcomes are reported:
//   same cell          a side is the same cell or a direct copy of the other: the difference is zero by construction
//   shared chain       every formula cell behind the smaller side (at least three) is also behind the other side, so the
//                      check compares a figure with something built from it. An error in that chain moves both sides together.
// Neither is a defect: many reconciliations share inputs on purpose. They are Queries, with the cells named, because a check
// that cannot fail gives assurance it has not earned. A side that cannot be walked in full (size, depth) is counted as not
// completed. Constants are not part of the comparison: two sides that merely read the same input are expected to.
// Static analysis cannot run a failure-injection test; it can only show a check could not have failed.

const { splitTop, parseRef, makeReader, addr, isNum } = require('./path-checks-common');
const { fullFormula } = require('./formula-store');
const { precedents, labelOf } = require('./bypassed-checks');

const MAX_CELLS = 40000, MAX_RANGE = 3000, MAX_DEPTH = 60;

function unwrap(f) {
  let t = String(f).trim().replace(/^=/, '');
  for (let i = 0; i < 3; i++) {
    const m = /^(ROUND|ABS)\s*\(([\s\S]*)\)$/i.exec(t);
    if (!m) break;
    const args = splitTop(m[2], ',');
    if (!args) break;
    t = String(args[0]).trim();
  }
  return t;
}

function sides(formula) {
  const t = unwrap(formula);
  for (const sep of ['-', '=']) {
    const parts = splitTop(t, sep);
    if (parts && parts.length === 2 && parts[0].trim() && parts[1].trim()) return [parts[0].trim(), parts[1].trim()];
  }
  return null;
}

// Formula cells behind an expression: { cells:Set, complete:bool, direct:Set of cells named in the expression }.
function chain(expr, sheet, cellScoreIndex) {
  const cells = new Set(); let complete = true; const direct = new Set();
  let frontier = [];
  for (const p of precedents(expr, sheet)) {
    if ((p.r2 - p.r1 + 1) * (p.c2 - p.c1 + 1) > MAX_RANGE) { complete = false; continue; }
    for (let r = p.r1; r <= p.r2; r++) for (let c = p.c1; c <= p.c2; c++) {
      const k = `${p.sheet}!${addr(r, c)}`; direct.add(k);
      if (cellScoreIndex[k] && !cells.has(k)) { cells.add(k); frontier.push(k); }
    }
  }
  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const next = [];
    for (const key of frontier) {
      const f = fullFormula(cellScoreIndex, key, cellScoreIndex[key]); if (!f) continue;
      const own = key.slice(0, key.lastIndexOf('!'));
      for (const p of precedents(f, own)) {
        if ((p.r2 - p.r1 + 1) * (p.c2 - p.c1 + 1) > MAX_RANGE) { complete = false; continue; }
        for (let r = p.r1; r <= p.r2; r++) for (let c = p.c1; c <= p.c2; c++) {
          const k = `${p.sheet}!${addr(r, c)}`;
          if (cellScoreIndex[k] && !cells.has(k)) { cells.add(k); next.push(k); if (cells.size > MAX_CELLS) return { cells, complete: false, direct }; }
        }
      }
    }
    frontier = next;
  }
  if (frontier.length) complete = false;
  return { cells, complete, direct };
}

function checkIndependence(workbook, cellScoreIndex, opts = {}) {
  const rd = makeReader(workbook);
  const deadline = Date.now() + (opts.timeBudgetMs || 8000);
  const rows = new Map();                                   // sheet!row -> [cols]
  for (const key of Object.keys(cellScoreIndex)) {
    const bang = key.lastIndexOf('!'); const sheet = key.slice(0, bang), p = parseRef(key.slice(bang + 1));
    if (!p) continue;
    const rk = `${sheet}!${p.r1}`;
    if (!rows.has(rk)) rows.set(rk, { sheet, row: p.r1, cols: [] });
    rows.get(rk).cols.push(p.c1);
  }
  const records = []; const counts = { rows: 0, tested: 0, sameCell: 0, sharedChain: 0, independent: 0, notCompleted: 0 };
  let timedOut = false;
  for (const { sheet, row, cols } of rows.values()) {
    const label = labelOf(rd, sheet, row);
    if (!/^(check|checks|reconciliation check|balance check|difference)\b|\bcheck\b\s*$/i.test(label)) continue;
    cols.sort((a, b) => a - b);
    // a check row repeats across periods; test the first and last column that holds a zero-valued difference
    const usable = cols.filter(c => { const v = rd.value(sheet, row, c); return isNum(v) && Math.abs(v) <= 1e-3; });
    if (!usable.length) continue;
    counts.rows++;
    if (Date.now() > deadline) { timedOut = true; counts.notCompleted++; counts.tested++; records.push({ sheet, cell: addr(row, usable[0]), label, verdict: 'not_completed', evidence: 'The time allowed for this check ran out before this row was reached.' }); continue; }
    const pick = usable.length > 1 ? [usable[0], usable[usable.length - 1]] : [usable[0]];
    let rec = null;
    const RANK = { query: 4, not_completed: 3, passed: 2, not_applicable: 1 };
    const keep = r => { if (!rec || (RANK[r.verdict] || 0) > (RANK[rec.verdict] || 0)) rec = r; };
    for (const c of pick) {
      const key = `${sheet}!${addr(row, c)}`;
      const f = fullFormula(cellScoreIndex, key, cellScoreIndex[key]);
      const sd = f && sides(f);
      if (!sd) { keep({ key, verdict: 'not_applicable', evidence: 'The check is not a plain difference of two sides.' }); continue; }
      const A = chain(sd[0], sheet, cellScoreIndex), B = chain(sd[1], sheet, cellScoreIndex);
      if (!A.complete || !B.complete) { keep({ key, verdict: 'not_completed', evidence: 'One side draws on more cells than could be walked, so independence was not tested.' }); continue; }
      const aDirect = [...A.direct], bDirect = [...B.direct];
      const sameCell = aDirect.length && bDirect.length && (aDirect.every(x => B.direct.has(x)) && bDirect.every(x => A.direct.has(x)));
      // Compare what lies behind each side, not the side's own top cell: two different totals of the same three cells are
      // one calculation viewed twice.
      const deep = X => new Set([...X.cells].filter(x => !X.direct.has(x)));
      const dA = deep(A), dB = deep(B);
      const small = dA.size <= dB.size ? A : B, big = small === A ? B : A;
      const dSmall = small === A ? dA : dB;
      const smallSide = small === A ? sd[0] : sd[1], bigSide = small === A ? sd[1] : sd[0];
      const contained = dSmall.size >= 2 && [...dSmall].every(x => big.cells.has(x));
      if (sameCell) { keep({ key, verdict: 'query', kind: 'same_cell', evidence: `Both sides of ${key} read the same cells (${aDirect.slice(0, 4).join(', ')}), so the difference is zero by construction.` }); continue; }
      if (contained) {
        const shared = [...dSmall].slice(0, 4).map(x => x.replace(/^.*!/, ''));
        keep({ key, verdict: 'query', kind: 'shared_chain', shared: dSmall.size,
          evidence: `${key} compares "${clipText(smallSide)}" with "${clipText(bigSide)}". All ${dSmall.size} formula cells behind the first (${shared.join(', ')}${dSmall.size > 4 ? ', …' : ''}) are also behind the second, so an error in any of them moves both sides together and the check stays at zero.` });
        continue;
      }
      const onlyA = [...A.cells].filter(x => !B.cells.has(x)), onlyB = [...B.cells].filter(x => !A.cells.has(x));
      const sharedN = A.cells.size - onlyA.length;
      const nm = list => list.slice(0, 4).map(x => x.replace(/^.*!/, '')).join(', ') + (list.length > 4 ? ', …' : '');
      keep({ key, verdict: 'passed', onlyA: onlyA.length, onlyB: onlyB.length, shared: sharedN,
        evidence: `Neither side of ${key} is built entirely from the other. ${onlyA.length} calculation(s) sit only behind the first side${onlyA.length ? ` (${nm(onlyA)})` : ''}, ${onlyB.length} only behind the second${onlyB.length ? ` (${nm(onlyB)})` : ''}, and ${sharedN} behind both. A difference can arise only from the cells used by one side alone; an error in any of the ${sharedN} shared calculations moves both sides together. Static tracing shows the check is not tautological; it does not show that it can fail.` });
    }
    if (!rec) continue;
    counts.tested++;
    const bang = rec.key.lastIndexOf('!');
    const out = { sheet: rec.key.slice(0, bang), cell: rec.key.slice(bang + 1), label, ...rec };
    delete out.key;
    if (out.verdict === 'query') { if (out.kind === 'same_cell') counts.sameCell++; else counts.sharedChain++; }
    else if (out.verdict === 'passed') counts.independent++;
    else if (out.verdict === 'not_completed') counts.notCompleted++;
    records.push(out);
  }
  const vc = { passed: 0, query: 0, not_applicable: 0 };
  let nc = 0; for (const r of records) { if (r.verdict === 'not_completed') nc++; else vc[r.verdict] = (vc[r.verdict] || 0) + 1; }
  const reasons = nc ? { 'a side draws on more cells than could be walked, or the time budget ran out': nc } : {};
  return { applicable: records.length > 0, records, counts: vc, tested: records.length - vc.not_applicable - nc, notCompleted: nc, notCompletedReasons: reasons, detail: counts, timedOut, note: 'Static: shows that a check could not have failed because of a shared calculation; it cannot prove a check is capable of failing. A failure-injection test needs recalculation.' };
}

const clipText = s => (String(s).length > 60 ? String(s).slice(0, 59) + '…' : String(s));
module.exports = { checkIndependence, sides, chain };
