'use strict';
// nested-subtotal-check.js - a SUM whose range contains both a subtotal and the cells that subtotal already adds up.
//
// Found by an independent review of a licence model: FinRatios RoRE decomposition!AP38 =SUM(AP10:AP37) covers rows
// 10:19 and also row 20, which is =SUM(AP10:AP19). Rows 10:19 are counted twice: AP38 showed 239.45 against -4.71
// without the repeat, and -4.71 is what the financial statements say. The model labelled nothing as a subtotal, so a
// label-based test could not see it. This test needs no labels: it looks only at the formulas.
//
// Handles the plain case, a cell whose whole formula is SUM(A:B) on one column or one row. Anything more elaborate
// (multi-area sums, cross-sheet sums) is skipped rather than guessed at. Findings are grouped by (sheet, outer row,
// inner row) so a defect repeated across 60 period columns is one finding with a column count.

const SUM_RE = /^\s*=?\s*SUM\s*\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)\s*$/i;
const MAX_SUMS_PER_LINE = 400;

function colNum(c) { let n = 0; for (const ch of c.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function colName(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function numResult(cell) {
  const v = cell.value;
  const r = v && typeof v === 'object' && 'result' in v ? v.result : v;
  return typeof r === 'number' && isFinite(r) ? r : null;
}

function checkNestedSubtotals(workbook) {
  const groups = new Map();      // "sheet|outerRow|innerRow|axis" -> finding
  let sumsSeen = 0;

  workbook.eachSheet(ws => {
    // per-line lists of simple SUM cells: key "C:<col>" (vertical) or "R:<row>" (horizontal)
    const lines = new Map();
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colN) => {
        const f = cell.formula || (cell.value && cell.value.formula);
        if (!f) return;
        const m = SUM_RE.exec(String(f));
        if (!m) return;
        const c1 = colNum(m[1]), r1 = +m[2], c2 = colNum(m[3]), r2 = +m[4];
        let key, pos, lo, hi;
        if (c1 === c2 && r1 !== r2 && c1 === colN) { key = 'C:' + colN; pos = rowNum; lo = Math.min(r1, r2); hi = Math.max(r1, r2); }
        else if (r1 === r2 && c1 !== c2 && r1 === rowNum) { key = 'R:' + rowNum; pos = colN; lo = Math.min(c1, c2); hi = Math.max(c1, c2); }
        else return;
        if (!lines.has(key)) lines.set(key, []);
        lines.get(key).push({ pos, lo, hi, cell, formula: String(f).trim().replace(/^=/, '') });
        sumsSeen++;
      });
    });

    for (const [key, list] of lines) {
      if (list.length < 2 || list.length > MAX_SUMS_PER_LINE) continue;
      const vertical = key[0] === 'C';
      for (const outer of list) {
        for (const inner of list) {
          if (inner === outer) continue;
          if (inner.pos < outer.lo || inner.pos > outer.hi) continue;         // inner total sits inside the outer range
          if (inner.lo < outer.lo || inner.hi > outer.hi) continue;            // and so does everything it adds up
          if (inner.hi - inner.lo < 1) continue;                               // a one-cell "sum" is not a subtotal
          if (inner.pos >= inner.lo && inner.pos <= inner.hi) continue;        // the inner sum includes itself: a different problem
          if (inner.lo === outer.lo && inner.hi === outer.hi) continue;
          const g = `${ws.name}|${outer.pos}|${inner.pos}|${vertical ? 'v' : 'h'}`;
          let entry = groups.get(g);
          if (!entry) {
            entry = {
              sheet: ws.name, axis: vertical ? 'column' : 'row',
              outerPos: outer.pos, innerPos: inner.pos, instances: [],
            };
            groups.set(g, entry);
          }
          const ov = numResult(outer.cell), iv = numResult(inner.cell);
          entry.instances.push({
            cell: outer.cell.address, innerCell: inner.cell.address,
            outerFormula: outer.formula, innerFormula: inner.formula,
            outerValue: ov, innerValue: iv, withoutRepeat: ov !== null && iv !== null ? ov - iv : null,
          });
        }
      }
    }
  });

  const findings = [];
  for (const e of groups.values()) {
    const first = e.instances[0];
    const where = e.axis === 'column' ? `row ${e.outerPos} (adds up row ${e.innerPos}, itself a SUM, as well as the rows that SUM covers)` : `column ${colName(e.outerPos)}`;
    const effect = first.withoutRepeat !== null
      ? ` In ${first.cell} the cached value is ${first.outerValue} and ${first.withoutRepeat} without the repeated subtotal (${first.innerCell} = ${first.innerValue}).`
      : '';
    findings.push({
      sheet: e.sheet, cell: first.cell, innerCell: first.innerCell,
      instanceCount: e.instances.length, instances: e.instances,
      cells: e.instances.map(i => i.cell),
      note: `${e.sheet}!${first.cell} (=${first.outerFormula}) covers ${first.innerCell} (=${first.innerFormula}) and also the cells that formula already adds up, so those cells are counted twice. Seen in ${e.instances.length} ${e.axis === 'column' ? 'column' : 'row'}(s) of ${where}.${effect}`,
    });
  }
  findings.sort((a, b) => b.instanceCount - a.instanceCount);

  return {
    applicable: sumsSeen > 0,
    flaggedCount: findings.length,
    sumFormulasSeen: sumsSeen,
    findings,
    note: 'Flags a plain SUM(range) whose range contains another plain SUM cell together with all the cells that SUM adds up, so those cells are counted twice. Needs no row labels. A SUM over a block that holds subtotals on purpose, divided back down elsewhere, would also match; review each. Multi-area, cross-sheet and non-SUM totals are not examined.',
  };
}

module.exports = { checkNestedSubtotals };
