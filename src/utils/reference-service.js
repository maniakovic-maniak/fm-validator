'use strict';
// reference-service.js - one tokenizer and one reference model for everything that needs to know what a formula reads.
//
// Why it exists. Three places each parsed references their own way, with a regular expression over the raw text:
// the dependency tracer, the circular-reference detector and (in Python) the recalculation taint tracer. Each one
//   - read address-like text inside quotes as a reference ("C99" became a dependency and then an invented cycle),
//   - kept a range's top-left cell only, so A1=SUM(A2:A10) with A5=A1 was never seen as a cycle,
//   - returned nothing for a named range or a whole column, and
//   - (Python) dropped any range over 2,000 cells without saying so.
//
// The model. tokenizeReferences(formula, ctx) removes string literals first, then returns every reference with its
// kind and its bounds:
//   cell      one cell                        { sheet, c1, r1, c2 = c1, r2 = r1 }
//   range     a rectangle, kept whole         { sheet, c1, r1, c2, r2 }
//   column / row   whole-column and whole-row references, as rectangles to the sheet's edge
//   name      a defined name, resolved to its rectangles when it has one
//   unknown   anything that is a dependency but cannot be located (structured table reference, external workbook,
//             a name that is not a plain range, a sheet that is not in the workbook, a #REF! target)
// References inside ROW, COLUMN, ROWS and COLUMNS are flagged positionOnly: they read a position, never a value.
//
// RangeGraph keeps ranges as ranges. A formula cell has cell edges and range edges; a range edge reaches every
// formula cell inside the rectangle, found through a per-column sorted index, so A1=SUM(A2:A10) really does reach A5.
// Cycle search is the usual three-colour search made lazy: a range is walked only over cells that are not finished
// yet, so a long row-sum over hundreds of already-finished cells costs almost nothing.

const MAX_COL = 16384;
const MAX_ROW = 1048576;
const POSITION_ONLY = new Set(['ROW', 'COLUMN', 'ROWS', 'COLUMNS']);
const LITERALS = new Set(['TRUE', 'FALSE']);
// Functions that evaluate only some of their arguments: from the argument at this index on, a reference is conditional.
// (IF evaluates its condition always; AND and OR evaluate every argument and are not listed.)
const LAZY_FROM = { IF: 1, IFERROR: 1, IFNA: 1, CHOOSE: 1, IFS: 1, SWITCH: 1 };

function colNum(s) { let n = 0; for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) & 31); return n; }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function cellKey(sheet, c, r) { return sheet + '!' + colName(c) + r; }

const isLetter = c => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isDigit = c => c >= 48 && c <= 57;
const isIdentChar = c => isLetter(c) || isDigit(c) || c === 95 /* _ */ || c === 46 /* . */ || c === 92 /* \ */;

// "A1", "$A$1" -> { c, r } or null. Columns beyond XFD and rows beyond 1048576 are not cells.
function parseCell(t) {
  let i = 0;
  if (t.charCodeAt(i) === 36) i++;
  const cs = i;
  while (i < t.length && isLetter(t.charCodeAt(i))) i++;
  const cl = i - cs;
  if (cl < 1 || cl > 3) return null;
  if (t.charCodeAt(i) === 36) i++;
  const rs = i;
  while (i < t.length && isDigit(t.charCodeAt(i))) i++;
  if (i === rs || i !== t.length) return null;
  const c = colNum(t.slice(cs, cs + cl).toUpperCase());
  const r = +t.slice(rs);
  if (c > MAX_COL || r < 1 || r > MAX_ROW) return null;
  return { c, r };
}
function parseColOnly(t) {            // "A", "$A"
  let i = 0;
  if (t.charCodeAt(i) === 36) i++;
  const cs = i;
  while (i < t.length && isLetter(t.charCodeAt(i))) i++;
  if (i !== t.length || i - cs < 1 || i - cs > 3) return null;
  const c = colNum(t.slice(cs).toUpperCase());
  return c <= MAX_COL ? c : null;
}
function parseRowOnly(t) {            // "5", "$5"
  let i = 0;
  if (t.charCodeAt(i) === 36) i++;
  const rs = i;
  while (i < t.length && isDigit(t.charCodeAt(i))) i++;
  if (i !== t.length || i === rs) return null;
  const r = +t.slice(rs);
  return r >= 1 && r <= MAX_ROW ? r : null;
}

// Resolve a sheet name case-insensitively against the workbook's sheets. ctx.sheetLookup is a Map(lowercase -> name).
function resolveSheet(name, ctx) {
  if (!ctx || !ctx.sheetLookup) return name;
  return ctx.sheetLookup.get(name.toLowerCase()) || null;
}

function makeContext(allSheetNames, names) {
  const sheetLookup = new Map();
  for (const s of allSheetNames || []) sheetLookup.set(String(s).toLowerCase(), s);
  const nameMap = new Map();
  if (names) for (const [k, v] of (names instanceof Map ? names : Object.entries(names))) nameMap.set(String(k).toUpperCase(), Array.isArray(v) ? v : [v]);
  return { sheetLookup, names: nameMap };
}

// Read a quoted sheet name starting at s[i] === "'" ; returns { text, end } with '' collapsed to '.
function readQuoted(s, i) {
  let j = i + 1, out = '';
  while (j < s.length) {
    if (s[j] === "'") { if (s[j + 1] === "'") { out += "'"; j += 2; continue; } return { text: out, end: j + 1 }; }
    out += s[j]; j++;
  }
  return { text: out, end: j, unterminated: true };
}

// Read an unquoted token of identifier characters, plus $ (for absolute markers).
function readRefToken(s, i) {
  let j = i;
  while (j < s.length) {
    const c = s.charCodeAt(j);
    if (isIdentChar(c) || c === 36 || c === 63) j++; else break;
  }
  return j;
}

/**
 * @param {string} formula   formula text, with or without the leading '='
 * @param {string} currentSheet
 * @param {object} ctx       from makeContext(allSheetNames, names)
 * @returns {{ refs: object[], unknown: object[], stringsRemoved: number }}
 */
function tokenizeReferences(formula, currentSheet, ctx) {
  const refs = [], unknown = [];
  let stringsRemoved = 0;
  if (!formula) return { refs, unknown, stringsRemoved };
  const s = formula.charCodeAt(0) === 61 ? formula.slice(1) : formula;
  const n = s.length;
  const callStack = [];                    // one entry per open bracket: { fn, arg } (fn is '' for a plain bracket)
  let positionDepth = 0;                   // how many open brackets belong to ROW/COLUMN/ROWS/COLUMNS
  let i = 0;

  const isConditional = () => {
    for (let k = callStack.length - 1; k >= 0; k--) { const f = callStack[k]; const from = LAZY_FROM[f.fn]; if (from !== undefined && f.arg >= from) return true; }
    return false;
  };
  const push = (ref) => { ref.positionOnly = positionDepth > 0; ref.conditional = isConditional(); refs.push(ref); };
  const addUnknown = (kind, text) => { unknown.push({ kind, text }); };

  // Add the reference(s) for one resolved rectangle.
  const addRect = (sheet, c1, r1, c2, r2, kind, text) => {
    if (c1 > c2) { const t = c1; c1 = c2; c2 = t; }
    if (r1 > r2) { const t = r1; r1 = r2; r2 = t; }
    push({ kind: (c1 === c2 && r1 === r2) ? 'cell' : kind, sheet, c1, r1, c2, r2, text });
  };

  // After a sheet qualifier (or none), parse the address part at position i; returns the new index or -1.
  const readAddress = (sheet, startIdx, text0) => {
    const end = readRefToken(s, startIdx);
    if (end === startIdx) return -1;
    const first = s.slice(startIdx, end);
    // second half of a range?
    if (s[end] === ':') {
      let end2 = readRefToken(s, end + 1);
      let second = s.slice(end + 1, end2);
      // Sheet!A1:Sheet!B2 - the second half repeats the qualifier
      if (end2 < n && s[end2] === '!' && second) { const e3 = readRefToken(s, end2 + 1); if (e3 > end2 + 1) { second = s.slice(end2 + 1, e3); end2 = e3; } }
      const a = parseCell(first), b = parseCell(second);
      if (a && b) { addRect(sheet, a.c, a.r, b.c, b.r, 'range', text0 + s.slice(startIdx, end2)); return end2; }
      const ca = parseColOnly(first), cb = parseColOnly(second);
      if (ca && cb) { addRect(sheet, ca, 1, cb, MAX_ROW, 'column', text0 + s.slice(startIdx, end2)); return end2; }
      const ra = parseRowOnly(first), rb = parseRowOnly(second);
      if (ra && rb) { addRect(sheet, 1, ra, MAX_COL, rb, 'row', text0 + s.slice(startIdx, end2)); return end2; }
      // A1:INDEX(...) or A1:OFFSET(...): the far end is computed; the near end is a real cell and the function's own
      // arguments are read as they come
      const near = parseCell(first);
      if (near && second === '' || (near && s[end2] === '(')) { addRect(sheet, near.c, near.r, near.c, near.r, 'cell', text0 + first); return end; }
      return -1;
    }
    const a = parseCell(first);
    if (a) { addRect(sheet, a.c, a.r, a.c, a.r, 'cell', text0 + first); return end; }
    return -1;
  };

  while (i < n) {
    const ch = s.charCodeAt(i);

    // string literal: removed entirely, "" is an escaped quote
    if (ch === 34) {
      i++;
      while (i < n) { if (s.charCodeAt(i) === 34) { if (s.charCodeAt(i + 1) === 34) { i += 2; continue; } i++; break; } i++; }
      stringsRemoved++;
      continue;
    }

    // brackets
    if (ch === 40) { callStack.push({ fn: '', arg: 0 }); i++; continue; }
    if (ch === 41) { const f = callStack.pop(); if (f && POSITION_ONLY.has(f.fn)) positionDepth--; i++; continue; }
    if (ch === 44 && callStack.length) { callStack[callStack.length - 1].arg++; i++; continue; }

    // error literal such as #REF! or #N/A
    if (ch === 35) {
      let j = i + 1;
      while (j < n && (isLetter(s.charCodeAt(j)) || s[j] === '/' || s[j] === '0')) j++;
      if (s[j] === '!' || s[j] === '?') j++;
      i = Math.max(j, i + 1);
      continue;
    }

    // external workbook index: [1]Sheet!A1
    if (ch === 91) {
      const close = s.indexOf(']', i);
      if (close > 0 && /^\[\d+\]/.test(s.slice(i, close + 1))) {
        // consume "[n]SheetName!" and the address that follows
        let j = close + 1;
        if (s[j] === "'") { j = readQuoted(s, j).end; } else { while (j < n && isIdentChar(s.charCodeAt(j))) j++; }
        if (s[j] === '!') { j++; const e = readRefToken(s, j); let k = e; if (s[k] === ':') k = readRefToken(s, k + 1); addUnknown('external', s.slice(i, k)); i = Math.max(k, i + 1); continue; }
        addUnknown('external', s.slice(i, close + 1)); i = close + 1; continue;
      }
      // structured/table reference fragment without its table name: skip to the matching bracket
      let depth = 0, j = i;
      while (j < n) { if (s[j] === '[') depth++; else if (s[j] === ']') { depth--; if (depth === 0) { j++; break; } } j++; }
      addUnknown('structured', s.slice(i, j)); i = j; continue;
    }

    // quoted sheet name: 'My Sheet'!A1, '[Book.xlsx]Sheet'!A1
    if (ch === 39) {
      const q = readQuoted(s, i);
      if (s[q.end] === '!') {
        const raw = q.text;
        const text0 = s.slice(i, q.end + 1);
        if (raw.charCodeAt(0) === 91) { // external book
          const e = readRefToken(s, q.end + 1); let k = e; if (s[k] === ':') k = readRefToken(s, k + 1);
          addUnknown('external', s.slice(i, k)); i = Math.max(k, q.end + 1); continue;
        }
        const sheet = resolveSheet(raw, ctx);
        if (!sheet) { const e = readRefToken(s, q.end + 1); addUnknown('sheet not in workbook', text0 + s.slice(q.end + 1, e)); i = Math.max(e, q.end + 1); continue; }
        if (s.startsWith('#REF!', q.end + 1)) { addUnknown('deleted reference', text0 + '#REF!'); i = q.end + 6; continue; }
        const e = readAddress(sheet, q.end + 1, text0);
        if (e < 0) { addUnknown('name or address on sheet', text0); i = q.end + 1; } else i = e;
        continue;
      }
      i = q.end; continue;
    }

    // identifier, cell, name, function, sheet qualifier
    if (isLetter(ch) || ch === 95 || ch === 36 || ch === 92) {
      const start = i;
      let end = readRefToken(s, i);
      const tok = s.slice(start, end);

      // function call
      if (s.charCodeAt(end) === 40) {
        const up = tok.toUpperCase();
        callStack.push({ fn: up, arg: 0 });
        if (POSITION_ONLY.has(up)) positionDepth++;
        i = end + 1; continue;
      }

      // 3D reference Sheet1:Sheet3!A1 (sheet, ':' , sheet, '!')
      if (s[end] === ':' ) {
        const e2 = readRefToken(s, end + 1);
        if (e2 > end + 1 && s[e2] === '!' && ctx && ctx.sheetLookup && ctx.sheetLookup.has(tok.toLowerCase())) {   // a sheet can be named like a column (Jan)
          const sh1 = resolveSheet(tok, ctx), sh2 = resolveSheet(s.slice(end + 1, e2), ctx);
          const e3 = readRefToken(s, e2 + 1);
          addUnknown('3-D reference', s.slice(start, Math.max(e3, e2 + 1)));
          if (sh1 && sh2 && ctx && ctx.sheetOrder) {
            const i1 = ctx.sheetOrder.indexOf(sh1), i2 = ctx.sheetOrder.indexOf(sh2);
            if (i1 >= 0 && i2 >= 0) {
              unknown.pop();
              const cell = parseCell(s.slice(e2 + 1, e3));
              if (cell) for (let k = Math.min(i1, i2); k <= Math.max(i1, i2); k++) addRect(ctx.sheetOrder[k], cell.c, cell.r, cell.c, cell.r, 'cell', s.slice(start, e3));
              else unknown.push({ kind: '3-D reference', text: s.slice(start, e3) });
            }
          }
          i = Math.max(e3, e2 + 1); continue;
        }
      }

      // sheet-qualified reference
      if (s[end] === '!') {
        const sheet = resolveSheet(tok, ctx);
        const text0 = tok + '!';
        if (!sheet) { const e = readRefToken(s, end + 1); addUnknown('sheet not in workbook', text0 + s.slice(end + 1, e)); i = Math.max(e, end + 1); continue; }
        if (s.startsWith('#REF!', end + 1)) { addUnknown('deleted reference', text0 + '#REF!'); i = end + 6; continue; }
        const e = readAddress(sheet, end + 1, text0);
        if (e < 0) {
          // Sheet!NamedRange
          const e2 = readRefToken(s, end + 1);
          const nm = s.slice(end + 1, e2).toUpperCase();
          const hit = ctx && ctx.names && ctx.names.get(nm);
          if (hit) { for (const r of hit) addRect(r.sheet, r.c1, r.r1, r.c2, r.r2, (r.c1 === r.c2 && r.r1 === r.r2) ? 'cell' : 'range', tok + '!' + nm); }
          else addUnknown('name', text0 + s.slice(end + 1, e2));
          i = Math.max(e2, end + 1);
        } else i = e;
        continue;
      }

      // bare range or cell on the current sheet
      {
        // A1:B5, A:A, $A$1
        const e = readAddress(currentSheet, start, '');
        if (e >= 0) { i = e; continue; }
      }

      // number literal that begins with a letter cannot happen; a bare token is a name, TRUE/FALSE, or noise
      const up = tok.toUpperCase();
      if (LITERALS.has(up)) { i = end; continue; }
      if (/^R\d*C\d*$/i.test(tok)) { i = end; continue; }                // R1C1 notation: not used with A1 style workbooks
      const hit = ctx && ctx.names && ctx.names.get(up);
      if (hit) { for (const r of hit) addRect(r.sheet, r.c1, r.r1, r.c2, r.r2, (r.c1 === r.c2 && r.r1 === r.r2) ? 'cell' : 'range', tok); }
      else if (end < n && s[end] === '[') {
        // Table1[Column] structured reference
        let depth = 0, j = end;
        while (j < n) { if (s[j] === '[') depth++; else if (s[j] === ']') { depth--; if (depth === 0) { j++; break; } } j++; }
        addUnknown('structured', s.slice(start, j)); end = j;
      } else {
        addUnknown('name', tok);
      }
      i = Math.max(end, start + 1); continue;
    }

    // whole-row reference without sheet: 5:5
    if (isDigit(ch)) {
      let j = i;
      while (j < n && isDigit(s.charCodeAt(j))) j++;
      // number with decimals or exponent
      if (s[j] === '.' || ((s[j] === 'E' || s[j] === 'e') && (isDigit(s.charCodeAt(j + 1)) || ((s[j + 1] === '+' || s[j + 1] === '-') && isDigit(s.charCodeAt(j + 2)))))) {
        j++;
        while (j < n && (isDigit(s.charCodeAt(j)) || ((s[j] === '+' || s[j] === '-') && (s[j - 1] === 'E' || s[j - 1] === 'e')) || s[j] === 'E' || s[j] === 'e')) j++;
        i = j; continue;
      }
      if (s[j] === ':' && i === 0 || (s[j] === ':' && /[\s(,+\-*/=<>&^;]/.test(s[i - 1] || '('))) {
        const e2 = readRefToken(s, j + 1);
        const ra = parseRowOnly(s.slice(i, j)), rb = parseRowOnly(s.slice(j + 1, e2));
        if (ra && rb) { addRect(currentSheet, 1, ra, MAX_COL, rb, 'row', s.slice(i, e2)); i = e2; continue; }
      }
      i = j; continue;
    }

    i++;
  }
  return { refs, unknown, stringsRemoved };
}

// ---------------------------------------------------------------------------------------------------------------
// Compatibility: the cell list the tracer has always returned ([{ sheet, cell }]), now from the shared tokenizer.
// A range contributes up to `rangeLimit` of its cells, row by row, instead of its top-left cell only.
function expandRefs(tokenized, opts = {}) {
  const rangeLimit = opts.rangeLimit == null ? 60 : opts.rangeLimit;
  const out = [], seen = new Set();
  let cut = 0;
  for (const r of tokenized.refs) {
    if (r.positionOnly && !opts.includePositionOnly) continue;
    const size = (r.r2 - r.r1 + 1) * (r.c2 - r.c1 + 1);
    if (size > rangeLimit) cut++;                       // more cells than we expand: the rest are not listed, and the caller is told
    let count = 0;
    for (let rr = r.r1; rr <= r.r2 && count < rangeLimit; rr++) {
      for (let cc = r.c1; cc <= r.c2 && count < rangeLimit; cc++) {
        count++;
        const key = cellKey(r.sheet, cc, rr);
        if (!seen.has(key)) { seen.add(key); out.push({ sheet: r.sheet, cell: colName(cc) + rr }); }
      }
    }
  }
  return { cells: out, rangesCut: cut };
}

// ---------------------------------------------------------------------------------------------------------------
class RangeGraph {
  constructor() {
    this.keys = [];                  // node id -> "Sheet!A1"
    this.idOf = new Map();           // key -> node id
    this.nodeSheet = [];             // node id -> sheet name
    this.nodeCol = [];               // node id -> column number
    this.nodeRow = [];               // node id -> row number
    this.cellEdges = [];             // node id -> number[] (node ids)
    this.rangeEdges = [];            // node id -> number[] (range ids)
    this.ranges = [];                // range id -> { sheet, c1, r1, c2, r2 }
    this.rangeId = new Map();
    this.unknown = { total: 0, byKind: {}, samples: [] };
    this.stats = { formulaCells: 0, cellEdges: 0, rangeEdges: 0, conditionalEdges: 0, distinctRanges: 0, stringsRemoved: 0, positionOnlyIgnored: 0 };
    this.index = null;               // built by finalize()
  }
  addNode(sheet, c, r) {
    const key = cellKey(sheet, c, r);
    if (this.idOf.has(key)) return this.idOf.get(key);
    const id = this.keys.length;
    this.keys.push(key); this.idOf.set(key, id);
    this.nodeSheet.push(sheet); this.nodeCol.push(c); this.nodeRow.push(r);
    this.cellEdges.push(null); this.rangeEdges.push(null);
    return id;
  }
  rangeFor(sheet, c1, r1, c2, r2) {
    const k = sheet + '|' + c1 + '|' + r1 + '|' + c2 + '|' + r2;
    let id = this.rangeId.get(k);
    if (id === undefined) { id = this.ranges.length; this.ranges.push({ sheet, c1, r1, c2, r2 }); this.rangeId.set(k, id); }
    return id;
  }
  noteUnknown(u) {
    this.unknown.total++;
    this.unknown.byKind[u.kind] = (this.unknown.byKind[u.kind] || 0) + 1;
    if (this.unknown.samples.length < 20 && !this.unknown.samples.some(x => x.kind === u.kind && x.text === u.text)) this.unknown.samples.push(u);
  }
  // Per sheet, per column: the formula cells' rows in order, so a rectangle can be walked without touching every cell.
  finalize() {
    const bySheet = new Map();
    for (let id = 0; id < this.keys.length; id++) {
      let cols = bySheet.get(this.nodeSheet[id]); if (!cols) { cols = new Map(); bySheet.set(this.nodeSheet[id], cols); }
      let arr = cols.get(this.nodeCol[id]); if (!arr) { arr = []; cols.set(this.nodeCol[id], arr); }
      arr.push(id);
    }
    const sheets = new Map();
    this.entryOf = new Int32Array(this.keys.length);
    this.posOf = new Int32Array(this.keys.length);
    this.entries = [];
    for (const [sheet, cols] of bySheet) {
      const colNums = [...cols.keys()].sort((a, b) => a - b);
      const colEntries = [];
      for (const c of colNums) {
        const ids = cols.get(c).sort((a, b) => this.nodeRow[a] - this.nodeRow[b]);
        const rows = new Int32Array(ids.length), idArr = new Int32Array(ids.length), next = new Int32Array(ids.length + 1);
        const e = this.entries.length;
        for (let k = 0; k < ids.length; k++) { rows[k] = this.nodeRow[ids[k]]; idArr[k] = ids[k]; next[k] = k; this.entryOf[ids[k]] = e; this.posOf[ids[k]] = k; }
        next[ids.length] = ids.length;
        this.entries.push({ col: c, rows, ids: idArr, next });
        colEntries.push({ col: c, entry: e });
      }
      sheets.set(sheet, { cols: Int32Array.from(colNums), entryIdx: Int32Array.from(colEntries.map(x => x.entry)) });
    }
    this.index = sheets;
    this.stats.formulaCells = this.keys.length;
    this.stats.distinctRanges = this.ranges.length;
    return this;
  }
  findNext(entry, pos) {                 // first not-yet-finished position at or after pos
    const nx = entry.next;
    let p = pos;
    while (nx[p] !== p) p = nx[p];
    while (nx[pos] !== p) { const t = nx[pos]; nx[pos] = p; pos = t; }
    return p;
  }
  resetWalkState() {                     // make every cell unfinished again (a second search over the same graph)
    for (const e of this.entries) for (let k = 0; k < e.next.length; k++) e.next[k] = k;
  }
  retire(id) {                           // the node is finished (black): skip it in later range walks
    const e = this.entries[this.entryOf[id]];
    e.next[this.posOf[id]] = this.posOf[id] + 1;
  }
  edgesOf(key) {                         // for tests and debugging: direct cell edges, then the formula cells in each range
    const id = this.idOf.get(key);
    if (id === undefined) return [];
    const out = new Set((this.cellEdges[id] || []).map(x => this.keys[x >> 1]));
    for (const rid of this.rangeEdges[id] || []) for (const x of this.cellsInRange(this.ranges[rid >> 1])) out.add(this.keys[x]);
    return [...out];
  }
  cellsInRange(r) {
    const out = [];
    const sh = this.index && this.index.get(r.sheet);
    if (!sh) return out;
    let lo = 0, hi = sh.cols.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sh.cols[m] < r.c1) lo = m + 1; else hi = m; }
    for (let k = lo; k < sh.cols.length && sh.cols[k] <= r.c2; k++) {
      const en = this.entries[sh.entryIdx[k]];
      let a = 0, b = en.rows.length;
      while (a < b) { const m = (a + b) >> 1; if (en.rows[m] < r.r1) a = m + 1; else b = m; }
      for (let p = a; p < en.rows.length && en.rows[p] <= r.r2; p++) out.push(en.ids[p]);
    }
    return out;
  }
}

/**
 * Build the range-aware graph from the formula index.
 * @param {object} cellScoreIndex  "Sheet!A1" -> { formulaText, ... }
 * @param {string[]} allSheetNames
 * @param {object} [opts]  { names: { NAME: {sheet,c1,r1,c2,r2} | [..] }, textOf(key, info) -> full formula, skipPositionOnly (default true) }
 */
function buildRangeGraph(cellScoreIndex, allSheetNames, opts = {}) {
  const ctx = makeContext(allSheetNames, opts.names);
  ctx.sheetOrder = allSheetNames;
  const g = new RangeGraph();
  const textOf = opts.textOf || ((key, info) => info.formulaText);
  const keys = Object.keys(cellScoreIndex);

  // pass 1: register every formula cell
  const parsedKeys = [];
  for (const key of keys) {
    const info = cellScoreIndex[key];
    const bang = key.lastIndexOf('!');
    const sheet = key.slice(0, bang);
    const cell = parseCell(key.slice(bang + 1));
    if (!cell) continue;
    const text = textOf(key, info);
    if (!text) continue;
    parsedKeys.push({ key, sheet, cell, text });
    g.addNode(sheet, cell.c, cell.r);
  }
  g.finalize();

  // pass 2: parse each formula once and attach its edges
  const skipPos = opts.skipPositionOnly !== false;
  for (const p of parsedKeys) {
    const id = g.idOf.get(cellKey(p.sheet, p.cell.c, p.cell.r));
    const t = tokenizeReferences(p.text, p.sheet, ctx);
    g.stats.stringsRemoved += t.stringsRemoved;
    for (const u of t.unknown) g.noteUnknown(u);
    let ce = null, re = null;
    for (const r of t.refs) {
      if (r.positionOnly && skipPos) { g.stats.positionOnlyIgnored++; continue; }
      const cb = r.conditional ? 1 : 0;                     // edge = target * 2 + (1 when the reference is in a lazily evaluated argument)
      if (r.c1 === r.c2 && r.r1 === r.r2) {
        const tid = g.idOf.get(cellKey(r.sheet, r.c1, r.r1));
        if (tid !== undefined) { (ce || (ce = [])).push(tid * 2 + cb); g.stats.cellEdges++; if (cb) g.stats.conditionalEdges++; }
      } else {
        (re || (re = [])).push(g.rangeFor(r.sheet, r.c1, r.r1, r.c2, r.r2) * 2 + cb); g.stats.rangeEdges++; if (cb) g.stats.conditionalEdges++;
      }
    }
    g.cellEdges[id] = ce; g.rangeEdges[id] = re;
  }
  g.stats.distinctRanges = g.ranges.length;
  return g;
}

/**
 * Cycle search over a RangeGraph. The usual three-colour search, iterative, with a range edge walked lazily over the
 * cells in the rectangle that are not finished yet.
 *
 * Two passes. The first follows only unconditional edges (a reference in a function argument that is always
 * evaluated); any cycle it finds is one Excel would report. The second follows every edge; a cycle found there that
 * needs a lazily evaluated argument (an IF branch, a CHOOSE option, an IFERROR fallback) is reported as conditional,
 * because Excel only meets it if that branch runs.
 *
 * @returns {{ path: string[], throughRange: boolean, conditional: boolean }[]}  path is a closed list of "Sheet!A1"
 */
function findCyclesInRangeGraph(g, opts = {}) {
  const maxCycles = opts.maxCycles || 5000;
  const seen = new Set();
  const cycles = [];
  const first = searchPass(g, true, seen, cycles, maxCycles);
  let capped = first;
  if (!capped) { g.resetWalkState(); capped = searchPass(g, false, seen, cycles, maxCycles); }
  cycles.capped = capped;
  return cycles;
}

function searchPass(g, unconditionalOnly, seen, cycles, maxCycles) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const n = g.keys.length;
  const color = new Uint8Array(n);

  const report = (stack, hit, closingRange, closingCond) => {
    let startAt = 0;
    for (let k = 0; k < stack.length; k++) if (stack[k].node === hit) { startAt = k; break; }
    const path = [];
    let throughRange = closingRange, conditional = closingCond;
    for (let k = startAt; k < stack.length; k++) {
      path.push(g.keys[stack[k].node]);
      if (k > startAt) { if (stack[k].viaRange) throughRange = true; if (stack[k].viaCond) conditional = true; }
    }
    path.push(g.keys[hit]);
    const sig = [...path].sort().join('|');
    if (seen.has(sig)) return;
    seen.add(sig);
    cycles.push({ path, throughRange, conditional });
  };

  const startRange = (rid) => {
    const r = g.ranges[rid];
    const sh = g.index.get(r.sheet);
    if (!sh) return null;
    let lo = 0, hi = sh.cols.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sh.cols[m] < r.c1) lo = m + 1; else hi = m; }
    if (lo >= sh.cols.length || sh.cols[lo] > r.c2) return null;
    return { r, sh, k: lo, pos: -1 };
  };
  const nextInRange = (w) => {
    const { r, sh } = w;
    while (w.k < sh.cols.length && sh.cols[w.k] <= r.c2) {
      const en = g.entries[sh.entryIdx[w.k]];
      if (w.pos < 0) {
        let a = 0, b = en.rows.length;
        while (a < b) { const m = (a + b) >> 1; if (en.rows[m] < r.r1) a = m + 1; else b = m; }
        w.pos = a;
      }
      const p = g.findNext(en, w.pos);
      if (p < en.rows.length && en.rows[p] <= r.r2) { w.pos = p + 1; return en.ids[p]; }
      w.k++; w.pos = -1;
    }
    return -1;
  };

  for (let start = 0; start < n; start++) {
    if (color[start] !== WHITE) continue;
    const stack = [{ node: start, ci: 0, ri: 0, walk: null, viaRange: false, viaCond: false }];
    color[start] = GRAY;
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      let next = -1, viaRange = false, viaCond = false;
      const ce = g.cellEdges[top.node], re = g.rangeEdges[top.node];
      while (ce && top.ci < ce.length) {
        const e = ce[top.ci++];
        if (unconditionalOnly && (e & 1)) continue;
        next = e >> 1; viaCond = (e & 1) === 1; break;
      }
      if (next < 0) {
        while (true) {
          if (top.walk) {
            const nx = nextInRange(top.walk);
            if (nx >= 0) { next = nx; viaRange = true; viaCond = top.walkCond; break; }
            top.walk = null;
          }
          if (re && top.ri < re.length) {
            const e = re[top.ri++];
            if (unconditionalOnly && (e & 1)) continue;
            top.walk = startRange(e >> 1); top.walkCond = (e & 1) === 1;
            continue;
          }
          break;
        }
      }
      if (next < 0) { color[top.node] = BLACK; g.retire(top.node); stack.pop(); continue; }
      if (color[next] === GRAY) {
        report(stack, next, viaRange, viaCond);
        if (cycles.length >= maxCycles) return true;
        continue;
      }
      if (color[next] === WHITE) { color[next] = GRAY; stack.push({ node: next, ci: 0, ri: 0, walk: null, viaRange, viaCond }); }
    }
  }
  return false;
}

module.exports = {
  tokenizeReferences, expandRefs, makeContext, buildRangeGraph, findCyclesInRangeGraph, RangeGraph,
  parseCell, colNum, colName, cellKey, MAX_COL, MAX_ROW,
};
