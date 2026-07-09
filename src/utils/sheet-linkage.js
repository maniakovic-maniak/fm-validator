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
  'AFS', 'IFS', 'Consolidated', 'Balance Sheet', 'BS', 'Cash Flow', 'Cashflow', 'CFS',
  'P&L', 'Profit and Loss', 'Income Statement'
];

// Sheets that are legitimately standalone by design — their whole purpose
// is not to feed forward, so absence from the reachable set is expected,
// not a defect. Extended from an initial list against a real client model
// (Legend, VBA, Disclaimer and (backup) sheets were all real false
// positives there).
const EXCLUDE_KEYWORDS = [
  'cover', 'read me', 'readme', 'toc', 'table of contents', 'instruction',
  'check', 'audit', 'control', 'version', 'change log', 'changelog',
  'glossary', 'note', 'legend', 'vba', 'backup', 'disclaimer'
];

function isFinStatementSheet(name) {
  const lower = name.toLowerCase();
  return FIN_STATEMENT_KEYWORDS.some(kw => {
    const kwLower = kw.toLowerCase();
    // Short/ambiguous keywords (<=3 chars) need a word boundary — the old
    // keyword "Cons" matched inside "Construction Timeline" in a real
    // model we tested against, wrongly treating a supporting schedule as
    // a financial statement. Longer, more specific keywords are safe as
    // plain substrings.
    if (kwLower.length <= 3) {
      const re = new RegExp('(?<![a-z0-9])' + kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i');
      return re.test(name);
    }
    return lower.includes(kwLower);
  });
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

  // Downstream reachability — the reverse question. A sheet a decision-
  // maker reads (a dashboard, a summary) legitimately consumes FROM the
  // financial statements rather than feeding them; it will never appear
  // in the upstream set above, but that's correct behaviour, not a
  // defect. Missing this direction entirely produced real false
  // positives against a real client model (Equity Dashboard, Financial
  // Summary — both legitimate downstream consumers of P&L/Balance Sheet).
  // Built as a reverse index of the SAME dependencyMap: for each sheet S
  // with formulas referencing sheet Y, record Y -> S.
  const reverseMap = {};
  for (const [target, precs] of Object.entries(dependencyMap)) {
    for (const prec of Object.keys(precs)) {
      if (prec === '[EXTERNAL]') continue;
      (reverseMap[prec] = reverseMap[prec] || new Set()).add(target);
    }
  }
  const downstreamQueue = [...finStatementSheets];
  while (downstreamQueue.length) {
    const current = downstreamQueue.shift();
    const dependents = reverseMap[current] || new Set();
    for (const dep of dependents) {
      if (!reachable.has(dep)) {
        reachable.add(dep);
        downstreamQueue.push(dep);
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
      ? 'Static reachability analysis — a sheet listed here has no traceable formula path (direct or indirect, including named ranges) either feeding INTO or being fed BY any detected financial-statement sheet. Dynamic references built via OFFSET/INDIRECT cannot be traced statically; treat listed sheets as review candidates, not a final verdict.'
      : 'Static reachability analysis — every non-excluded sheet has a traceable path to a financial-statement sheet.'
  };
}

module.exports = { detectOrphanSheets, isFinStatementSheet, FIN_STATEMENT_KEYWORDS };
