// key-output-chain-check.js — A4, wires cell-dependency-tracer.js into an
// actual finding by targeting KEY OUTPUT cells specifically, rather than
// tracing every one of a workbook's formula cells (potentially tens of
// thousands, most chains overlapping heavily with each other — slow and
// mostly redundant). Key outputs are exactly the cells where a broken or
// dead-ending chain matters most: they're what a reader actually relies on.
//
// Deliberately worded as "worth confirming", not "broken" — a dependency
// chain reaching a blank cell can genuinely mean a missing input, but it
// can just as easily mean a template column for a future period that
// hasn't been populated yet. Confirmed real on a production file: several
// dead-ends traced back to sequential time-period-style columns, which is
// a common, often benign pattern, not automatically a defect. This
// mirrors the same "flag with evidence, don't assert wrong" discipline
// every other check in this codebase already follows.

const { findLabeledValues } = require('./find-labeled-value');
const { traceCellChain } = require('./cell-dependency-tracer');

const KEY_OUTPUT_TERMS = [
  'IRR', 'NPV', 'EBITDA', 'DSCR', 'MOIC', 'Equity Multiple',
  'Development Margin', 'Exit Multiple', 'Equity IRR', 'Project IRR',
];

/**
 * @param {object} workbook - exceljs Workbook (parsed._raw)
 * @param {object} cellScoreIndex - from validator-tier0.js's runTier0() result
 * @param {string[]} allSheetNames
 * @param {object} [options]
 * @param {number} [options.maxCellsToTrace=15] - caps runtime; key outputs are typically a small, well-known set of cells, not thousands
 * @param {number} [options.maxChainDepth=10]
 */
function checkKeyOutputChains(workbook, cellScoreIndex, allSheetNames, options = {}) {
  const maxCellsToTrace = options.maxCellsToTrace || 15;
  const maxChainDepth = options.maxChainDepth || 10;

  const candidates = findLabeledValues(workbook, KEY_OUTPUT_TERMS, { maxDistance: 8 });

  // Dedupe by exact cell and cap the count — take the first N distinct
  // matches rather than every instance of every term, since the same key
  // output is often labelled and referenced in more than one place
  // (dashboard, teaser deck, backup sheet).
  const seen = new Set();
  const toTrace = [];
  for (const c of candidates) {
    if (!c.isFormula) continue; // a hardcoded key output is a real issue, but a different, already-covered one (no_hardcodes) — not this check's job
    const key = `${c.sheet}!${c.valueCell}`;
    if (seen.has(key)) continue;
    seen.add(key);
    toTrace.push(c);
    if (toTrace.length >= maxCellsToTrace) break;
  }

  function getValue(sheetName, cellAddr) {
    const ws = workbook.getWorksheet(sheetName);
    if (!ws) return undefined;
    const cell = ws.getCell(cellAddr);
    if (cell.formula) return undefined; // handled via cellScoreIndex instead
    return cell.value;
  }

  // Aggregate by root cause (the specific blank cell or error cell), not
  // by traced key-output cell — confirmed real need on a production file
  // where 13 of 15 traced outputs converged on the same handful of root
  // cells. One finding per root cause, listing every key output affected,
  // is far more useful than 13 near-duplicate findings all pointing at
  // the same underlying cell.
  const byRootCause = new Map(); // "Sheet!Cell" (the dead-end/error cell) -> { type, affectedOutputs: [...] }

  for (const candidate of toTrace) {
    const chainResult = traceCellChain(
      candidate.sheet, candidate.valueCell, cellScoreIndex, getValue, allSheetNames, maxChainDepth
    );
    const outputDescriptor = { sheet: candidate.sheet, cell: candidate.valueCell, labelText: candidate.labelText };

    for (const d of chainResult.deadEnds) {
      const key = `${d.sheet}!${d.cell}`;
      if (!byRootCause.has(key)) byRootCause.set(key, { type: 'dead_end', sheet: d.sheet, cell: d.cell, affectedOutputs: [] });
      byRootCause.get(key).affectedOutputs.push(outputDescriptor);
    }
    for (const e of chainResult.errorPropagations) {
      const key = `${e.sheet}!${e.cell}`;
      if (!byRootCause.has(key)) byRootCause.set(key, { type: 'error_propagation', sheet: e.sheet, cell: e.cell, value: e.value, affectedOutputs: [] });
      byRootCause.get(key).affectedOutputs.push(outputDescriptor);
    }
  }

  const results = [...byRootCause.values()];

  return {
    applicable: true,
    tracedCount: toTrace.length,
    flaggedCount: results.length,
    results,
  };
}

module.exports = { checkKeyOutputChains, KEY_OUTPUT_TERMS };
