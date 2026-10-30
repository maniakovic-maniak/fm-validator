// cell-dependency-tracer.js — A4, extends the existing Sheet Dependency
// tab's sheet-level linkage (edgeList/dependencyMap in validator-tier0.js)
// to actual cell-level chain verification: given a specific cell, trace
// its real formula-reference chain backward through multiple hops to
// confirm it doesn't dead-end at a blank cell or propagate a cached
// error, rather than only knowing which sheets reference which other
// sheets in aggregate.
//
// Reference reading is done by the shared reference service (reference-service.js): string literals are removed before
// references are read, ranges contribute their cells (the first RANGE_LIMIT of them, row by row, instead of only the
// top-left cell), and ROW/COLUMN/ROWS/COLUMNS arguments, which read a position and never a value, add nothing.
// A range's top-left cell is followed as a direct reference, exactly as before (a whole-row or whole-column reference has no meaningful top-left, so none of its cells is). Every other member of a range, and
// anything further up from such a cell, is followed for cached errors but is never reported as a dead end: a blank in a SUM range, or a template column behind a formula in it, is
// normal. Dead ends are reported only on chains made of direct references, as before.

const { tokenizeReferences, expandRefs, makeContext } = require('./reference-service');
const { fullFormula } = require('./formula-store');
const RANGE_LIMIT = 60;

/**
 * Extract cell-level precedent references from a formula's text.
 *
 * @param {string} formula - raw formula text (with or without the leading '=')
 * @param {string} currentSheet - the sheet the formula itself lives on
 * @param {string[]} allSheetNames - real sheet names, to validate matches
 * @param {object} [opts] - { names, rangeLimit, stats } ; stats.rangesCut is incremented when a range is cut short
 * @returns {{sheet: string, cell: string, fromRange: boolean}[]} deduplicated precedent cells
 */
function extractCellReferences(formula, currentSheet, allSheetNames, opts = {}) {
  if (!formula) return [];
  const ctx = makeContext(allSheetNames, opts.names);
  ctx.sheetOrder = allSheetNames;
  const t = tokenizeReferences(formula, currentSheet, ctx);
  const rangeLimit = opts.rangeLimit || RANGE_LIMIT;
  const out = [], seen = new Set();
  for (const r of t.refs) {
    if (r.positionOnly) continue;
    const single = r.c1 === r.c2 && r.r1 === r.r2;
    const { cells, rangesCut } = expandRefs({ refs: [r] }, { rangeLimit });
    if (rangesCut && opts.stats) opts.stats.rangesCut = (opts.stats.rangesCut || 0) + rangesCut;
    cells.forEach((c, i) => {
      const key = c.sheet + '!' + c.cell;
      if (seen.has(key)) return;
      seen.add(key);
      // A range's top-left cell is followed as a direct reference, as it always was; the other members are range-derived.
      out.push({ sheet: c.sheet, cell: c.cell, fromRange: !single && (i > 0 || r.kind === 'row' || r.kind === 'column') });
    });
  }
  return out;
}

/**
 * Trace a cell's full precedent chain backward, using the existing
 * cellScoreIndex (Sheet!Cell -> {formulaText, ...}) as the formula
 * lookup source, and a value-lookup callback for checking whether a
 * referenced cell that ISN'T a formula is a genuine input (has a real
 * value) or a dead/blank reference.
 *
 * @param {string} startSheet
 * @param {string} startCell
 * @param {object} cellScoreIndex - from validator-tier0.js's runTier0() result
 * @param {(sheet: string, cell: string) => any} getValue - returns the cached value at Sheet!Cell, or undefined/null if blank
 * @param {string[]} allSheetNames
 * @param {number} [maxDepth=15] - stops the trace rather than walking indefinitely on a very deep or malformed chain
 */
function traceCellChain(startSheet, startCell, cellScoreIndex, getValue, allSheetNames, maxDepth = 15) {
  const visited = new Map();    // key -> true when every visit so far came through a range, false once reached directly
  const chain = [];
  const deadEnds = [];
  const errorPropagations = [];

  const rangeStats = { rangesCut: 0 };
  function walk(sheet, cell, depth, viaRange) {
    const key = `${sheet}!${cell}`;
    const before = visited.get(key);
    // circular reference guard — already reported by the dedicated circular-reference check elsewhere. A cell first
    // reached through a range and later reached directly is walked again, so reaching it by a range first cannot hide it.
    if (before !== undefined && (before === false || viaRange)) return;
    const upgrade = before === true;
    visited.set(key, viaRange);
    if (depth > maxDepth) {
      chain.push({ sheet, cell, note: `Chain trace stopped at max depth (${maxDepth}) — this cell was not further expanded.` });
      return;
    }

    const indexed = cellScoreIndex[key];
    if (indexed) {
      const ftxt = fullFormula(cellScoreIndex, key, indexed);
      if (!upgrade) chain.push({ sheet, cell, formulaText: indexed.formulaText, depth });
      const precedents = extractCellReferences(ftxt, sheet, allSheetNames, { stats: rangeStats });
      for (const p of precedents) {
        walk(p.sheet, p.cell, depth + 1, viaRange || p.fromRange);
      }
      return;
    }

    // Not a formula cell in the index — check whether it's a genuine
    // input (has a real cached value) or a dead reference (blank).
    const value = getValue(sheet, cell);
    // Reached through a range, directly or further up the chain: a blank or an ordinary value is expected (template
    // columns, unused rows) and is not a dead end to report. A cached error is still reported.
    if (viaRange && !(typeof value === 'string' && /^#(REF|VALUE|DIV\/0|NAME|NUM|N\/A|NULL)/.test(value))) return;
    if (value === undefined || value === null || value === '') {
      deadEnds.push({ sheet, cell, depth });
      chain.push({ sheet, cell, note: 'BLANK — chain ends here with no value and no formula', depth });
    } else if (typeof value === 'string' && /^#(REF|VALUE|DIV\/0|NAME|NUM|N\/A|NULL)/.test(value)) {
      errorPropagations.push({ sheet, cell, value, depth });
      chain.push({ sheet, cell, note: `Cached error value (${value}) — this error may be propagating upstream`, depth });
    } else {
      chain.push({ sheet, cell, note: `Genuine input value: ${value}`, depth });
    }
  }

  walk(startSheet, startCell, 0);

  return {
    startSheet,
    startCell,
    chainLength: chain.length,
    chain,
    hasDeadEnds: deadEnds.length > 0,
    deadEnds,
    hasErrorPropagation: errorPropagations.length > 0,
    errorPropagations,
    rangesCut: rangeStats.rangesCut,
  };
}

module.exports = { extractCellReferences, traceCellChain };
