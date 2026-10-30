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

function textOf(f) {
  const original = f.remedy_check && f.remedy_check.original;
  return [f.condition, f.what_wrong, original || f.fix_instruction || f.corrective_action].map(x => String(x || '')).join(' \n ');
}

// Follow a cell through plain one-cell references. Returns {end:'linked'|'constant'|'calculation'|'unknown'|'empty'|'loop', at}.
function follow(workbook, idx, sheet, col, row, target, hops = 0) {
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
  if (nSheet === target.sheet && nRow === target.row && nCol === col) return { end: 'linked', via: hops };
  return follow(workbook, idx, nSheet, nCol, nRow, target, hops + 1);
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
    if (a.state === 'empty') { rowsWidened.add(c.row); }
    else tests.push({ col: c.col, row: c.row });
  }
  for (const r of rowsWidened) for (const col of dataCells(workbook, idx, target.sheet, r)) tests.push({ col, row: r });
  if (!tests.length) return null;

  const results = tests.map(t => Object.assign({}, t, follow(workbook, idx, target.sheet, t.col, t.row, target)));
  const counts = {};
  for (const r of results) counts[r.end] = (counts[r.end] || 0) + 1;
  const rows = [...new Set(results.map(r => r.row))].sort((a, b) => a - b);
  const cols = results.map(r => r.col);
  const span = `${colName(Math.min(...cols))}:${colName(Math.max(...cols))}`;
  const tag = `${target.sheet} row${rows.length === 1 ? '' : 's'} ${rows.join(', ')}`;
  const widened = rowsWidened.size
    ? ` The finding names column ${colName(cited[0].col)}, which is empty in ${rowsWidened.size === 1 ? 'that row' : 'those rows'}; every populated cell in the row (${span}) was tested instead, against the same column of row ${target.row}.`
    : '';
  const base = { original_record_type: f.record_type, tested: results.length, rows, target: `${target.sheet}!${colName(target.col)}${target.row}`, widened_to_row: rowsWidened.size > 0 };

  if (counts.linked === results.length) {
    return Object.assign(base, {
      status: 'answered_linked',
      evidence: `Checked in the audited file: all ${results.length} populated cell(s) in ${tag} are plain references that lead to the same column of ${rowsWidened.size ? `row ${target.row}` : `row ${target.row} (${target.sheet}!${colName(target.col)}${target.row})`}, none is a typed value or a calculation.${widened}`,
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
    evidence: `Checked in the audited file: ${counts.linked || 0} of ${results.length} cell(s) in ${tag} lead to row ${target.row}; the rest could not be traced through plain references (${Object.entries(counts).filter(([k]) => k !== 'linked').map(([k, v]) => `${v} ${k}`).join(', ')}). The question stays open.${widened}`,
  });
}

/**
 * @param findings  allFlagged, after assignRecordTypes (mutated: only a Query or Critical Query whose question the file answers)
 * @returns {{examined:number, answered:string[], typed:string[], open:string[]}}
 */
function resolveAnswerableQueries(findings, { workbook, cellScoreIndex } = {}) {
  const out = { examined: 0, answered: [], typed: [], open: [] };
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
