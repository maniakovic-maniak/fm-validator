// Redundant input detection (V11 §2) — deterministic, zero API cost.
//
// A redundant input is a constant numeric value on an input/assumption sheet
// that no formula anywhere in the workbook references. Such assumptions give
// the impression of driving the model while affecting nothing — corrupting
// scenario analysis and the user's sense of control.
//
// Method: static reference analysis. Every formula's sheet-qualified
// references (cells, ranges, whole columns/rows), same-sheet references for
// formulas living on input sheets, and defined-name usages (resolved to their
// target ranges) build a "referenced set". Numeric constants on input sheets
// outside that set are reported.
//
// KNOWN LIMITATION (disclosed in output): references constructed dynamically
// via OFFSET/INDIRECT windows cannot be traced statically — in models with
// heavy OFFSET use, some reported cells may be consumed dynamically. Findings
// are therefore framed as "not referenced by any static formula reference".

const { findNearbyLabel } = require('./cell-label');

const COL_RE = /^[A-Z]{1,3}$/;

function colToNum(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseAddr(addr) {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})$/.exec(addr);
  return m ? { c: colToNum(m[1]), r: parseInt(m[2], 10) } : null;
}

/** Collects referenced areas per sheet: exact cells, rects, full cols/rows. */
class RefSet {
  constructor() { this.bySheet = new Map(); }
  _sheet(name) {
    const key = name.trim();
    if (!this.bySheet.has(key)) this.bySheet.set(key, { cells: new Set(), rects: [], cols: new Set(), rows: new Set() });
    return this.bySheet.get(key);
  }
  addCell(sheet, addr) {
    const p = parseAddr(addr);
    if (p) this._sheet(sheet).cells.add(p.c + ':' + p.r);
  }
  addRange(sheet, a1, a2) {
    const p1 = parseAddr(a1), p2 = parseAddr(a2);
    if (p1 && p2) this._sheet(sheet).rects.push({
      c1: Math.min(p1.c, p2.c), c2: Math.max(p1.c, p2.c),
      r1: Math.min(p1.r, p2.r), r2: Math.max(p1.r, p2.r)
    });
  }
  addColRange(sheet, col1, col2) {
    const s = this._sheet(sheet);
    for (let c = colToNum(col1); c <= colToNum(col2); c++) s.cols.add(c);
  }
  addRowRange(sheet, r1, r2) {
    const s = this._sheet(sheet);
    for (let r = parseInt(r1, 10); r <= parseInt(r2, 10); r++) s.rows.add(r);
  }
  has(sheet, colNum, rowNum) {
    const s = this.bySheet.get(sheet.trim());
    if (!s) return false;
    if (s.cols.has(colNum) || s.rows.has(rowNum)) return true;
    if (s.cells.has(colNum + ':' + rowNum)) return true;
    return s.rects.some(x => colNum >= x.c1 && colNum <= x.c2 && rowNum >= x.r1 && rowNum <= x.r2);
  }
}

// Sheet-qualified: 'My Sheet'!A1, Inputs!$B$4:$C$10, Inputs!C:C, Inputs!5:9
const Q_REF = /(?:'([^']+)'|([A-Za-z0-9_\.\u00C0-\uFFFF]+))!(\$?[A-Z]{1,3}\$?\d{1,7}(?::\$?[A-Z]{1,3}\$?\d{1,7})?|\$?[A-Z]{1,3}:\$?[A-Z]{1,3}|\$?\d{1,7}:\$?\d{1,7})/g;
// Bare same-sheet refs (used only for formulas that live ON an input sheet)
const BARE_REF = /(?<![A-Za-z0-9_!$])(\$?[A-Z]{1,3}\$?\d{1,7})(?::(\$?[A-Z]{1,3}\$?\d{1,7}))?(?![A-Za-z0-9_(])/g;

function harvestRefs(formula, ownSheet, ownIsInput, refs, nameMap) {
  let m;
  Q_REF.lastIndex = 0;
  while ((m = Q_REF.exec(formula)) !== null) {
    const sheet = (m[1] || m[2]);
    const body = m[3].replace(/\$/g, '');
    if (body.includes(':')) {
      const [a, b] = body.split(':');
      if (COL_RE.test(a) && COL_RE.test(b)) refs.addColRange(sheet, a, b);
      else if (/^\d+$/.test(a) && /^\d+$/.test(b)) refs.addRowRange(sheet, a, b);
      else refs.addRange(sheet, a, b);
    } else {
      refs.addCell(sheet, body);
    }
  }
  if (ownIsInput) {
    BARE_REF.lastIndex = 0;
    while ((m = BARE_REF.exec(formula)) !== null) {
      const a = m[1].replace(/\$/g, '');
      if (m[2]) refs.addRange(ownSheet, a, m[2].replace(/\$/g, ''));
      else refs.addCell(ownSheet, a);
    }
  }
  // Defined names used as bare tokens resolve to their target ranges
  for (const [name, targets] of nameMap) {
    if (name.length < 2) continue;
    if (new RegExp('(?<![A-Za-z0-9_.])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_(])', 'i').test(formula)) {
      for (const t of targets) {
        // targets look like 'Sheet'!$A$1:$B$9 or Sheet!$A$1
        Q_REF.lastIndex = 0;
        let tm;
        while ((tm = Q_REF.exec(t)) !== null) {
          const sheet = (tm[1] || tm[2]);
          const body = tm[3].replace(/\$/g, '');
          if (body.includes(':')) {
            const [a, b] = body.split(':');
            if (COL_RE.test(a) && COL_RE.test(b)) refs.addColRange(sheet, a, b);
            else if (/^\d+$/.test(a) && /^\d+$/.test(b)) refs.addRowRange(sheet, a, b);
            else refs.addRange(sheet, a, b);
          } else refs.addCell(sheet, body);
        }
      }
    }
  }
}

const INPUT_SHEET_RE = /input|assumption|driver/i;

function detectRedundantInputs(workbook) {
  const inputSheets = [];
  workbook.eachSheet(ws => { if (INPUT_SHEET_RE.test(ws.name)) inputSheets.push(ws.name); });
  if (inputSheets.length === 0) {
    return { applicable: false, inputSheets: [], totalInputs: 0, redundantCount: 0, redundant: [],
             note: 'No sheet matching input/assumption/driver naming — analysis not applicable.' };
  }

  // Defined names
  const nameMap = new Map();
  try {
    for (const name of workbook.definedNames.model || []) {
      if (name && name.name && Array.isArray(name.ranges)) nameMap.set(name.name, name.ranges);
    }
  } catch (_) { /* older exceljs shapes — proceed without names */ }

  const inputSet = new Set(inputSheets.map(s => s.trim()));
  const refs = new RefSet();
  let offsetIndirect = 0;

  workbook.eachSheet(ws => {
    const ownIsInput = inputSet.has(ws.name.trim());
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const f = cell.formula ? (typeof cell.formula === 'object' ? cell.formula.formula : cell.formula) : null;
        if (!f) return;
        if (/OFFSET\s*\(|INDIRECT\s*\(/i.test(f)) offsetIndirect++;
        harvestRefs(String(f), ws.name, ownIsInput, refs, nameMap);
      });
    });
  });

  // Walk input sheets for unreferenced numeric constants
  const redundant = [];
  let totalInputs = 0;
  for (const sheetName of inputSheets) {
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) continue;
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (cell.formula) return;                       // formulas are not inputs
        const v = cell.value;
        if (typeof v !== 'number') return;              // constants only; labels/dates excluded
        if (v instanceof Date) return;
        totalInputs++;
        if (!refs.has(sheetName, colNum, rowNum)) {
          // No cap — every redundant cell is reported. This tab's entire
          // purpose is "every listed input must be linked, removed or
          // relabelled"; silently dropping some past an arbitrary limit
          // would leave real findings invisible to the client.
          // Nearby label — see cell-label.js for the search order (left,
          // then right) and why both directions matter.
          const label = findNearbyLabel(row, colNum).slice(0, 60);
          redundant.push({ sheet: sheetName, cell: cell.address, value: v, label, _col: colNum, _row: rowNum });
        }
      });
    });
  }
  // Exclude row-index columns — a run of 3+ consecutive integers (0,1,2,...
  // or 1,2,3,...) within one column is a human-readable list number, not a
  // modeling assumption. Real assumptions (rates, prices, capacities)
  // essentially never happen to form a perfect arithmetic sequence from a
  // low starting point; this pattern is specific enough to exclude
  // outright rather than merely flag with lower confidence. Verified
  // against a real client model where an unlabelled "1,2,3...11" list-index
  // column was otherwise flagged 33 times.
  // Exclude row-index RUNS — a run of 3+ consecutive integers (0,1,2,...
  // or 1,2,3,...) in CONSECUTIVE ROWS within one column is a human-readable
  // list number, not a modeling assumption. Real assumptions (rates,
  // prices, capacities) essentially never happen to form a perfect
  // arithmetic sequence from a low starting point; this pattern is
  // specific enough to exclude outright rather than merely flag with
  // lower confidence.
  //
  // Detected per RUN, not per whole column: a single column can contain
  // multiple separate lists that each restart at 1 (verified against a
  // real client model — three sections in one column, each numbered
  // 1-11 with gaps between them). Requiring the entire column to form one
  // unbroken sequence missed this real case entirely; checking maximal
  // contiguous sub-runs (adjacent rows AND value+1 each step) instead
  // correctly excludes each list independently.
  const byColumn = new Map();
  for (const item of redundant) {
    const key = item.sheet + '\u0001' + item._col;
    if (!byColumn.has(key)) byColumn.set(key, []);
    byColumn.get(key).push(item);
  }
  const indexItemKeys = new Set();
  const itemKey = item => item.sheet + '\u0001' + item.cell;
  let excludedRunCount = 0;
  for (const items of byColumn.values()) {
    const sorted = [...items].sort((a, b) => a._row - b._row);
    let runStart = 0;
    for (let i = 1; i <= sorted.length; i++) {
      const breaks = i === sorted.length ||
        sorted[i]._row !== sorted[i - 1]._row + 1 ||
        sorted[i].value !== sorted[i - 1].value + 1;
      if (breaks) {
        const runLen = i - runStart;
        const startsLow = sorted[runStart].value === 0 || sorted[runStart].value === 1;
        if (runLen >= 3 && startsLow) {
          for (let j = runStart; j < i; j++) indexItemKeys.add(itemKey(sorted[j]));
          excludedRunCount++;
        }
        runStart = i;
      }
    }
  }
  const excludedAsIndex = redundant.filter(item => indexItemKeys.has(itemKey(item))).length;
  const filtered = redundant.filter(item => !indexItemKeys.has(itemKey(item)));
  filtered.forEach(item => { delete item._col; delete item._row; });

  const redundantCount = filtered.length;

  return {
    applicable: true,
    inputSheets,
    totalInputs,
    redundantCount,
    redundant: filtered,
    offsetIndirectFormulas: offsetIndirect,
    excludedIndexRuns: excludedRunCount,
    note: [
      offsetIndirect > 0
        ? `Static reference analysis — ${offsetIndirect.toLocaleString()} OFFSET/INDIRECT formulas exist in this model; inputs consumed only through dynamic windows may appear here despite being used. Treat listed cells as review candidates.`
        : 'Static reference analysis including ranges, whole columns/rows and defined names.',
      excludedAsIndex > 0
        ? `${excludedAsIndex} cell(s) across ${excludedRunCount} list(s) were excluded as row-numbering (a sequential 1,2,3... run in consecutive rows), not modelling assumptions.`
        : null
    ].filter(Boolean).join(' ')
  };
}

module.exports = { detectRedundantInputs };
