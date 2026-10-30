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

const { fullFormula } = require('./formula-store');
const { buildRangeGraph, findCyclesInRangeGraph, RangeGraph } = require('./reference-service');
const { namedAreas } = require('./path-checks-common');

const DIVIDEND_LABEL_RE = /\b(dividend|distribution|shareholder return|equity distribution|equity payout|cash sweep|distributable cash|equity top[\s-]?up|minimum[\s-]?cash|funding gap|equity injection|capital call)\b/i;

// ROW(ref) and COLUMN(ref) return a cell's POSITION, never its value, so
// ROW(E368)-ROW($E$368) in E368 is not a circular dependency (found in an
// independent review of a licence model: 72 'cycles' were coordinate-only).
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
  const fnRe = /\b(COLUMNS|ROWS|COLUMN|ROW)\s*\(/gi;
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

// Build the dependency graph from the shared reference service (reference-service.js): string literals are removed
// before references are read, a range is kept as a range (so a cell inside SUM(A2:A10) is a precedent of the SUM),
// defined names resolve to their ranges, and whole-column references are ranges to the sheet's edge. A dependency that
// cannot be located (a name that is not a plain range, a table reference, an external workbook) is counted in
// graph.unknown rather than dropped silently. Position-only arguments (ROW, COLUMN, ROWS, COLUMNS) add no edge.
// opts.names: { NAME: { sheet, c1, r1, c2, r2 } }; checkCircularReferences supplies the workbook's own.
function buildDependencyGraph(cellScoreIndex, allSheetNames, opts = {}) {
  return buildRangeGraph(cellScoreIndex, allSheetNames, {
    names: opts.names,
    textOf: (key, info) => fullFormula(cellScoreIndex, key, info),
  });
}

// Iterative (non-recursive) DFS cycle detection using the classic
// 3-colour approach — white (unvisited), gray (on the current path),
// black (fully processed). Encountering a gray node closes a cycle.
// Iterative specifically to avoid stack-overflow risk on a workbook with
// tens of thousands of formula cells and potentially deep chains.
// Returns closed key paths ([ 'S!A1', 'S!A5', 'S!A1' ]) as before. For a RangeGraph each path also carries
// .throughRange and .conditional (see findCyclesInRangeGraph) and the array carries .capped.
function findCycles(graph, opts) {
  if (!(graph instanceof RangeGraph)) return findCyclesPlain(graph);
  const found = findCyclesInRangeGraph(graph, opts);
  const out = found.map(c => Object.assign(c.path, { throughRange: c.throughRange, conditional: c.conditional }));
  out.capped = found.capped;
  return out;
}

// The older plain-object form { key: [keys] } is still accepted (tests and callers that build their own graph).
function findCyclesPlain(graph) {
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

function namesForGraph(workbook) {
  const out = {};
  try {
    for (const [k, p] of Object.entries(namedAreas(workbook))) out[k] = { sheet: p.sheet, c1: p.c1, r1: p.r1, c2: p.c2, r2: p.r2 };
  } catch (_) { /* no usable names: they are then counted as unknown dependencies */ }
  return out;
}

function checkCircularReferences(cellScoreIndex, allSheetNames, workbook) {
  const graph = buildDependencyGraph(cellScoreIndex, allSheetNames, { names: workbook ? namesForGraph(workbook) : undefined });
  const cycles = findCycles(graph);

  const classified = cycles.map(cyclePath => {
    const dividendCheck = cycleTouchesDividendLabel(cyclePath, workbook);
    return { path: Array.from(cyclePath), length: cyclePath.length - 1, isDividendRelated: dividendCheck.touches, dividendLabel: dividendCheck.label, dividendCell: dividendCheck.atCell,
             throughRange: !!cyclePath.throughRange, conditional: !!cyclePath.conditional };
  });
  // Cycles made only of single-cell references keep their original two buckets and findings. A cycle that needs a range
  // to close (a cell inside the SUM range that reads the SUM) is new and is reported separately, split into the ones
  // every edge of which is always evaluated (Excel would flag these) and the ones that need a lazily evaluated branch.
  const direct = classified.filter(c => !c.throughRange);
  const viaRange = classified.filter(c => c.throughRange);

  return {
    applicable: true,
    totalCycles: classified.length,
    capped: !!cycles.capped,
    dividendRelatedCycles: direct.filter(c => c.isDividendRelated),
    otherCycles: direct.filter(c => !c.isDividendRelated),
    rangeCycles: viaRange,
    rangeCyclesUnconditional: viaRange.filter(c => !c.conditional),
    rangeCyclesConditional: viaRange.filter(c => c.conditional),
    // what the graph could and could not locate, so a quiet result is not read as full coverage
    stats: { ...graph.stats, unknownDependencies: graph.unknown },
  };
}

// T0-CIRC-003: cycles that close through a range, and what the search could not locate. null when there is nothing to say.
function buildRangeCycleFinding(result) {
  if (!result || !result.applicable) return null;
  const unc = result.rangeCyclesUnconditional || [], con = result.rangeCyclesConditional || [];
  const unk = result.stats && result.stats.unknownDependencies;
  if (unc.length === 0 && con.length === 0) return null;
  const sampleOf = list => list.slice(0, 3).map(c => c.path.slice(0, -1).slice(0, 4).join(' -> ') + (c.path.length > 5 ? ' -> ...' : '')).join('; ');
  const parts = [];
  if (unc.length) parts.push(`${unc.length} chain(s) close through a range and every link is always evaluated, so Excel reports them as circular unless iterative calculation is switched on: a cell inside a range such as SUM(A2:A10) reads the cell that holds that range, e.g. ${sampleOf(unc)}.`);
  if (con.length) parts.push(`${con.length} further chain(s) close only through a lazily evaluated branch (an IF, CHOOSE or IFERROR argument), which Excel meets only when that branch runs${con.length ? `, e.g. ${sampleOf(con)}` : ''}.`);
  const limits = [];
  if (result.capped) limits.push('the search stopped at its cycle limit, so more may exist');
  if (unk && unk.total > 0) limits.push(`${unk.total} dependenc${unk.total === 1 ? 'y' : 'ies'} could not be located (${Object.entries(unk.byKind).map(([k, v]) => `${v} ${k}`).join(', ')}), so loops through those are not visible`);
  const first = (unc[0] || con[0]).path[0].split('!');
  return {
    id: 'T0-CIRC-003',
    label: `${unc.length + con.length} circular reference chain(s) found through ranges`,
    severity: unc.length ? 'medium' : 'low', status: 'fail',
    sheet: first[0], cell: first[1], category: 'Structure',
    condition: `${parts.join(' ')}${limits.length ? ' Limits: ' + limits.join('; ') + '.' : ''} This test reads formula text only; it does not recalculate, and it cannot tell whether a loop is intended.`,
    reason: `${unc.length + con.length} circular reference chain(s) through ranges`,
    corrective_action: 'For each chain, confirm whether it is a deliberate iterative calculation (documented, with iterative calculation enabled) or a range that has grown to include its own result. A total that sums a block containing itself should be re-pointed at the cells above it.',
    workstream: 'Structure', issue_type: 'Circular reference — through a range',
    model_risk: 'A range that includes its own result is evaluated differently by different spreadsheet engines and by Excel with iteration on or off, so the figure can differ between users.',
    key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
    root_cause: 'Range includes a cell that depends on it', escalation_flag: false,
    urgency: unc.length ? 'Before next reliance' : 'When convenient', confidence: unc.length ? 75 : 55,
  };
}

module.exports = { buildRangeCycleFinding, checkCircularReferences, buildDependencyGraph, findCycles, stripStructuralFunctionArgs };
