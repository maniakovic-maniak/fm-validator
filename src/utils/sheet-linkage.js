// Orphan sheet detection — deterministic, zero API cost.
//
// The inverse of redundant-input detection: instead of asking "is this
// INPUT CELL used by anything", this asks "does this entire SHEET's
// output ever reach the financial statements". A sheet that calculates
// real numbers but never feeds forward (the GST-tab scenario) is a more
// serious failure than a single unused input — it means a whole area of
// the model has no influence on the numbers a decision-maker sees.
//
// Method: identify financial-statement sheets by name (same keyword
// convention already used by checklist T1-002/T1-004/T1-005), then walk
// the sheet dependency graph backward from those sheets to find every
// sheet that transitively feeds them. Anything left over — excluding
// sheets that are legitimately standalone (cover pages, checks, docs) —
// is reported as an orphan.
//
// Consumes the SAME dependencyMap Tier 0 already builds (now including
// named-range resolution) rather than re-scanning the workbook, so this
// stays consistent with what the Sheet Dependency tab displays and adds
// no extra scan cost.

const FIN_STATEMENT_KEYWORDS = [
  'AFS', 'IFS', 'Cons', 'Balance Sheet', 'BS', 'Cash Flow', 'CFS',
  'P&L', 'Profit and Loss', 'Income Statement'
];

const EXCLUDE_KEYWORDS = [
  'cover', 'read me', 'readme', 'toc', 'table of contents', 'instruction',
  'check', 'audit', 'control', 'version', 'change log', 'changelog',
  'glossary', 'note'
];

function isFinStatementSheet(name) {
  return FIN_STATEMENT_KEYWORDS.some(kw => name.toLowerCase().includes(kw.toLowerCase()));
}

function isExcludedSheet(name) {
  const lower = name.toLowerCase();
  return EXCLUDE_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * @param {object} dependencyMap  {targetSheet: {precedentSheet: linkCount}}
 *   — target's formulas reference precedent. Same shape Tier 0 already
 *   builds and exposes as part of its result.
 * @param {string[]} allSheetNames
 * @param {object} inputSheetNames  optional — sheets already classified as
 *   input/assumption sheets (from redundant-inputs.js), excluded from the
 *   "orphan calculation sheet" framing since an unused input sheet is a
 *   distinct finding type already covered elsewhere.
 */
function detectOrphanSheets(dependencyMap, allSheetNames, inputSheetNames = []) {
  const finStatementSheets = allSheetNames.filter(isFinStatementSheet);

  if (finStatementSheets.length === 0) {
    return {
      applicable: false,
      financialStatementSheets: [],
      orphanSheets: [],
      reachableSheets: [],
      totalSheets: allSheetNames.length,
      note: 'No sheet matching financial-statement naming (AFS/IFS/Balance Sheet/Cash Flow/P&L) was detected — orphan-sheet analysis not applicable.'
    };
  }

  // Reverse reachability: BFS from each financial-statement sheet, walking
  // dependencyMap[current] to find its precedents, recursively.
  const reachable = new Set(finStatementSheets);
  const queue = [...finStatementSheets];
  while (queue.length) {
    const current = queue.shift();
    const precedents = dependencyMap[current] || {};
    for (const prec of Object.keys(precedents)) {
      if (prec === '[EXTERNAL]') continue;
      if (!reachable.has(prec)) {
        reachable.add(prec);
        queue.push(prec);
      }
    }
  }

  const inputSet = new Set(inputSheetNames);
  const orphanSheets = allSheetNames.filter(name =>
    !reachable.has(name) && !isExcludedSheet(name) && !inputSet.has(name)
  );

  return {
    applicable: true,
    financialStatementSheets: finStatementSheets,
    reachableSheets: [...reachable],
    orphanSheets,
    totalSheets: allSheetNames.length,
    note: orphanSheets.length > 0
      ? 'Static reachability analysis — a sheet listed here has no traceable formula path (direct or indirect, including named ranges) to any detected financial-statement sheet. Dynamic references built via OFFSET/INDIRECT cannot be traced statically; treat listed sheets as review candidates, not a final verdict.'
      : 'Static reachability analysis — every non-excluded sheet has a traceable path to a financial-statement sheet.'
  };
}

module.exports = { detectOrphanSheets, isFinStatementSheet, FIN_STATEMENT_KEYWORDS };
