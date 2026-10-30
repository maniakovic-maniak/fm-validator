'use strict';
// double-scaling-check.js - the same scaling factor applied twice along a calculation chain.
//
// Found by an independent review of a licence model and confirmed on the workbook: OutputSummary AP125 and AP126 are
// =FinancialRatios!AP110/ESOpf and =FinancialRatios!AP111/ESOpf (already in 18/19 prices). AP127 then reads
// =(AP125+AP126)/ESOpf, which divides by the price index a second time (-4.13 shown, -4.41 correct), and AP128 reads
// =(-AP125/AP126)/ESOpf, which deflates a ratio of two figures that are already deflated.
//
// Needs no labels. A cell is "scaled" when its whole formula is <operand> / NAME or <operand> * NAME, where NAME is a
// named range or other identifier (not a cell address, not a function) and <operand> is one reference or one fully
// bracketed expression. A scaled cell is reported when an input it reads is itself scaled by the same NAME with the same
// operator. Mixed operators (a divide followed by the matching multiply) are a conversion back, not a repeat, and are
// not reported. Anything not of that exact shape is skipped rather than guessed at.
// Cost: one pass over the formula cells, keeping only the scaled ones (a few thousand at most), so it is safe on the
// shared host. Findings are grouped by (sheet, row, name) so a defect copied across 60 periods is one finding.

const FUNC_OR_LITERAL = /^(TRUE|FALSE|NA|PI|ROW|COLUMN|NOW|TODAY|RAND)$/i;
const CELL_ADDR = /^\$?[A-Z]{1,3}\$?\d+$/i;
const MAX_INSTANCES = 500;

function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function numResult(cell) {
  const v = cell.value;
  // cell.result also returns a saved 0, which ExcelJS leaves out of cell.value for a formula
  const r = v && typeof v === 'object' && typeof v.formula === 'string' ? cell.result : (v && typeof v === 'object' && 'result' in v ? v.result : v);
  return typeof r === 'number' && isFinite(r) ? r : null;
}
const norm = s => String(s).replace(/\s+/g, '');

// True when the text is one operand: a single (optionally negated, optionally sheet-qualified) reference, or one
// expression whose first bracket closes at the very end.
function isWholeOperand(body) {
  const b = body.trim();
  if (!b) return false;
  if (/^-?\s*(?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?[A-Z]{1,3}\$?\d+$/.test(b)) return true;
  const t = b.replace(/^-\s*/, '');
  if (t[0] !== '(') return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') depth++;
    else if (t[i] === ')') { depth--; if (depth === 0 && i < t.length - 1) return false; }
    if (depth < 0) return false;
  }
  return depth === 0;
}

// -> { op, name, body } or null
function parseScaled(formula) {
  const f = String(formula || '').trim().replace(/^=/, '');
  if (!f || f.length > 400) return null;
  const m = /^([\s\S]+?)\s*([\/*])\s*([A-Za-z_][A-Za-z0-9_.]*)\s*$/.exec(f);
  if (!m) return null;
  const name = m[3];
  if (CELL_ADDR.test(name) || FUNC_OR_LITERAL.test(name)) return null;
  const body = m[1];
  if (/[\/*]\s*$/.test(body)) return null;
  if (!isWholeOperand(body)) return null;
  return { op: m[2], name, body: body.trim() };
}

const REF_RE = /((?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(\$?[A-Z]{1,3}\$?\d+)(?![\d(])/g;
function refsIn(body, ownSheet) {
  const out = [];
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(body)) !== null) {
    const before = body[m.index - 1];
    const after = body[m.index + m[0].length];
    if (before === ':' || after === ':') continue;                    // part of a range: not a single input
    if (!m[1] && before && /[A-Za-z0-9_.!]/.test(before)) continue;    // tail of a longer identifier
    let sheet = ownSheet;
    if (m[1]) sheet = m[1].slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'");
    out.push({ sheet, addr: m[2].replace(/\$/g, '').toUpperCase() });
  }
  return out;
}

// Evaluate the inputs of a scaled cell with their saved values: <body> with each reference replaced by its number.
// Only digits, operators, brackets and decimal points may remain, so nothing else is ever executed.
function evalBody(body, ownSheet, workbook) {
  let ok = true;
  const text = String(body).replace(/((?:'[^']+'|[A-Za-z_][A-Za-z0-9_.]*)!)?\$?([A-Z]{1,3})\$?(\d+)(?![\d(])/g, (m, sh, col, row) => {
    const sheet = sh ? sh.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : ownSheet;
    const ws = workbook.getWorksheet(sheet);
    const c = ws && ws.findCell(+row, col.split('').reduce((a2, ch) => a2 * 26 + ch.charCodeAt(0) - 64, 0));
    const v = c ? numResult(c) : null;
    if (v === null) { ok = false; return '0'; }
    return '(' + v + ')';
  });
  if (!ok || !/^[0-9eE+\-*/(). ]+$/.test(text)) return null;
  try { const r = Function('"use strict"; return (' + text + ');')(); return typeof r === 'number' && isFinite(r) ? r : null; } catch (_) { return null; }
}

function checkDoubleScaling(workbook) {
  const scaled = new Map();   // "sheet!ADDR" -> { op, name, body, cell }
  let formulaCells = 0;

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const f = cell.formula || (cell.value && cell.value.formula);
        if (!f) return;
        formulaCells++;
        const p = parseScaled(f);
        if (p) scaled.set(`${ws.name}!${cell.address}`, { ...p, cell, sheet: ws.name, formula: String(f).trim().replace(/^=/, '') });
      });
    });
  });

  const groups = new Map();
  for (const [key, s] of scaled) {
    const inputs = refsIn(s.body, s.sheet).map(r => ({ r, up: scaled.get(`${r.sheet}!${r.addr}`) }))
      .filter(x => x.up && x.up.name.toLowerCase() === s.name.toLowerCase() && x.up.op === s.op);
    if (inputs.length === 0) continue;
    const row = +/\d+$/.exec(s.cell.address)[0];
    const g = `${s.sheet}|${row}|${s.name.toLowerCase()}|${s.op}`;
    let e = groups.get(g);
    if (!e) { e = { sheet: s.sheet, row, name: s.name, op: s.op, instances: [] }; groups.set(g, e); }
    if (e.instances.length >= MAX_INSTANCES) { e.truncated = true; continue; }
    const firstIn = inputs[0];
    const ratio = inputs.length >= 2 && /\//.test(s.body.replace(/^-\s*/, ''));
    const expected = evalBody(s.body, s.sheet, workbook);          // the value with the factor applied once (or, for a ratio, not at all)
    e.instances.push({
      cell: s.cell.address, formula: s.formula, value: numResult(s.cell), ratio, expected,
      inputs: inputs.map(x => ({ ref: `${x.r.sheet === s.sheet ? '' : x.r.sheet + '!'}${x.r.addr}`, formula: x.up.formula, value: numResult(x.up.cell) })),
      firstInput: firstIn.r.addr,
    });
  }

  const findings = [];
  for (const e of groups.values()) {
    const first = e.instances[0];
    const verb = e.op === '/' ? 'divided' : 'multiplied';
    const inputList = first.inputs.map(i => `${i.ref} (=${i.formula}${i.value !== null ? `, ${Math.round(i.value * 1000) / 1000}` : ''})`).join(' and ');
    const q = (first.expected !== null && first.value !== null) ? { reported: first.value, expected: first.expected, difference: first.value - first.expected, kind: first.ratio ? 'ratio (should not be scaled at all)' : 'amount (scaled once is correct)', basis: 'saved values of the inputs' } : null;
    const qNote = q ? ` With ${e.name} applied ${first.ratio ? 'to neither side' : 'once'}, ${first.cell} would be ${Math.round(q.expected * 1e4) / 1e4} against ${Math.round(q.reported * 1e4) / 1e4} reported (a difference of ${Math.round(q.difference * 1e4) / 1e4}).` : '';
    const ratioNote = first.ratio ? ` The result is a ratio of two figures that are both already scaled, so it is unit-free and should not be scaled by ${e.name} at all.` : '';
    findings.push({
      sheet: e.sheet, cell: first.cell, name: e.name, op: e.op, row: e.row,
      instanceCount: e.instances.length, instances: e.instances, cells: e.instances.map(i => i.cell),
      ratio: first.ratio, quantification: q,
      note: `${e.sheet}!${first.cell} (=${first.formula}) is ${verb} by ${e.name} but its input${first.inputs.length > 1 ? 's are' : ' is'} already ${verb} by ${e.name}: ${inputList}. The factor is applied twice.${ratioNote}${first.value !== null ? ` Cached value of ${first.cell}: ${Math.round(first.value * 1000) / 1000}.` : ''}${qNote}`,
    });
  }
  findings.sort((a, b) => b.instanceCount - a.instanceCount);

  return {
    applicable: scaled.size > 0,
    flaggedCount: findings.length,
    scaledCellsSeen: scaled.size, formulaCellsSeen: formulaCells,
    findings,
    note: 'Flags a cell whose whole formula is <operand> / NAME (or * NAME) when an input it reads is already divided (multiplied) by the same NAME. Needs no row labels. A divide followed by the matching multiply is a conversion back and is not flagged. Formulas of any other shape are skipped.',
  };
}

module.exports = { checkDoubleScaling, parseScaled, refsIn, isWholeOperand };
