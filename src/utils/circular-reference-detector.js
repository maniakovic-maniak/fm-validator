// circular-reference-detector.js — G7: genuine graph-based circular-
// reference detection, replacing what the existing Tier 1 check
// (no_circular_references) actually does today: nothing. It always
// reports "uncertain" with a static message telling the user to check
// manually in Excel — there was no real detection to sharpen, so this
// builds that capability from scratch, then classifies whether any
// detected cycle routes through a dividend/distribution cell (the
// specific higher-risk pattern raised in the audit-gap review: a
// distribution decision based on a post-distribution metric like cash
// balance or leverage, which is a true circularity, not the common,
// often-intentional interest-on-average-balance pattern).
//
// Reuses extractCellReferences from cell-dependency-tracer.js (A4) for
// edge extraction — same proven reference-parsing logic, no duplication.

const { extractCellReferences } = require('./cell-dependency-tracer');

const DIVIDEND_LABEL_RE = /\b(dividend|distribution|shareholder return|equity distribution|equity payout|cash sweep|distributable cash|equity top[\s-]?up|minimum[\s-]?cash|funding gap|equity injection|capital call)\b/i;

// COLUMNS(...) and ROWS(...) calls are a standard Excel technique for a
// growing-range counter (COLUMNS($H21:H21) = 1, becomes
// COLUMNS($H21:I21) = 2 when copied across a row) — they depend on a
// range's SIZE/POSITION, never on any cell's actual VALUE. A naive
// reference extractor sees "H21" as text inside COLUMNS($H21:H21) and
// wrongly treats it as a real dependency, producing a false self-
// referencing "cycle" on every period-counter formula in a schedule.
// Stripped out before extraction — paren-depth-aware (not a naive
// regex) so a nested call inside the argument doesn't break the span.
function stripStructuralFunctionArgs(formula) {
  if (!formula) return formula;
  const fnRe = /\b(COLUMNS|ROWS)\s*\(/gi;
  const spans = []; // {openParenIdx, closeParenIdx} to strip, found in ONE pass over the original string
  let m;
  while ((m = fnRe.exec(formula)) !== null) {
    const openParenIdx = m.index + m[0].length - 1;
    let depth = 1;
    let j = openParenIdx + 1;
    while (j < formula.length && depth > 0) {
      if (formula[j] === '(') depth++;
      else if (formula[j] === ')') depth--;
      j++;
    }
    const closeParenIdx = j - 1;
    spans.push({ openParenIdx, closeParenIdx });
    // Advance the regex past this whole call so a COLUMNS(...) sitting
    // inside another COLUMNS(...)'s argument isn't matched a second time
    // as its own separate span — the outer strip already covers it.
    fnRe.lastIndex = closeParenIdx + 1;
  }
  if (spans.length === 0) return formula;

  let result = '';
  let cursor = 0;
  for (const { openParenIdx, closeParenIdx } of spans) {
    result += formula.slice(cursor, openParenIdx + 1);
    cursor = closeParenIdx; // skip the argument content, keep the closing paren
  }
  result += formula.slice(cursor);
  return result;
}

// Build a directed graph: key -> [referenced keys], where key is
// "Sheet!Cell". Only formula cells contribute edges — a referenced cell
// with no formula of its own is a leaf (an input), not a further edge.
function buildDependencyGraph(cellScoreIndex, allSheetNames) {
  const graph = {};
  for (const [key, info] of Object.entries(cellScoreIndex)) {
    if (!info.formulaText) continue;
    const [sheet] = key.split('!');
    const cleanedFormula = stripStructuralFunctionArgs(info.formulaText);
    const refs = extractCellReferences(cleanedFormula, sheet, allSheetNames);
    graph[key] = refs.map(r => `${r.sheet}!${r.cell}`);
  }
  return graph;
}

// Iterative (non-recursive) DFS cycle detection using the classic
// 3-colour approach — white (unvisited), gray (on the current path),
// black (fully processed). Encountering a gray node closes a cycle.
// Iterative specifically to avoid stack-overflow risk on a workbook with
// tens of thousands of formula cells and potentially deep chains.
function findCycles(graph) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  const cycles = [];
  const seenCycleSignatures = new Set();

  for (const node of Object.keys(graph)) color[node] = WHITE;

  for (const start of Object.keys(graph)) {
    if (color[start] !== WHITE) continue;

    // stack of {node, edgeIndex} — edgeIndex tracks progress through
    // that node's outgoing edges so we can resume after a recursive step
    const stack = [{ node: start, edgeIndex: 0 }];
    const pathSet = new Set([start]);
    color[start] = GRAY;

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const edges = graph[top.node] || [];

      if (top.edgeIndex >= edges.length) {
        color[top.node] = BLACK;
        pathSet.delete(top.node);
        stack.pop();
        continue;
      }

      const next = edges[top.edgeIndex];
      top.edgeIndex++;

      if (color[next] === undefined) continue; // reference to a non-formula cell — not part of the graph, dead end
      if (color[next] === GRAY) {
        // Found a cycle — reconstruct the path from `next` to the top of the stack.
        const cyclePath = [];
        let started = false;
        for (const frame of stack) {
          if (frame.node === next) started = true;
          if (started) cyclePath.push(frame.node);
        }
        cyclePath.push(next); // close the loop back to the start
        const signature = [...cyclePath].sort().join('|');
        if (!seenCycleSignatures.has(signature)) {
          seenCycleSignatures.add(signature);
          cycles.push(cyclePath);
        }
        continue;
      }
      if (color[next] === WHITE) {
        color[next] = GRAY;
        pathSet.add(next);
        stack.push({ node: next, edgeIndex: 0 });
      }
    }
  }

  return cycles;
}

// For a given cycle path, check whether any cell in it sits in a row
// whose label matches dividend/distribution vocabulary. Needs the raw
// workbook to read row labels (not available from cellScoreIndex alone).
function cycleTouchesDividendLabel(cyclePath, workbook) {
  for (const key of cyclePath) {
    const [sheetName, cellAddr] = key.split('!');
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) continue;
    const match = cellAddr.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const rowNumber = parseInt(match[2], 10);
    const row = ws.getRow(rowNumber);
    let rowLabel = null;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (rowLabel === null && typeof cell.value === 'string') rowLabel = cell.value;
    });
    if (rowLabel && DIVIDEND_LABEL_RE.test(rowLabel)) return { touches: true, label: rowLabel, atCell: key };
  }
  return { touches: false };
}

function checkCircularReferences(cellScoreIndex, allSheetNames, workbook) {
  const graph = buildDependencyGraph(cellScoreIndex, allSheetNames);
  const cycles = findCycles(graph);

  const classified = cycles.map(cyclePath => {
    const dividendCheck = cycleTouchesDividendLabel(cyclePath, workbook);
    return { path: cyclePath, length: cyclePath.length - 1, isDividendRelated: dividendCheck.touches, dividendLabel: dividendCheck.label, dividendCell: dividendCheck.atCell };
  });

  return {
    applicable: true,
    totalCycles: classified.length,
    dividendRelatedCycles: classified.filter(c => c.isDividendRelated),
    otherCycles: classified.filter(c => !c.isDividendRelated),
  };
}

module.exports = { checkCircularReferences, buildDependencyGraph, findCycles, stripStructuralFunctionArgs };
