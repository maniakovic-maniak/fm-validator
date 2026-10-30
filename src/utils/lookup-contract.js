'use strict';
// lookup-contract.js - Patch 31. For an exact-match lookup built from keys, say which source row it selects and whether
// that selection is unique.
//
// Found by an independent review of a licence model whose outputs are read with
//   MATCH(metric & scenario & sensitivity, INDEX(Block,,c1) & INDEX(Block,,c2) & INDEX(Block,,c3), 0)
// over a 3,375-row source block. The review asked for the exact keys, the matched source row and a uniqueness test, and
// asked that a unique match is not described as a wrong-entity error. This check does exactly that and nothing more:
//   - it supports MATCH(lookup, array, 0) where the lookup is text constants and single cells joined with &, and the
//     array is INDEX(NamedBlock,,column) parts or plain one-column ranges joined with &,
//   - it evaluates the keys from SAVED values (no recalculation), and counts the source rows whose joined key equals it,
//   - one match = passed; none = defect (the lookup returns #N/A or its fallback); several = query (Excel returns the
//     first, so the choice of row depends on source order),
//   - anything it cannot read (wildcards, dates, an unsupported argument) is counted as not completed, never guessed.
// A concatenated key can collide where two different component sets join to the same text (A&B with "ab"&"" and
// "a"&"b"); the check reports the matches it finds on the joined text, which is what Excel itself compares.

const { ancestors, splitTop, findCalls, parseRef, makeReader, namedAreas, colNum, colName, addr, isNum, isErr } = require('./path-checks-common');
const { fullFormula } = require('./formula-store');

const MAX_SOURCE_ROWS = 300000;
const MAX_TESTED = 5000;
const COND = new Set(['IF', 'IFS', 'IFERROR', 'IFNA', 'CHOOSE', 'SWITCH', 'AND', 'OR']);

function keyText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return null;                       // Excel joins the serial number; not reproduced here
  if (isErr(v)) return null;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return String(v);
}

// One key against one vector is compared as typed values: numbers and dates by serial number, text case-insensitively.
function typedKey(v) {
  if (v === null || v === undefined || v === '' || isErr(v)) return null;
  if (v instanceof Date) { if (isNaN(v.getTime())) return null; return 'n:' + Math.round((v.getTime() / 86400000 + 25569) * 1e6) / 1e6; }
  if (typeof v === 'number') return 'n:' + v;
  if (typeof v === 'boolean') return 'b:' + v;
  return 's:' + String(v);
}

function lookupParts(arg, ownSheet, rd) {
  const parts = [];
  for (const raw of splitTop(arg, '&')) {
    const t = raw.trim();
    if (!t) return null;
    if (/^"(?:[^"]|"")*"$/.test(t)) { const tv = t.slice(1, -1).replace(/""/g, '"'); parts.push({ kind: 'text', value: tv, label: t, saved: tv }); continue; }
    if (/^-?\d+(?:\.\d+)?$/.test(t)) { parts.push({ kind: 'number', value: t, label: t, saved: Number(t) }); continue; }
    const ref = parseRef(t);
    if (!ref || ref.isRange) return null;
    const sheet = ref.sheet || ownSheet;
    const v = rd.value(sheet, ref.r1, ref.c1);
    if (v === undefined) return null;
    if (isErr(v)) return null;
    parts.push({ kind: 'cell', value: keyText(v), label: `${sheet === ownSheet ? '' : sheet + '!'}${addr(ref.r1, ref.c1)}`, saved: v });
  }
  return parts;
}

function arrayParts(arg, ownSheet, rd, names) {
  const parts = [];
  for (const raw of splitTop(arg, '&')) {
    const t = raw.trim();
    const idx = /^INDEX\s*\(([\s\S]*)\)$/i.exec(t);
    if (idx) {
      const a = splitTop(idx[1], ',').map(s => s.trim());
      if (a.length !== 3 || !(a[1] === '' || a[1] === '0')) return null;
      const block = names[a[0].toUpperCase()] || (parseRef(a[0]) && parseRef(a[0]).sheet ? parseRef(a[0]) : null);
      if (!block) return null;
      let col = null;
      if (/^\d+$/.test(a[2])) col = +a[2];
      else { const cr = parseRef(a[2]); if (cr && !cr.isRange) { const v = rd.value(cr.sheet || ownSheet, cr.r1, cr.c1); if (isNum(v)) col = v; } }
      if (!col || col < 1 || col > block.c2 - block.c1 + 1) return null;
      parts.push({ sheet: block.sheet, r1: block.r1, r2: block.r2, c: block.c1 + col - 1, c1: block.c1 + col - 1, c2: block.c1 + col - 1, vertical: true, n: block.r2 - block.r1 + 1, label: `${a[0]} column ${col}` });
      continue;
    }
    const ref = parseRef(t) || (names[t.toUpperCase()] || null);
    if (!ref) return null;
    if (ref.c1 === ref.c2) parts.push({ sheet: ref.sheet || ownSheet, r1: ref.r1, r2: ref.r2, c: ref.c1, c1: ref.c1, c2: ref.c2, vertical: true, n: ref.r2 - ref.r1 + 1, label: t });
    else if (ref.r1 === ref.r2) parts.push({ sheet: ref.sheet || ownSheet, r1: ref.r1, r2: ref.r2, c: ref.c1, c1: ref.c1, c2: ref.c2, vertical: false, n: ref.c2 - ref.c1 + 1, label: t });
    else return null;
  }
  return parts.length ? parts : null;
}

function checkLookupContracts(workbook, cellScoreIndex, opts = {}) {
  const maxMs = opts.maxMs || 20000;
  const started = Date.now();
  const rd = makeReader(workbook);
  const names = namedAreas(workbook);
  const records = [];
  const indexCache = new Map();       // array signature -> { n, rows: Map(lowercase key -> [relative rows]) , first, parts }
  let candidates = 0, tested = 0, notCompleted = 0, stopped = null;
  const reasons = {};
  const nc = r => { notCompleted++; reasons[r] = (reasons[r] || 0) + 1; };

  for (const [key, info] of Object.entries(cellScoreIndex)) {
    const ft = info.formulaText;
    if (!ft || !/MATCH\s*\(/i.test(ft)) continue;
    if (tested >= MAX_TESTED) { stopped = `stopped after ${MAX_TESTED} lookups`; break; }
    if (Date.now() - started > maxMs) { stopped = `stopped after ${Math.round(maxMs / 1000)} seconds`; break; }
    const formula = fullFormula(cellScoreIndex, key, info) || ft;
    const bang = key.lastIndexOf('!'); const sheet = key.slice(0, bang); const own = parseRef(key.slice(bang + 1));
    if (!own) continue;
    for (const call of findCalls(formula, 'MATCH')) {
      if (call.args.length !== 3 || call.args[2].trim() !== '0') continue;
      candidates++;
      if (/[*?~]/.test(call.args[0].replace(/"(?:[^"]|"")*"/g, m => (/[*?~]/.test(m) ? m : '')))) { nc('lookup text contains a wildcard character'); continue; }
      const lp = lookupParts(call.args[0], sheet, rd);
      if (!lp) { nc('lookup value not readable from saved values'); continue; }
      const ap = arrayParts(call.args[1], sheet, rd, names);
      if (!ap) { nc('lookup array form not supported'); continue; }
      const n = ap[0].n;
      if (ap.some(p => p.n !== n || p.vertical !== ap[0].vertical)) { nc('key columns have different lengths'); continue; }
      const typed = lp.length === 1 && ap.length === 1;                 // one key against one vector: compared as typed values (dates by serial number)
      if (!typed && lp.some(p => p.value === null)) { nc('date or blank inside a joined key'); continue; }
      if (typed && (lp[0].saved === null || lp[0].saved === undefined || lp[0].saved === '')) { nc('lookup value is blank'); continue; }
      if (n > MAX_SOURCE_ROWS) { nc('source block too large to scan'); continue; }

      const sig = (typed ? 'T|' : 'S|') + ap.map(p => `${p.sheet}|${p.r1}|${p.r2}|${p.c1}|${p.c2}`).join('&');
      let idx = indexCache.get(sig);
      if (!idx) {
        const rows = new Map(); let bad = 0;
        for (let i = 0; i < n; i++) {
          let k = '';
          for (const p of ap) {
            const v = p.vertical ? rd.value(p.sheet, p.r1 + i, p.c1) : rd.value(p.sheet, p.r1, p.c1 + i);
            const t = typed ? typedKey(v) : keyText(v);
            if (t === null) { k = null; break; }
            k += t;
          }
          if (k === null) { bad++; continue; }
          const lk = k.toLowerCase();
          const arr = rows.get(lk); if (arr) arr.push(i + 1); else rows.set(lk, [i + 1]);
        }
        idx = { n, rows, bad, r1: ap[0].r1, c1: ap[0].c1, vertical: ap[0].vertical, sheet: ap[0].sheet, parts: ap };
        indexCache.set(sig, idx);
      }
      const keyStr = typed ? typedKey(lp[0].saved) : lp.map(p => p.value).join('');
      const shown = typed ? (lp[0].saved instanceof Date ? (isNaN(lp[0].saved.getTime()) ? 'invalid date' : lp[0].saved.toISOString().slice(0, 10)) : String(lp[0].saved)) : keyStr;
      if (keyStr === null) { nc('lookup value not comparable'); continue; }
      const hits = idx.rows.get(keyStr.toLowerCase()) || [];
      tested++;
      const where = h => idx.vertical ? `row ${idx.r1 + h - 1}` : `column ${colName(idx.c1 + h - 1)}`;
      const firstSheetRow = hits.length ? (idx.vertical ? idx.r1 + hits[0] - 1 : idx.c1 + hits[0] - 1) : null;
      const whole = formula.trim().replace(/^=/, '').trim();
      const isWhole = whole === formula.slice(call.start, call.end).trim() || /^MATCH\s*\(/i.test(whole) && findCalls(whole, 'MATCH')[0].end === whole.length;
      const saved = isWhole ? rd.value(sheet, own.r1, own.c1) : undefined;
      const conditional = ancestors(formula, call.start).some(f => COND.has(f));
      if (hits.length > 1 && typed && keyStr === 'n:0') { tested--; nc('key 0 repeats in the source row (an off-period marker, not a selection)'); continue; }
      let verdict, text;
      if (hits.length === 0 && conditional && !isErr(rd.value(sheet, own.r1, own.c1))) { tested--; nc('key not found inside a conditional branch that may not be evaluated'); continue; }
      if (hits.length === 1) { verdict = 'passed'; text = `Key selects one source row (${idx.sheet} ${where(hits[0])}).`; }
      else if (hits.length === 0) { verdict = 'defect'; text = `Key matches no source row, so the lookup returns #N/A or its error fallback.`; }
      else { verdict = 'query'; text = `Key matches ${hits.length} source rows (${idx.sheet} ${idx.vertical ? 'rows' : 'columns'} ${hits.slice(0, 6).map(h => (idx.vertical ? idx.r1 : colName(idx.c1)) === idx.r1 && idx.vertical ? idx.r1 + h - 1 : colName(idx.c1 + h - 1)).join(', ')}${hits.length > 6 ? ', ...' : ''}); Excel returns the first (${where(hits[0])}), so the result depends on source order.`; }
      let savedNote = '';
      if (isNum(saved) && hits.length && saved !== hits[0]) { verdict = 'defect'; savedNote = ` The saved result is ${saved} but the first matching row is ${hits[0]}: the saved value does not agree with the current keys (stale or recalculated differently).`; }
      records.push({
        kind: 'lookup', sheet, cell: own.r1 ? addr(own.r1, own.c1) : key, key: shown, keyParts: lp.map(p => ({ part: p.label, value: p.value === null ? shown : p.value })),
        source: `${idx.sheet}, ${ap.map(p => p.label).join(' + ')}`, sourceRows: idx.n, matches: hits.length, matchedSheetRow: idx.vertical ? firstSheetRow : null, matchedPosition: hits[0] || null,
        unreadableSourceRows: idx.bad, verdict, text: text + savedNote,
      });
    }
  }

  const counts = { passed: 0, defect: 0, query: 0 };
  for (const r of records) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  return {
    applicable: candidates > 0, lookupsFound: candidates, tested, notCompleted, notCompletedReasons: reasons, stopped,
    counts, records: records.slice(0, 2000), recordsTruncated: records.length > 2000, ms: Date.now() - started,
    note: 'Evaluates MATCH(lookup, array, 0) keys from saved values and counts matching source rows. It does not recalculate, does not read wildcard or date keys, and does not judge whether the selected row is the right one economically.',
  };
}

module.exports = { checkLookupContracts, keyText, typedKey };
