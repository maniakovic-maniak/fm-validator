'use strict';
// fallback-propagation.js - Patch 31. What does a text fallback do to the cells that read it?
//
// IFERROR(lookup, "") hides a failed lookup behind an empty string. The cells that read that result then behave in
// different ways, and none of them shows the original failure: arithmetic on the text gives #VALUE!, SUM and AVERAGE
// skip it and return a total that is short by one period, and IF(x="",...) may treat it as a deliberate blank. Found by
// an independent review of a licence model (RoRE ranges!AP48: AP82 =AP48*AP51 can give #VALUE!, while AV48 =SUM(AP48:AT48)
// omits the year), which asked for the missing key to be linked to these different downstream effects.
//
// For one representative cell per formula family whose whole formula is IFERROR/IFNA(<expression with a lookup>, <text>),
// one pass over every formula finds the cells that read it directly and classifies each use:
//   error      read in arithmetic: the text turns the result into #VALUE!
//   omitted    read inside SUM/AVERAGE/MIN/MAX/COUNT/PRODUCT: the period is skipped without any error
//   handled    read inside IF/IFERROR/IFNA/ISNUMBER/ISTEXT/N: the formula looks at the type
//   other      anything else
// Direct readers only (one step). A time budget keeps this safe on a very large model; if it runs out, the result says how
// much was scanned. This does not decide whether a fallback is wrong: it shows what the fallback does downstream.

const { findCalls, parseRef, colNum, colName, addr } = require('./path-checks-common');
const { fullFormula } = require('./formula-store');

const WHOLE_FALLBACK = /^\s*=?\s*(?:IFERROR|IFNA)\s*\(([\s\S]*),\s*(?:""|"[^"]*")\s*\)\s*$/i;
const LOOKUP_FN = /\b(?:OFFSET|INDEX|MATCH|VLOOKUP|HLOOKUP|XLOOKUP|LOOKUP)\s*\(/i;
const AGG = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'PRODUCT', 'MEDIAN', 'STDEV']);
const HANDLES = new Set(['IF', 'IFERROR', 'IFNA', 'ISNUMBER', 'ISTEXT', 'ISBLANK', 'N', 'ISERROR', 'ISERR', 'AND', 'OR']);
const TOKEN = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(])/g;

function enclosing(formula, idx) {
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const ch = formula[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) { const m = /([A-Za-z_][A-Za-z0-9_.]*)\s*$/.exec(formula.slice(0, i)); return m ? m[1].toUpperCase() : null; }
      depth--;
    }
  }
  return null;
}

function checkFallbackPropagation(cellScoreIndex, opts = {}) {
  const started = Date.now(), maxMs = opts.maxMs || 20000, maxTargets = opts.maxTargets || 400;
  const targets = new Map();         // "sheet!ADDR" -> record
  const bySheet = new Map();         // sheet -> [{ rec, r, c }]
  const seenFamily = new Set();
  let fallbackCells = 0;

  for (const [key, info] of Object.entries(cellScoreIndex)) {
    const ft = info.formulaText;
    if (!ft || !/IFERROR|IFNA/i.test(ft)) continue;
    const formula = fullFormula(cellScoreIndex, key, info) || ft;
    const m = WHOLE_FALLBACK.exec(formula);
    if (!m || !LOOKUP_FN.test(m[1])) continue;
    fallbackCells++;
    if (info.ufi && seenFamily.has(info.ufi)) continue;
    if (info.ufi) seenFamily.add(info.ufi);
    if (targets.size >= maxTargets) continue;
    const bang = key.lastIndexOf('!'); const sheet = key.slice(0, bang); const p = parseRef(key.slice(bang + 1));
    if (!p) continue;
    const rec = { sheet, cell: addr(p.r1, p.c1), formula: formula.trim().replace(/^=/, '').slice(0, 160), ufi: info.ufi, effects: { error: 0, omitted: 0, handled: 0, other: 0 }, examples: [] };
    targets.set(key, rec);
    if (!bySheet.has(sheet)) bySheet.set(sheet, []);
    bySheet.get(sheet).push({ rec, r: p.r1, c: p.c1 });
  }

  let scanned = 0, total = 0, stopped = null;
  if (targets.size) {
    total = Object.keys(cellScoreIndex).length;
    for (const [key, info] of Object.entries(cellScoreIndex)) {
      if (scanned % 2000 === 0 && Date.now() - started > maxMs) { stopped = `stopped after ${Math.round(maxMs / 1000)} seconds, ${scanned.toLocaleString()} of ${total.toLocaleString()} formula cells read`; break; }
      scanned++;
      const formula = fullFormula(cellScoreIndex, key, info);
      if (!formula) continue;
      const bang = key.lastIndexOf('!'); const ownSheet = key.slice(0, bang);
      TOKEN.lastIndex = 0; let m;
      while ((m = TOKEN.exec(formula)) !== null) {
        const before = formula[m.index - 1];
        if (!m[1] && !m[2] && before && /[A-Za-z0-9_.$]/.test(before)) continue;
        const sheet = m[1] ? m[1].replace(/''/g, "'") : (m[2] || ownSheet);
        const list = bySheet.get(sheet);
        if (!list) continue;
        const c1 = colNum(m[3]), r1 = +m[4], isRange = m[5] !== undefined;
        const c2 = isRange ? colNum(m[5]) : c1, r2 = isRange ? +m[6] : r1;
        for (const t of list) {
          if (t.r < Math.min(r1, r2) || t.r > Math.max(r1, r2) || t.c < Math.min(c1, c2) || t.c > Math.max(c1, c2)) continue;
          if (key === `${t.rec.sheet}!${t.rec.cell}`) continue;
          if (info.ufi && info.ufi === t.rec.ufi) continue;
          const fn = enclosing(formula, m.index);
          let effect;
          if (fn && AGG.has(fn)) effect = 'omitted';
          else if (fn && HANDLES.has(fn)) effect = 'handled';
          else {
            const pre = formula.slice(0, m.index).replace(/\s+$/, ''), post = formula.slice(m.index + m[0].length).replace(/^\s+/, '');
            effect = (!isRange && (/[-+*/^]$/.test(pre) || /^[-+*/^]/.test(post))) ? 'error' : 'other';
          }
          t.rec.effects[effect]++;
          if (t.rec.examples.length < 4 && effect !== 'handled') t.rec.examples.push({ cell: `${ownSheet === t.rec.sheet ? '' : ownSheet + '!'}${key.slice(bang + 1)}`, effect, formula: formula.trim().replace(/^=/, '').slice(0, 100) });
        }
      }
    }
  }

  const records = [...targets.values()].map(r => {
    const verdict = (r.effects.error + r.effects.omitted) > 0 ? 'control_weakness' : (r.effects.handled + r.effects.other) > 0 ? 'passed' : 'not_applicable';
    const parts = [];
    if (r.effects.error) parts.push(`${r.effects.error} cell(s) use it in arithmetic and would show #VALUE!`);
    if (r.effects.omitted) parts.push(`${r.effects.omitted} total(s) or average(s) would skip it with no error`);
    const text = verdict === 'control_weakness'
      ? `${r.sheet}!${r.cell} returns text if its lookup fails; ${parts.join('; ')}. The failed key is not shown by either.`
      : verdict === 'passed' ? `${r.sheet}!${r.cell} returns text if its lookup fails; readers check the type or use it harmlessly.`
      : `${r.sheet}!${r.cell} returns text if its lookup fails; no other formula reads it directly.`;
    return { kind: 'fallback', ...r, verdict, text };
  });
  const counts = { control_weakness: 0, passed: 0, not_applicable: 0 };
  for (const r of records) counts[r.verdict]++;
  return {
    applicable: fallbackCells > 0, fallbackCells, families: records.length, counts, records, stopped, ms: Date.now() - started,
    truncatedTargets: seenFamily.size > records.length,
    note: 'Looks at formulas of the form IFERROR(lookup, "text") and shows how the cells that read them directly behave when the lookup fails. Direct readers only; it does not decide whether the fallback is wrong.',
  };
}

module.exports = { checkFallbackPropagation };
