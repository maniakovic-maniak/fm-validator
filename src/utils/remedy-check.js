'use strict';
// remedy-check.js - checks a suggested fix before it is published.
//
// An independent review of a licence-model report found two kinds of unsafe remedy:
//   1. a fix that cites a cell the file does not support (the report quoted a formula for AP242 that the supplied
//      workbook does not hold), and
//   2. a fix that misreads a function's arguments (a negative OFFSET rows/columns displacement described as a negative
//      width; a displacement is valid, only a negative height or width is an error),
// plus the general weakness of a fix that only hides an error (wrap it in IFERROR) and leaves its cause in place.
//
// This runs on the findings after all checks and the Tier 2 review, and before the report is built. It never removes a
// finding. When a remedy fails a check, the finding stays, the remedy text is replaced by a short statement of why it
// was withheld, and the original is kept in finding.remedy_check.original so the audit record still holds it.
//
// What it does not do: judge whether a remedy is the best one. It rejects only what the saved workbook contradicts or
// what hides an error. Anything it cannot evaluate is left as written and counted as unverified.

const { findCalls, makeReader, colNum, isNum } = require('./path-checks-common');
const { fullFormula } = require('./formula-store');

// Roles of the arguments of the functions whose misreading was found in review. Position -> role.
const ARG_ROLES = {
  OFFSET: ['reference', 'rows displacement', 'columns displacement', 'height', 'width'],
  INDEX: ['array', 'row number', 'column number', 'area number'],
  MATCH: ['lookup value', 'lookup array', 'match type'],
  VLOOKUP: ['lookup value', 'table', 'column index', 'range lookup'],
  HLOOKUP: ['lookup value', 'table', 'row index', 'range lookup'],
};

const norm = s => String(s || '').replace(/\s+/g, '').replace(/\$/g, '').toUpperCase().replace(/^=/, '');
const clip = (s, n = 160) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

// Cell reference, optionally with a sheet.
const CELL_RE = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d{1,7})\b/g;
const CURRENT_RE = /^\s*(?:[:(=]|(?:currently\s+)?(?:holds|contains|reads|is|has|shows|uses|calculates|returns|gives)\b)/i;
const CHANGE_RE = /\b(change|replace|set|enter|rewrite|amend|update|should|become|re-?point|to)\b/i;

// ---- evaluation of a simple argument from saved values -------------------------------------------------------------
function evalArg(text, sheet, rd) {
  const t = String(text).trim();
  if (t === '') return { known: true, value: 0 };            // an empty argument is zero for a displacement
  let ok = true;
  const body = t.replace(/(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?![\d(])/g, (m, q, u, col, row) => {
    const sh = q ? q.replace(/''/g, "'") : (u || sheet);
    const v = rd.value(sh, +row, colNum(col));
    if (!isNum(v)) { ok = false; return '0'; }
    return '(' + v + ')';
  });
  if (!ok || !/^[0-9eE+\-*/(). ]+$/.test(body)) return { known: false };
  try { const r = Function('"use strict"; return (' + body + ');')(); return typeof r === 'number' && isFinite(r) ? { known: true, value: r } : { known: false }; } catch (_) { return { known: false }; }
}

// OFFSET calls in a formula with each argument's role and, where it can be read from saved values, its value.
function offsetArgs(formula, sheet, rd) {
  return findCalls(formula, 'OFFSET').map(call => ({
    args: call.args.map((a, i) => ({ role: ARG_ROLES.OFFSET[i] || 'extra', text: a.trim(), ...evalArg(i === 0 ? '0' : a, sheet, rd) })),
  }));
}

// ---- what the text of a remedy says --------------------------------------------------------------------------------
const NEG_SIZE_RE = /negative\s+(?:offset\s+)?(?:width|height)|(?:width|height)\s+(?:argument\s+)?(?:is|goes|becomes|can be|of)\s+(?:a\s+)?negative|(?:width|height)\s+of\s+-\d/i;
const SUPPRESS_RE = /\b(wrap|enclose|surround|nest|embed|add|apply|use|put|place)\b[^.;]{0,70}\b(IFERROR|IFNA|ISERROR|ISNA)\b|\b(suppress|hide|mask|silence|swallow|trap)\b[^.;]{0,40}\berrors?\b|\breturn(?:ing|s)?\s+(?:0|zero|blank|an empty (?:string|cell))\s+(?:when|on|if)\b[^.;]{0,30}\berror/i;
const CORRECTIVE_RE = /\b(correct(?:ing)?\s+the\s+(?:cause|key|range|reference|lookup)|root cause|re-?point|replace the (?:reference|range|key)|fix the (?:cause|range|reference|key|lookup|header)|add the missing|extend the (?:range|table|lookup)|align (?:the )?(?:key|header|period|dates?)|so that the lookup (?:finds|matches)|find why|identify why|investigate why|restructure|IF-based|guard(?:s|ing)? (?:the )?(?:division|denominator|divisor)|test (?:the )?(?:denominator|divisor|for zero))\b/i;

// Quoted formulas in a text: backtick spans first; each carries the words that led up to it.
function quotedFormulas(text) {
  const out = [];
  const re = /`([^`]+)`/g; let m;
  while ((m = re.exec(text)) !== null) out.push({ formula: m[1].trim(), start: m.index, end: m.index + m[0].length });
  return out;
}

// Citations of the form `CELL ... <current-wording> <quoted formula>` -> { sheet, cell, quoted, kind: 'current' | 'proposed' }
function citationsWithFormulas(text, defaultSheet) {
  const res = [];
  for (const q of quotedFormulas(text)) {
    const before = text.slice(Math.max(0, q.start - 90), q.start);
    // the nearest cell reference before the quote
    let last = null, m; CELL_RE.lastIndex = 0;
    while ((m = CELL_RE.exec(before)) !== null) last = { m, idx: m.index, len: m[0].length };
    if (!last) continue;
    const between = before.slice(last.idx + last.len);
    if (between.length > 55) continue;
    const kind = CURRENT_RE.test(between) && !CHANGE_RE.test(between.replace(/^\s*(?:currently\s+)?(?:holds|contains|reads|is|has|shows|uses|calculates|returns|gives)\b/i, '')) ? 'current' : 'proposed';
    const sheet = last.m[1] ? last.m[1].replace(/''/g, "'") : (last.m[2] || defaultSheet);
    res.push({ sheet, cell: (last.m[3] + last.m[4]).toUpperCase(), quoted: q.formula, kind });
  }
  return res;
}

// Plain-prose citations: "FinancialStatements!AP35's source formula", "AP42 shows 0". Real remedies rarely quote a
// formula in backticks, so this reads cell citations by the workbook's own sheet names (a name with spaces cannot be
// told apart from a stray word any other way) and keeps only two kinds of claim that the saved file can contradict:
//   formula claim   the text points at the formula in a cell: the cell must hold one
//   value claim     the text says the cell shows/holds a number: the saved value must agree (units m/k/bn allowed)
const UNIT = { k: 1e3, m: 1e6, bn: 1e9 };
const FORMULA_AFTER_RE = /^(?:'s|’s)?\s*(?:\([^)]{0,40}\)\s*)?(?:source |current |underlying |own )?formula\b/i;
const FORMULA_BEFORE_RE = /formulas?\s+(?:in|at|of|for|behind|used in)\s+$/i;
const VALUE_AFTER_RE = /^(?:'s|’s)?\s*(?:\([^)]{0,40}\)\s*)?(?:currently\s+)?(?:shows|holds|reads|is|=|returns|gives|contains|has)\s+(~?)([-−]?)[£$]?(\d[\d,]*\.?\d*)\s*(bn|m|k)?\b(?!\s*%)/i;

function proseCitations(text, workbook) {
  const names = (workbook.worksheets || []).map(w => w.name).filter(Boolean).sort((a, b) => b.length - a.length);
  const out = [];
  if (!names.length) return out;
  const esc = n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:'(${names.map(n => esc(n.replace(/'/g, "''"))).join('|')})'|(${names.map(esc).join('|')}))!\\$?([A-Z]{1,3})\\$?(\\d{1,7})(?![\\d(])`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const sheet = m[1] ? m[1].replace(/''/g, "'") : m[2];
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 90).split(/[.;](?:\s|$)/)[0];
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    let claim = null;
    if (FORMULA_AFTER_RE.test(after) || FORMULA_BEFORE_RE.test(before)) claim = { type: 'formula' };
    else {
      const v = VALUE_AFTER_RE.exec(after);
      if (v && !/^\s*formula/i.test(after.slice(v[0].length))) {
        const dec = (v[3].split('.')[1] || '').length;
        claim = { type: 'value', expected: (v[2] ? -1 : 1) * parseFloat(v[3].replace(/,/g, '')), unit: UNIT[(v[4] || '').toLowerCase()] || 1, decimals: dec };
      }
    }
    if (claim) out.push({ sheet, cell: (m[3] + m[4]).toUpperCase(), row: +m[4], col: colNum(m[3]), ...claim });
  }
  return out;
}

// Does a saved value agree with a number quoted from a remedy? The model may hold pounds where the text says millions.
function valueAgrees(actual, c) {
  const target = c.expected * c.unit;
  const tol = Math.max(0.05 * Math.abs(target), 0.5 * c.unit / Math.pow(10, c.decimals));
  return [1, 1e3, 1e6, 1e-3, 1e-6].some(sc => Math.abs(actual * sc - target) <= tol);
}

function actualFormula(workbook, cellScoreIndex, sheet, cell) {
  const ws = workbook.getWorksheet(sheet);
  if (!ws) return { state: 'no_sheet' };
  const key = `${sheet}!${cell}`;
  const info = cellScoreIndex && cellScoreIndex[key];
  if (info) return { state: 'formula', formula: fullFormula(cellScoreIndex, key, info) || info.formulaText };
  const c = ws.findCell(cell);
  if (!c) return { state: 'empty' };
  const v = c.value;
  if (v && typeof v === 'object' && typeof v.formula === 'string') return { state: 'formula', formula: v.formula };
  if (v && typeof v === 'object' && v.sharedFormula) return { state: 'formula', formula: undefined };   // shared formula: text not held on this cell
  if (v === null || v === undefined || v === '') return { state: 'empty' };
  return { state: 'constant', value: v };
}

// ---- the check ------------------------------------------------------------------------------------------------------
function checkOne(f, workbook, cellScoreIndex, rd) {
  const remedy = String(f.fix_instruction || f.corrective_action || '');
  if (!remedy.trim()) return { status: 'not_checked', reasons: [] };
  const sheet = f.sheet || '';
  const reasons = [];
  let evaluated = false;
  const loc = sheet && f.cell ? `${sheet}!${f.cell}` : (f.cell || 'the cell');

  // 1. Cited cells that carry a quoted current formula must hold it.
  for (const c of citationsWithFormulas(remedy, sheet)) {
    if (c.kind !== 'current' || /…|\.\.\./.test(c.quoted)) continue;
    const a = actualFormula(workbook, cellScoreIndex, c.sheet, c.cell);
    evaluated = true;
    if (a.state === 'no_sheet') reasons.push({ type: 'citation', text: `the remedy cites ${c.sheet}!${c.cell}, but the file has no sheet "${c.sheet}"` });
    else if (a.state === 'empty') reasons.push({ type: 'citation', text: `the remedy says ${c.sheet}!${c.cell} holds ${clip(c.quoted)}, but that cell is empty in the audited file` });
    else if (a.state === 'constant') reasons.push({ type: 'citation', text: `the remedy says ${c.sheet}!${c.cell} holds the formula ${clip(c.quoted)}, but that cell holds the value ${clip(String(a.value), 40)}` });
    else if (a.formula && norm(a.formula) !== norm(c.quoted)) reasons.push({ type: 'citation', text: `the remedy says ${c.sheet}!${c.cell} holds ${clip(c.quoted)}, but the audited file holds ${clip(a.formula)}` });
  }

  // 1b. Cell citations written in ordinary prose: a pointer at "the formula" in a cell that holds none, or a quoted
  // number the saved value does not support.
  for (const c of proseCitations(remedy, workbook)) {
    if (c.type === 'formula') {
      const a = actualFormula(workbook, cellScoreIndex, c.sheet, c.cell);
      evaluated = true;
      if (a.state === 'empty') reasons.push({ type: 'citation', text: `the remedy points at the formula in ${c.sheet}!${c.cell}, but that cell is empty in the audited file` });
      else if (a.state === 'constant') reasons.push({ type: 'citation', text: `the remedy points at the formula in ${c.sheet}!${c.cell}, but that cell holds the value ${clip(String(a.value), 40)} and no formula` });
    } else {
      const v = rd.value(c.sheet, c.row, c.col);
      if (!isNum(v)) continue;
      evaluated = true;
      if (!valueAgrees(v, c)) reasons.push({ type: 'citation', text: `the remedy says ${c.sheet}!${c.cell} shows ${clip(String(c.expected), 20)}${Object.keys(UNIT).find(k => UNIT[k] === c.unit) || ''}, but the saved value is ${clip(String(v), 20)}` });
    }
  }

  // 2. Argument roles: a "negative width/height" claim must be true of a height or width argument.
  const claimText = `${f.condition || ''} ${remedy}`;
  if (NEG_SIZE_RE.test(claimText)) {
    const targets = [];
    for (const c of citationsWithFormulas(remedy, sheet)) if (c.kind === 'current') { const a = actualFormula(workbook, cellScoreIndex, c.sheet, c.cell); if (a.state === 'formula') targets.push({ sheet: c.sheet, formula: a.formula }); }
    if (f.cell) { const a = actualFormula(workbook, cellScoreIndex, sheet, String(f.cell).toUpperCase()); if (a.state === 'formula') targets.push({ sheet, formula: a.formula }); }
    for (const t of targets) {
      const calls = offsetArgs(t.formula, t.sheet, rd);
      if (!calls.length) continue;
      evaluated = true;
      const sizeNeg = calls.some(c => c.args.some(a => (a.role === 'height' || a.role === 'width') && a.known && a.value < 0));
      const dispNeg = calls.some(c => c.args.some(a => /displacement/.test(a.role) && (!a.known || a.value < 0)));
      const sizeUnknown = calls.some(c => c.args.some(a => (a.role === 'height' || a.role === 'width') && !a.known));
      if (!sizeNeg && !sizeUnknown && dispNeg) reasons.push({ type: 'argument_role', text: 'the remedy describes a negative OFFSET width or height, but the negative value in this formula is a rows or columns displacement. A negative displacement moves the reference up or left and is valid; only a negative height or width is an error' });
      else if (!sizeNeg && !sizeUnknown && !dispNeg) reasons.push({ type: 'argument_role', text: 'the remedy describes a negative OFFSET width or height, but no height or width argument in this formula is negative in the saved values' });
    }
  }

  // 3. A remedy whose only action is to hide the error.
  const affirmative = remedy.replace(/\b(?:do not|don't|never|avoid|without|instead of|rather than)\b[^.;]{0,60}/gi, ' ');
  if (SUPPRESS_RE.test(affirmative) && !CORRECTIVE_RE.test(remedy)) {
    evaluated = true;
    reasons.push({ type: 'suppression', text: 'the remedy would wrap the formula so the error no longer shows, which leaves the cause in place' });
  } else {
    for (const q of quotedFormulas(remedy)) {
      const body = q.formula.replace(/^=/, '').trim();
      const outer = /^(IFERROR|IFNA)\s*\(/i.exec(body);
      if (!outer) continue;
      const call = findCalls(body, outer[1])[0];
      if (call && call.end === body.length && call.args.length === 2 && /^(?:0|""|0\.0+|NA\(\))$/.test(call.args[1].trim()) && /#N\/A|#REF|#VALUE|#DIV|error|lookup/i.test(`${f.condition || ''} ${f.root_cause || ''}`) && !CORRECTIVE_RE.test(remedy)) {
        evaluated = true;
        reasons.push({ type: 'suppression', text: `the proposed formula ${clip(q.formula, 80)} returns a constant when the inner formula fails, which hides the error without correcting its cause` });
      }
    }
  }

  void loc;
  if (reasons.length) return { status: 'withheld', reasons };
  return { status: evaluated ? 'verified' : 'unverified', reasons: [] };
}

function replacement(f, reasons) {
  const where = f.sheet && f.cell ? `${f.sheet}!${f.cell}` : (f.cell || 'this cell');
  const why = reasons.map(r => r.text).join('; and ');
  const kinds = new Set(reasons.map(r => r.type));
  const next = kinds.has('suppression') ? ` Find why ${where} produces the error and correct that cause; do not hide the result.`
    : kinds.has('citation') ? ` Re-read the cell in the audited file before changing it.`
      : ' Re-read the formula in the audited file and take the arguments in their actual roles.';
  return `Remedy withheld by the automated remedy check: ${why}.${next}`;
}

/**
 * @param findings  allFlagged (mutated in place: only the remedy text of a finding that fails a check)
 * @param ctx { workbook, cellScoreIndex }
 * @returns {{checked:number, verified:number, withheld:number, unverified:number, details:Array}}
 */
function applyRemedyChecks(findings, { workbook, cellScoreIndex } = {}) {
  const out = { checked: 0, verified: 0, withheld: 0, unverified: 0, details: [] };
  if (!workbook || !Array.isArray(findings)) return out;
  const rd = makeReader(workbook);
  for (const f of findings) {
    if (!f || f.remedy_check) continue;
    let r;
    try { r = checkOne(f, workbook, cellScoreIndex || {}, rd); } catch (e) { r = { status: 'unverified', reasons: [], error: e.message }; }
    if (r.status === 'not_checked') continue;
    out.checked++;
    if (r.status === 'withheld') {
      const original = f.fix_instruction || f.corrective_action;
      const text = replacement(f, r.reasons);
      f.remedy_check = { status: 'withheld', reasons: r.reasons.map(x => x.text), original };
      f.corrective_action = text;
      f.fix_instruction = text;
      f.fixable = false;
      out.withheld++;
      out.details.push({ id: f.id, sheet: f.sheet, cell: f.cell, reasons: r.reasons.map(x => x.type) });
    } else if (r.status === 'verified') { f.remedy_check = { status: 'verified' }; out.verified++; }
    else { f.remedy_check = { status: 'unverified' }; out.unverified++; }
  }
  return out;
}

module.exports = { applyRemedyChecks, checkOne, proseCitations, valueAgrees, citationsWithFormulas, offsetArgs, ARG_ROLES, NEG_SIZE_RE, SUPPRESS_RE };
