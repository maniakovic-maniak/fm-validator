'use strict';
// query-resolver.js - answers a reviewer's open question when the saved file already answers it.
//
// An ESO run (Fm-00054) produced one Critical Query, and it was the main reason the report said "unresolved Critical
// Query". The reviewer asked the person to "confirm that SystemOperator!I165, I653, I694 and I724 are formula
// references to I78, not independently typed values". The file answers that: those rows hold =AP78, =AQ78 ... and row
// 724 holds =AP653 (which is =AP78). The reviewer also named column I, which is empty in those rows; the values sit in
// the period columns.
//
// Scope is deliberately narrow. Only one question shape is answered: "confirm that these cells are references to that
// cell". The answer is positive only if EVERY populated period cell in the cited rows traces, through plain
// one-cell references, to the same column of the target row. A single typed value, calculation, or formula whose text
// is not held leaves the question open. When the answer is positive the record becomes a False Positive (the concern
// was investigated and disproved), the original record type is kept on the finding, and the evidence is written on it.
// Nothing is dropped from the Issue Log.

const { actualFormula, cellListCitations } = require('./remedy-check');
const { colName, colNum } = require('./path-checks-common');

const QUESTION_RE = /\bconfirm\b[^.]{0,160}?\b(?:are|is)\s+(?:all\s+)?(?:formula\s+)?(?:references?|links?|linked)\s+to\s+(?:(?:'([^']+)'|([A-Za-z0-9_.]+))!)?\$?([A-Z]{1,3})\$?(\d{1,7})\b/i;
const SIMPLE_REF_RE = /^=?\s*(?:(?:'([^']+)'|([A-Za-z0-9_.]+))!)?\$?([A-Z]{1,3})\$?(\d{1,7})\s*$/;
const MAX_HOPS = 8;

// Is the reference question the whole of this finding? A finding that also asks for something else (reconcile a value,
// confirm a second thing) is only part answered when the file settles the reference question.
const CONCERN_WORDS_RE = /\b(differs?|different|inconsisten\w*|mismatch\w*|wrong|incorrect|exceed\w*|does not (?:match|equal|reconcile)|do not (?:match|equal|reconcile)|overstat\w*|understat\w*|reconcile|verify|check that|compare|test)\b/i;
function otherConcerns(f, text) {
  const out = [];
  const fix = String((f.remedy_check && f.remedy_check.original) || f.fix_instruction || f.corrective_action || '');
  const sentences = fix.split(/(?<=[.;])\s+/).map(x => x.trim()).filter(x => x.length > 3);
  const q = sentences.findIndex(x => QUESTION_RE.test(x));
  sentences.forEach((x, i) => { if (i !== q) out.push(x); });
  if (q >= 0) {
    const tail = sentences[q].replace(QUESTION_RE, '').replace(/\([^)]*\)/g, '').replace(/^[\s,.;]*(?:and\s+)?(?:that\s+)?(?:they\s+are\s+)?not\s+(?:independently\s+)?(?:typed|hard-?coded|re-?entered)[\w\s]*[.;]?\s*$/i, '').replace(/[\s.;,]+$/, '');
    if (tail.length > 3) out.push(tail);
  }
  const cond = String(f.condition || f.what_wrong || '');
  const m = CONCERN_WORDS_RE.exec(cond);
  if (m) out.push(`finding text says "${m[0]}"`);
  return out;
}

function textOf(f) {
  const original = f.remedy_check && f.remedy_check.original;
  return [f.condition, f.what_wrong, original || f.fix_instruction || f.corrective_action].map(x => String(x || '')).join(' \n ');
}

// Follow a cell through plain one-cell references. Returns {end:'linked'|'constant'|'calculation'|'unknown'|'empty'|'loop', at}.
function follow(workbook, idx, sheet, col, row, expect, hops = 0) {
  if (hops > MAX_HOPS) return { end: 'loop', at: `${sheet}!${colName(col)}${row}` };
  const a = actualFormula(workbook, idx, sheet, colName(col) + row);
  const here = `${sheet}!${colName(col)}${row}`;
  if (a.state === 'empty' || a.state === 'no_sheet') return { end: 'empty', at: here };
  if (a.state === 'constant') return { end: 'constant', at: here };
  if (!a.formula) return { end: 'unknown', at: here };
  const m = SIMPLE_REF_RE.exec(String(a.formula).trim());
  if (!m) return { end: 'calculation', at: here };
  const nSheet = m[1] || m[2] || sheet;
  const nCol = colNum(m[3]), nRow = +m[4];
  // The destination is fixed for the whole trace. It is NOT the column of the cell currently being read: a chain that
  // wanders sideways (B2 -> C3 -> C1) must not be accepted as a reference to B1 because C1 sits in C3's column.
  if (nSheet === expect.sheet && nRow === expect.row && nCol === expect.col) return { end: 'linked', via: hops };
  return follow(workbook, idx, nSheet, nCol, nRow, expect, hops + 1);
}

// Populated numeric or formula cells in one row of one sheet (labels and units are text and are skipped).
function dataCells(workbook, idx, sheet, row) {
  const ws = workbook.getWorksheet(sheet);
  const out = [];
  if (!ws) return out;
  ws.getRow(row).eachCell({ includeEmpty: false }, (cell, col) => {
    const a = actualFormula(workbook, idx, sheet, colName(col) + row);
    if (a.state === 'formula' || (a.state === 'constant' && typeof a.value === 'number')) out.push(col);
  });
  return out;
}

function resolveOne(f, workbook, idx) {
  if (!f || !/^T2-/.test(String(f.id || ''))) return null;
  if (f.record_type !== 'Query' && f.record_type !== 'Critical Query') return null;
  const text = textOf(f);
  const q = QUESTION_RE.exec(text);
  if (!q) return null;
  const target = { sheet: q[1] || q[2] || f.sheet, col: colNum(q[3]), row: +q[4] };
  if (!workbook.getWorksheet(target.sheet)) return null;
  const lists = cellListCitations(text, workbook).filter(L => L.sheet === target.sheet);
  const cited = [];
  for (const L of lists) for (const c of L.cells) {
    const m = /^([A-Z]+)(\d+)$/.exec(c);
    if (m && !(colNum(m[1]) === target.col && +m[2] === target.row)) cited.push({ col: colNum(m[1]), row: +m[2] });
  }
  if (!cited.length) return null;

  // Test the exact cells cited when they hold something; when a cited cell is empty, the reviewer named the wrong
  // column, and the whole row is tested against the same column of the target row.
  const tests = [];
  const rowsWidened = new Set();
  for (const c of cited) {
    const a = actualFormula(workbook, idx, target.sheet, colName(c.col) + c.row);
    if (a.state === 'empty') rowsWidened.add(c.row);
    else tests.push({ col: c.col, row: c.row, expect: { sheet: target.sheet, row: target.row, col: target.col } });   // exact cell asserted
  }
  for (const r of rowsWidened) {
    const cols = dataCells(workbook, idx, target.sheet, r);
    // A cited row with nothing in it stays in the population as a failed test: it cannot be shown to be a reference.
    if (!cols.length) tests.push({ col: null, row: r, emptyRow: true });
    // Period-aligned assertion: each populated cell must lead to the same column of the target row.
    for (const col of cols) tests.push({ col, row: r, expect: { sheet: target.sheet, row: target.row, col } });
  }
  if (!tests.length) return null;

  const results = tests.map(t => t.emptyRow
    ? Object.assign({}, t, { end: 'empty', at: `${target.sheet} row ${t.row} (no populated cell)` })
    : Object.assign({}, t, follow(workbook, idx, target.sheet, t.col, t.row, t.expect)));
  const counts = {};
  for (const r of results) counts[r.end] = (counts[r.end] || 0) + 1;
  const rows = [...new Set(results.map(r => r.row))].sort((a, b) => a - b);
  const cols = results.map(r => r.col).filter(c => c !== null);
  const span = cols.length ? `${colName(Math.min(...cols))}:${colName(Math.max(...cols))}` : 'none';
  const tag = `${target.sheet} row${rows.length === 1 ? '' : 's'} ${rows.join(', ')}`;
  const widened = rowsWidened.size
    ? ` The finding names column ${colName(cited[0].col)}, which is empty in ${rowsWidened.size === 1 ? 'that row' : 'those rows'}; every populated cell in the row (${span}) was tested instead, against the same column of row ${target.row}.`
    : '';
  const extra = otherConcerns(f, text);
  const base = { other_concerns: extra, original_record_type: f.record_type, tested: results.length, rows, target: `${target.sheet}!${colName(target.col)}${target.row}`, widened_to_row: rowsWidened.size > 0 };

  if (counts.linked === results.length) {
    return Object.assign(base, {
      status: extra.length ? 'part_answered' : 'answered_linked',
      evidence: `Checked in the audited file: all ${results.length} populated cell(s) in ${tag} are plain references that lead to the same column of ${rowsWidened.size ? `row ${target.row}` : `row ${target.row} (${target.sheet}!${colName(target.col)}${target.row})`}, none is a typed value or a calculation.${widened}${extra.length ? ` The finding raises more than this question (${extra.slice(0, 2).map(x => JSON.stringify(x.length > 90 ? x.slice(0, 89) + '…' : x)).join('; ')}), and the file does not answer that part, so the record is not closed.` : ''}`,
    });
  }
  const typed = results.filter(r => r.end === 'constant');
  if (typed.length) {
    return Object.assign(base, {
      status: 'typed_value_found',
      cells: typed.slice(0, 8).map(r => r.at),
      evidence: `Checked in the audited file: ${typed.length} of ${results.length} cell(s) in ${tag} lead to a typed value instead of row ${target.row} (${typed.slice(0, 5).map(r => r.at).join(', ')}${typed.length > 5 ? ', ...' : ''}).${widened}`,
    });
  }
  return Object.assign(base, {
    status: 'not_answered',
    evidence: `Checked in the audited file: ${counts.linked || 0} of ${results.length} cell(s) in ${tag} lead to row ${target.row}; the rest could not be traced through plain references (${Object.entries(counts).filter(([k]) => k !== 'linked').map(([k, v]) => `${v} ${k}`).join(', ')}). ${results.some(r => r.emptyRow) ? ` Cited row${results.filter(r => r.emptyRow).length === 1 ? '' : 's'} with no populated cell: ${results.filter(r => r.emptyRow).map(r => r.row).join(', ')} (no populated cell, so nothing there can be shown to be a reference).` : ''} The question stays open.${widened}`,
  });
}

/**
 * @param findings  allFlagged, after assignRecordTypes (mutated: only a Query or Critical Query whose question the file answers)
 * @returns {{examined:number, answered:string[], partial:string[], typed:string[], open:string[]}}
 */
function resolveAnswerableQueries(findings, { workbook, cellScoreIndex } = {}) {
  const out = { examined: 0, answered: [], partial: [], typed: [], open: [] };
  if (!workbook || !Array.isArray(findings)) return out;
  for (const f of findings) {
    let r = null;
    try { r = resolveOne(f, workbook, cellScoreIndex || {}); } catch (e) { r = null; }
    if (!r) continue;
    out.examined++;
    f.query_resolution = r;
    if (r.status === 'answered_linked') {
      f.record_type = 'False Positive';
      f.record_type_note = `Query answered by the file. ${r.evidence} Original record type: ${r.original_record_type}.`;
      out.answered.push(f.id);
    } else if (r.status === 'part_answered') {
      f.record_type_note = `${f.record_type_note ? f.record_type_note + ' ' : ''}Part of this query is answered by the file. ${r.evidence}`;
      out.partial.push(f.id);
    } else if (r.status === 'typed_value_found') {
      f.record_type_note = `${f.record_type_note ? f.record_type_note + ' ' : ''}${r.evidence}`;
      out.typed.push(f.id);
    } else {
      f.record_type_note = `${f.record_type_note ? f.record_type_note + ' ' : ''}${r.evidence}`;
      out.open.push(f.id);
    }
  }
  return out;
}

module.exports = { resolveAnswerableQueries, resolveOne, QUESTION_RE };
