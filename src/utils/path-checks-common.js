'use strict';
// path-checks-common.js - Patch 31. Small shared helpers for the three focused checks (lookup contract, average
// completeness, fallback propagation): reference parsing, top-level argument splitting, and reading a cell's saved value
// without creating cells in the workbook object (getCell would, and on a large model that costs memory).

function colNum(letters) { let n = 0; for (const ch of String(letters).toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function addr(row, col) { return colName(col) + row; }

// Split `text` on `sep` at bracket depth 0, outside double-quoted text. Empty arguments are kept (INDEX(Name,,3)).
function splitTop(text, sep) {
  const out = []; let depth = 0, inStr = false, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (ch === '"') { if (text[i + 1] === '"') i++; else inStr = false; } continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') depth--;
    else if (ch === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

// Every call of `fn` in the formula: { args: [text...], start, end } (end = index just after the closing bracket).
function findCalls(formula, fn) {
  const re = new RegExp('(?<![A-Za-z0-9_.])' + fn + '\\s*\\(', 'gi');
  const calls = []; let m;
  while ((m = re.exec(formula)) !== null) {
    let depth = 1, inStr = false, i = m.index + m[0].length;
    const bodyStart = i;
    for (; i < formula.length && depth > 0; i++) {
      const ch = formula[i];
      if (inStr) { if (ch === '"') { if (formula[i + 1] === '"') i++; else inStr = false; } continue; }
      if (ch === '"') inStr = true;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth !== 0) continue;
    calls.push({ args: splitTop(formula.slice(bodyStart, i - 1), ','), start: m.index, end: i });
  }
  return calls;
}

// Names of the functions that enclose position `idx`, innermost first. Used to tell whether a lookup sits in a branch that
// may never be evaluated (IF, CHOOSE, IFERROR ...).
function ancestors(formula, idx) {
  const out = []; let depth = 0, inStr = false;
  // scan backwards, skipping text constants (quotes are paired, so a simple forward pass per quote count is enough)
  const quotes = []; for (let i = 0; i < idx; i++) { if (formula[i] === '"') { if (formula[i + 1] === '"') i++; else quotes.push(i); } }
  const inText = new Set(); for (let q = 0; q + 1 < quotes.length; q += 2) for (let i = quotes[q]; i <= quotes[q + 1]; i++) inText.add(i);
  for (let i = idx - 1; i >= 0; i--) {
    if (inText.has(i)) continue;
    const ch = formula[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) { const m = /([A-Za-z_][A-Za-z0-9_.]*)\s*$/.exec(formula.slice(0, i)); if (m) out.push(m[1].toUpperCase()); }
      else depth--;
    }
  }
  return out;
}

const REF_TEXT = /^\s*(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?\s*$/i;
// "Sheet!$A$1:$B$9" -> { sheet|null, r1, c1, r2, c2, isRange }. Not a reference -> null.
function parseRef(text) {
  const m = REF_TEXT.exec(String(text));
  if (!m) return null;
  const c1 = colNum(m[3]), r1 = +m[4];
  const c2 = m[5] ? colNum(m[5]) : c1, r2 = m[6] ? +m[6] : r1;
  return { sheet: m[1] ? m[1].replace(/''/g, "'") : (m[2] || null), r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2), isRange: !!m[5] };
}

// The saved value of a CELL as a plain JS value. ExcelJS leaves the "result" key out of cell.value for a formula whose
// saved result is 0 (and for shared formulas), but exposes it through cell.result, so that getter is read first. Reading
// cell.value alone treats every zero-valued formula as having no value.
function cellValue(cell) {
  if (!cell) return null;
  const v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date) && (typeof v.formula === 'string' || 'sharedFormula' in v)) {
    const r = cell.result;
    if (r === undefined) return null;
    return plainValue(r && typeof r === 'object' && typeof r.error === 'string' ? { error: r.error } : r);
  }
  return plainValue(v);
}

// The saved value of a raw value as a plain JS value: number, string, boolean, Date, { error } or null.
function plainValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return plainValue(v.result);
    if ('error' in v) return { error: v.error };
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('formula' in v || 'sharedFormula' in v) return null;     // formula with no saved result
  }
  return v;
}

function makeReader(workbook) {
  const sheets = new Map();
  const sheet = name => { if (!sheets.has(name)) sheets.set(name, workbook.getWorksheet(name) || null); return sheets.get(name); };
  return {
    sheet,
    value(sheetName, row, col) { const ws = sheet(sheetName); if (!ws) return undefined; const c = ws.findCell(row, col); return c ? cellValue(c) : null; },
    formula(sheetName, row, col) { const ws = sheet(sheetName); if (!ws) return null; const c = ws.findCell(row, col); if (!c) return null; const v = c.value; return v && typeof v === 'object' && typeof v.formula === 'string' ? v.formula : (typeof c.formula === 'string' ? c.formula : null); },
  };
}

// Defined names -> { NAME_UPPER: parsed single-area reference } (names that point at one rectangular area only).
function namedAreas(workbook) {
  const out = {};
  let model = [];
  try { model = (workbook.definedNames && workbook.definedNames.model) || []; } catch (_) { model = []; }
  for (const dn of model) {
    const r = (dn.ranges || [])[0];
    if (!r || (dn.ranges || []).length !== 1) continue;
    const p = parseRef(r);
    if (p && p.sheet) out[String(dn.name).toUpperCase()] = p;
  }
  return out;
}

const isNum = v => typeof v === 'number' && isFinite(v);
const isErr = v => v !== null && typeof v === 'object' && !(v instanceof Date) && 'error' in v;

module.exports = { ancestors, cellValue, colNum, colName, addr, splitTop, findCalls, parseRef, plainValue, makeReader, namedAreas, isNum, isErr };
