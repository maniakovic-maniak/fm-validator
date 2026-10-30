'use strict';
// key-expression.js - Patch 36. Evaluates the small expressions that lookup keys are built from, from saved values.
//
// A lookup key is often a cell, but sometimes a short calculation: YEAR($I$4) - 1 (the prior year) or
// 2000 + VALUE(RIGHT(H$6, 2)) (the year in a label such as "FY26"). Those were counted as "not readable" and so not tested.
//
// Supported: numbers, quoted text, cell references (saved values), + - * / and brackets, unary minus, and the functions
// YEAR, MONTH, DAY, VALUE, LEFT, RIGHT, MID, LEN. Anything else, text used in arithmetic, a blank, an error value, division
// by zero or an unbalanced bracket gives null, meaning "could not be read"; a wrong value is never produced. The caller
// compares the result with the saved result of the lookup itself, so a mistake here shows up as a disagreement, not a pass.

const { parseRef, colNum, isNum, isErr } = require('./path-checks-common');

const REF = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?![A-Za-z0-9_(])/;
const FN = new Set(['YEAR', 'MONTH', 'DAY', 'VALUE', 'LEFT', 'RIGHT', 'MID', 'LEN']);

function tokenize(src) {
  const toks = []; let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') { let j = i + 1, s = ''; while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; } if (j >= src.length) return null; toks.push({ t: 'str', v: s }); i = j + 1; continue; }
    if (/[0-9.]/.test(ch)) { const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(src.slice(i)); if (!m) return null; toks.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    if ('+-*/(),'.includes(ch)) { toks.push({ t: ch }); i++; continue; }
    const rest = src.slice(i);
    const fn = /^([A-Za-z]+)\s*\(/.exec(rest);
    if (fn && FN.has(fn[1].toUpperCase())) { toks.push({ t: 'fn', v: fn[1].toUpperCase() }); i += fn[1].length; continue; }
    const ref = REF.exec(rest);
    if (ref) { toks.push({ t: 'ref', sheet: ref[1] ? ref[1].replace(/''/g, "'") : (ref[2] || null), col: colNum(ref[3]), row: +ref[4] }); i += ref[0].length; if (src[i] === ':') return null; continue; }
    return null;
  }
  return toks;
}

const serialToParts = n => { const d = new Date(Math.round((n - 25569) * 86400000)); return isNaN(d.getTime()) ? null : d; };
function asDate(v) { if (v instanceof Date) return isNaN(v.getTime()) ? null : v; if (isNum(v)) return serialToParts(v); return null; }
function asNumber(v) { if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime() / 86400000 + 25569; if (isNum(v)) return v; return null; }
function asText(v) { if (typeof v === 'string') return v; if (isNum(v)) return String(v); if (v instanceof Date) return null; return null; }

function evalKeyExpr(src, ownSheet, rd) {
  const toks = tokenize(String(src));
  if (!toks || !toks.length) return null;
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const FAIL = Symbol('fail');
  function expr() { let l = term(); while (l !== FAIL && peek() && (peek().t === '+' || peek().t === '-')) { const op = next().t; const r = term(); if (r === FAIL) return FAIL; const a = asNumber(l), b = asNumber(r); if (a === null || b === null) return FAIL; l = op === '+' ? a + b : a - b; } return l; }
  function term() { let l = unary(); while (l !== FAIL && peek() && (peek().t === '*' || peek().t === '/')) { const op = next().t; const r = unary(); if (r === FAIL) return FAIL; const a = asNumber(l), b = asNumber(r); if (a === null || b === null || (op === '/' && b === 0)) return FAIL; l = op === '*' ? a * b : a / b; } return l; }
  function unary() { if (peek() && peek().t === '-') { next(); const v = unary(); if (v === FAIL) return FAIL; const a = asNumber(v); return a === null ? FAIL : -a; } if (peek() && peek().t === '+') { next(); return unary(); } return atom(); }
  function atom() {
    const k = next(); if (!k) return FAIL;
    if (k.t === 'num' || k.t === 'str') return k.v;
    if (k.t === '(') { const v = expr(); if (v === FAIL || !peek() || next().t !== ')') return FAIL; return v; }
    if (k.t === 'ref') { const v = rd.value(k.sheet || ownSheet, k.row, k.col); if (v === undefined || v === null || v === '' || isErr(v)) return FAIL; return v; }
    if (k.t === 'fn') {
      if (!peek() || next().t !== '(') return FAIL;
      const args = [];
      if (peek() && peek().t === ')') next();
      else { for (;;) { const a = expr(); if (a === FAIL) return FAIL; args.push(a); const n = next(); if (!n) return FAIL; if (n.t === ')') break; if (n.t !== ',') return FAIL; } }
      return callFn(k.v, args);
    }
    return FAIL;
  }
  function callFn(name, a) {
    if (name === 'YEAR' || name === 'MONTH' || name === 'DAY') { if (a.length !== 1) return FAIL; const d = asDate(a[0]); if (!d) return FAIL; return name === 'YEAR' ? d.getUTCFullYear() : name === 'MONTH' ? d.getUTCMonth() + 1 : d.getUTCDate(); }
    if (name === 'VALUE') { if (a.length !== 1) return FAIL; if (isNum(a[0])) return a[0]; const s = asText(a[0]); if (s === null || !/^\s*-?\d+(?:\.\d+)?\s*$/.test(s)) return FAIL; return Number(s); }
    if (name === 'LEN') { if (a.length !== 1) return FAIL; const s = asText(a[0]); return s === null ? FAIL : s.length; }
    if (name === 'LEFT' || name === 'RIGHT') { if (a.length < 1 || a.length > 2) return FAIL; const s = asText(a[0]); const n = a.length === 2 ? asNumber(a[1]) : 1; if (s === null || n === null || n < 0) return FAIL; return name === 'LEFT' ? s.slice(0, n) : (n === 0 ? '' : s.slice(-n)); }
    if (name === 'MID') { if (a.length !== 3) return FAIL; const s = asText(a[0]), st = asNumber(a[1]), n = asNumber(a[2]); if (s === null || st === null || n === null || st < 1 || n < 0) return FAIL; return s.substr(st - 1, n); }
    return FAIL;
  }
  const v = expr();
  if (v === FAIL || p !== toks.length) return null;
  return v;
}

// One value through YEAR / MONTH / DAY (used when a lookup array is YEAR(range)); null when it cannot be read.
function deriveValue(fn, v) {
  const d = asDate(v);
  if (!d) return null;
  return fn === 'YEAR' ? d.getUTCFullYear() : fn === 'MONTH' ? d.getUTCMonth() + 1 : fn === 'DAY' ? d.getUTCDate() : null;
}

module.exports = { evalKeyExpr, deriveValue };
