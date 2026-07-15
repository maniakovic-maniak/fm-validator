// cell-dependency-tracer.js — A4, extends the existing Sheet Dependency
// tab's sheet-level linkage (edgeList/dependencyMap in validator-tier0.js)
// to actual cell-level chain verification: given a specific cell, trace
// its real formula-reference chain backward through multiple hops to
// confirm it doesn't dead-end at a blank cell or propagate a cached
// error, rather than only knowing which sheets reference which other
// sheets in aggregate.
//
// Deliberately regex-based, not a full formula parser/AST. This covers
// the common reference forms (bare same-sheet cells, sheet-qualified
// cells, and ranges — taking a range's top-left cell as its
// representative reference) without the much larger undertaking of a
// complete Excel formula grammar. Ranges used purely as SUM/aggregation
// arguments are a known blind spot — this traces the range's anchor
// cell, not its full contents — documented below, not silently assumed
// to be complete.

const CELL_REF_RE = /(\$?[A-Za-z]{1,3}\$?\d+)(?::\$?[A-Za-z]{1,3}\$?\d+)?/g;

/**
 * Extract cell-level precedent references from a formula's text,
 * resolving bare (same-sheet) references against currentSheet and
 * sheet-qualified references (both quoted 'Sheet Name'!A1 and unquoted
 * SheetName!A1 forms) against their named sheet.
 *
 * @param {string} formula - raw formula text (without leading '=')
 * @param {string} currentSheet - the sheet the formula itself lives on
 * @param {string[]} allSheetNames - real sheet names, to validate matches
 * @returns {{sheet: string, cell: string}[]} deduplicated precedent cells
 */
function extractCellReferences(formula, currentSheet, allSheetNames) {
  if (!formula) return [];
  const results = [];
  const seen = new Set();

  // Split the formula into segments so we know, for each cell reference
  // found, whether it was immediately preceded by a sheet qualifier —
  // otherwise a bare cell reference sitting right after a genuinely
  // sheet-qualified one earlier in the formula could be wrongly
  // attributed to that same sheet.
  const sheetQualPattern = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_. ]*))!/g;
  const qualifiedSpans = []; // {start, end, sheet} — end = index right after the '!' where a cell ref should follow
  let qm;
  while ((qm = sheetQualPattern.exec(formula)) !== null) {
    const sheetName = qm[1] || qm[2];
    if (allSheetNames.includes(sheetName)) {
      qualifiedSpans.push({ start: qm.index, end: qm.index + qm[0].length, sheet: sheetName });
    }
  }

  let m;
  const cellRe = new RegExp(CELL_REF_RE.source, 'g');
  while ((m = cellRe.exec(formula)) !== null) {
    const matchStart = m.index;
    // Is this cell reference immediately preceded by a sheet qualifier?
    const qualifier = qualifiedSpans.find(q => q.end === matchStart);
    const sheet = qualifier ? qualifier.sheet : currentSheet;
    const cellAddr = m[1].replace(/\$/g, ''); // normalize away absolute-reference $ signs
    const key = `${sheet}!${cellAddr}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ sheet, cell: cellAddr });
    }
  }

  return results;
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
  const visited = new Set();
  const chain = [];
  const deadEnds = [];
  const errorPropagations = [];

  function walk(sheet, cell, depth) {
    const key = `${sheet}!${cell}`;
    if (visited.has(key)) return; // circular reference guard — already reported by the dedicated circular-reference check elsewhere
    visited.add(key);
    if (depth > maxDepth) {
      chain.push({ sheet, cell, note: `Chain trace stopped at max depth (${maxDepth}) — this cell was not further expanded.` });
      return;
    }

    const indexed = cellScoreIndex[key];
    if (indexed) {
      chain.push({ sheet, cell, formulaText: indexed.formulaText, depth });
      const precedents = extractCellReferences(indexed.formulaText, sheet, allSheetNames);
      for (const p of precedents) {
        walk(p.sheet, p.cell, depth + 1);
      }
      return;
    }

    // Not a formula cell in the index — check whether it's a genuine
    // input (has a real cached value) or a dead reference (blank).
    const value = getValue(sheet, cell);
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
  };
}

module.exports = { extractCellReferences, traceCellChain };
