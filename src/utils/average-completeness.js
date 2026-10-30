'use strict';
// average-completeness.js - Patch 31. An AVERAGE over a fixed number of periods must be given that many numbers.
//
// AVERAGE ignores text and blanks. When a year is fed by IFERROR(lookup, ""), a failed lookup does not blank the average:
// it silently drops the year and returns a seven-year average that looks like an eight-year one. Found by an independent
// review of a licence model (Tables!AI70 =IFERROR(AVERAGE(OFFSET($AH$78:$AO$78, MATCH(..., 0)-1, 0)), ""), eight years
// of revenue feeding the bill baseline): with AH78 unavailable the average moves from 190.09 to 195.03, up 2.60%, and no
// error is shown anywhere.
//
// For each AVERAGE over a single row or column of cells, or an OFFSET of one, the check counts the numeric saved values
// against the number of cells the range covers, and separately looks at how the cells are produced:
//   defect            the range currently holds fewer numbers than cells: an observation is already being dropped
//   control weakness  all numeric today, but one or more feeding cells return text on failure (IFERROR/IFNA with a text
//                     fallback), so one failed lookup would drop a period without any error
//   passed            all numeric and no feeding cell can return text
// Where the OFFSET row shift comes from MATCH(cell, list, 0)-1, the shift is resolved from saved values so the range that
// is actually averaged is the one tested; otherwise every possible shift is tested and the worst is reported.
// The sensitivity line is arithmetic on saved values: the average with each observation removed in turn, largest change
// shown. It is a counterfactual, not a recalculation.

const { splitTop, findCalls, parseRef, makeReader, plainValue, isNum, isErr, addr } = require('./path-checks-common');
const { fullFormula } = require('./formula-store');

const MAX_TESTED = 3000;
const TEXT_FALLBACK = /\b(?:IFERROR|IFNA)\s*\([\s\S]*,\s*(?:""|"[^"]*"|NA\s*\(\s*\)\s*&)\s*\)\s*$/i;

function cells(rd, sheet, r) {
  const out = [];
  for (let row = r.r1; row <= r.r2; row++) for (let col = r.c1; col <= r.c2; col++) out.push({ row, col, v: rd.value(sheet, row, col) });
  return out;
}

function checkAverageCompleteness(workbook, cellScoreIndex, opts = {}) {
  const started = Date.now(), maxMs = opts.maxMs || 15000;
  const rd = makeReader(workbook);
  const records = [];
  let candidates = 0, tested = 0, notCompleted = 0, stopped = null;
  const reasons = {};
  const nc = r => { notCompleted++; reasons[r] = (reasons[r] || 0) + 1; };

  for (const [key, info] of Object.entries(cellScoreIndex)) {
    const ft = info.formulaText;
    if (!ft || !/\bAVERAGE\s*\(/i.test(ft)) continue;
    if (tested >= MAX_TESTED) { stopped = `stopped after ${MAX_TESTED} averages`; break; }
    if (Date.now() - started > maxMs) { stopped = `stopped after ${Math.round(maxMs / 1000)} seconds`; break; }
    const formula = fullFormula(cellScoreIndex, key, info) || ft;
    const bang = key.lastIndexOf('!'); const sheet = key.slice(0, bang); const own = parseRef(key.slice(bang + 1));
    if (!own) continue;
    for (const call of findCalls(formula, 'AVERAGE')) {
      if (call.args.length !== 1) continue;                      // AVERAGE(a, b, ...) is a list of values, not a range of periods
      candidates++;
      const arg = call.args[0].trim();
      let base, shifts = [0], resolvedBy = null, off = null;
      const oc = /^OFFSET\s*\(([\s\S]*)\)$/i.exec(arg);
      if (oc) {
        const a = splitTop(oc[1], ',').map(s => s.trim());
        if (a.length !== 3) { nc('OFFSET with a size argument not supported'); continue; }
        base = parseRef(a[0]);
        if (!base || !base.isRange) { nc('OFFSET base is not a range'); continue; }
        if (!/^0$/.test(a[2])) { nc('OFFSET column shift not supported'); continue; }
        off = a[1];
        const mm = /^MATCH\s*\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*0\s*\)\s*-\s*1$/i.exec(off);
        if (/^-?\d+$/.test(off)) shifts = [+off];
        else if (mm) {
          const k = parseRef(mm[1]), list = parseRef(mm[2]);
          if (!list || list.c1 !== list.c2) { nc('MATCH list not a single column'); continue; }
          const listSheet = list.sheet || sheet;
          const n = list.r2 - list.r1 + 1;
          const kv = k && !k.isRange ? rd.value(k.sheet || sheet, k.r1, k.c1) : undefined;
          let at = -1;
          if (kv !== undefined && kv !== null) for (let i = 0; i < n; i++) { const v = rd.value(listSheet, list.r1 + i, list.c1); if (v !== null && String(v).toLowerCase() === String(kv).toLowerCase()) { at = i; break; } }
          if (at >= 0) { shifts = [at]; resolvedBy = `row ${list.r1 + at} of ${listSheet}!${addr(list.r1, list.c1)}:${addr(list.r2, list.c1)}`; }
          else shifts = Array.from({ length: n }, (_, i) => i);
        } else { nc('OFFSET row shift not readable'); continue; }
      } else {
        base = parseRef(arg);
        if (!base || !base.isRange) { nc('AVERAGE argument is not a single range'); continue; }
      }
      const vector = base.r1 === base.r2 || base.c1 === base.c2;
      if (!vector) { nc('range is two-dimensional'); continue; }
      const baseSheet = base.sheet || sheet;
      tested++;
      let worst = null;
      for (const s of shifts) {
        const r = { r1: base.r1 + s, r2: base.r2 + s, c1: base.c1, c2: base.c2 };
        const cs = cells(rd, baseSheet, r);
        const numeric = cs.filter(c => isNum(c.v));
        const missing = cs.length - numeric.length;
        // what each non-numeric cell is: a computed text result (the silent-drop case), an error (AVERAGE shows it), or no data
        const kind = c => { if (isNum(c.v)) return 'num'; if (isErr(c.v)) return 'error'; if (c.v === null) return 'blank'; return typeof c.v === 'string' && rd.formula(baseSheet, c.row, c.col) ? 'computedText' : 'blank'; };
        const computedText = cs.filter(c => kind(c) === 'computedText').map(c => addr(c.row, c.col));
        const blanks = cs.filter(c => kind(c) === 'blank').map(c => addr(c.row, c.col));
        const errors = cs.filter(c => kind(c) === 'error').length;
        const textFallbackFeeders = cs.filter(c => { const f = rd.formula(baseSheet, c.row, c.col); return f && TEXT_FALLBACK.test(f.trim()); }).length;
        const cand = { shift: s, range: `${baseSheet}!${addr(r.r1, r.c1)}:${addr(r.r2, r.c2)}`, size: cs.length, numeric: numeric.length, missing, textFallbackFeeders, values: numeric.map(c => c.v), computedText, blanks, errors };
        const score = computedText.length * 100000 + blanks.length * 1000 + textFallbackFeeders;
        if (!worst || score > worst.score) worst = { ...cand, score };
      }
      const w = worst;
      let verdict, text;
      if (w.computedText.length > 0) { verdict = 'defect'; text = `${w.range}: ${w.numeric} numeric value(s) for ${w.size} period(s); ${w.computedText.slice(0, 6).join(', ')} ${w.computedText.length === 1 ? 'is a formula that returns text' : 'are formulas that return text'}, so AVERAGE silently drops ${w.computedText.length === 1 ? 'it' : 'them'} and divides by ${w.numeric}.`; }
      else if (w.blanks.length > 0) { verdict = 'query'; text = `${w.range}: ${w.numeric} numeric value(s) for ${w.size} period(s); ${w.blanks.slice(0, 6).join(', ')} ${w.blanks.length === 1 ? 'has' : 'have'} no value, so AVERAGE ${w.numeric === 0 ? 'has nothing to average' : 'divides by ' + w.numeric}. Confirm the blank period(s) are intended.`; }
      else if (w.textFallbackFeeders > 0) { verdict = 'control_weakness'; text = `${w.range}: all ${w.size} period(s) are numeric today, but ${w.textFallbackFeeders} feeding cell(s) return text if their lookup fails, and AVERAGE would then drop that period without any error.`; }
      else { verdict = 'passed'; text = `${w.range}: all ${w.size} period(s) are numeric and no feeding cell returns text on failure.`; }
      let sensitivity = null;
      if (w.numeric >= 3 && w.size === w.numeric) {
        const sum = w.values.reduce((a, b) => a + b, 0), avg = sum / w.size;
        let best = null;
        for (let i = 0; i < w.values.length; i++) { const a2 = (sum - w.values[i]) / (w.size - 1); const ch = avg !== 0 ? (a2 - avg) / Math.abs(avg) : 0; if (!best || Math.abs(ch) > Math.abs(best.change)) best = { dropped: i + 1, average: a2, change: ch }; }
        sensitivity = { baseAverage: avg, droppedPeriod: best.dropped, droppedAverage: best.average, change: best.change };
        if (verdict !== 'passed') text += ` With period ${best.dropped} lost the average moves from ${Math.round(avg * 1e4) / 1e4} to ${Math.round(best.average * 1e4) / 1e4} (${best.change >= 0 ? '+' : ''}${(best.change * 100).toFixed(2)}%).`;
      }
      records.push({ kind: 'average', sheet, cell: addr(own.r1, own.c1), range: w.range, size: w.size, numeric: w.numeric, textFallbackFeeders: w.textFallbackFeeders, selectedBy: resolvedBy, shiftsTested: shifts.length, sensitivity, verdict, text });
    }
  }
  const counts = { passed: 0, defect: 0, query: 0, control_weakness: 0 };
  for (const r of records) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  return {
    applicable: candidates > 0, averagesFound: candidates, tested, notCompleted, notCompletedReasons: reasons, stopped, counts,
    records: records.slice(0, 2000), recordsTruncated: records.length > 2000, ms: Date.now() - started,
    note: 'Counts numeric saved values against the cells an AVERAGE over one row or column is given, and looks for feeding cells that return text on failure. The sensitivity figure is arithmetic on saved values, not a recalculation. What a genuinely unavailable period should do is the model owner\'s decision.',
  };
}

module.exports = { checkAverageCompleteness };
