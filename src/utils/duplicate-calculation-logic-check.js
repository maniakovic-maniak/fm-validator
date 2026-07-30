// duplicate-calculation-logic-check.js — a Tier 0 deterministic
// complement to the (necessarily manual_only) Tier 2 rule T2-S1-004
// "No duplicated calculation logic across sheets". Tier 2 operates in
// Mode A (extracted values and structure only, per this project's own
// architecture — see soul.md) and has no access to formula text at
// all, so it fundamentally cannot verify from values alone whether two
// matching numbers arose from a proper link or from the same
// calculation being independently rebuilt. This check has full formula
// text access via ExcelJS and can verify it directly.
//
// Grounded in a real best-practice principle, not an invented one:
// RÖDL's "10 Golden Rules of Financial Modeling" states plainly —
// "Intermediate and final results should be calculated only once and
// then linked to avoid redundancies and errors." That is the actual
// distinction this check is built around:
//   - CORRECT, expected structure: a detail table with a local
//     aggregate (e.g. =SUM(B5:B8)), and every other sheet that needs
//     that total simply LINKS to it (=Inputs!B9) — a bare reference,
//     doing nothing but relaying a value.
//   - THE GENUINE RISK: the exact same aggregate — the same function,
//     over the exact same precedent range — is independently rebuilt
//     as its own formula on a second sheet, rather than one sheet
//     computing it and the other linking to that result. If the
//     detail table later changes (a row added, a range extended), one
//     copy may get updated and the other silently left behind.
//
// Deliberately conservative on scope, directly responding to real
// feedback that a naive version would over-flag: only formulas using a
// genuine AGGREGATE function (SUM, SUMIF, SUMIFS, AVERAGE, AVERAGEIF,
// COUNT, COUNTA, COUNTIF, MAX, MIN, SUBTOTAL) over an identical
// precedent range are compared — never bare single-cell references
// (which are exactly the correct "link" pattern this check must not
// penalize), and never row-to-row repetition within the same sheet
// (already covered by formula-pattern-consistency-check.js and
// column-pattern-consistency-check.js — this check is specifically
// about the same aggregate appearing on two DIFFERENT sheets).

const AGGREGATE_FN_RE = /\b(SUM|SUMIF|SUMIFS|AVERAGE|AVERAGEIF|AVERAGEIFS|COUNT|COUNTA|COUNTIF|COUNTIFS|MAX|MIN|SUBTOTAL)\s*\(/i;

// Extracts sheet-qualified and bare range/cell arguments from inside a
// function call's argument list, normalized to a canonical, order-
// independent signature — case-insensitive, $ stripped, sorted.
const RANGE_ARG_RE = /(?:(?:'([^']+)'|([A-Za-z0-9_]+))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;

function extractCallExtent(formula, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < formula.length; i++) {
    if (formula[i] === '(') depth++;
    else if (formula[i] === ')') {
      depth--;
      if (depth === 0) return { argsText: formula.slice(openParenIndex + 1, i), endIndex: i + 1 };
    }
  }
  return null;
}

function buildSignature(argsText, ownSheet) {
  const tokens = [];
  RANGE_ARG_RE.lastIndex = 0;
  let m;
  while ((m = RANGE_ARG_RE.exec(argsText)) !== null) {
    const [, quotedSheet, bareSheet, col1, row1, col2, row2] = m;
    const sheet = (quotedSheet || bareSheet || ownSheet).trim().toLowerCase();
    const range = col2 ? `${col1}${row1}:${col2}${row2}` : `${col1}${row1}`;
    tokens.push(`${sheet}!${range}`);
  }
  if (tokens.length === 0) return null;
  return tokens.sort().join('|');
}

// Extracts the (sheet, row) pair from a "sheet!CELL" or "sheet!CELL:CELL"
// occurrence string, for row-level aggregation independent of column.
function sheetRowOf(occurrence) {
  const [sheet, ref] = occurrence.split('!');
  const m = /^\$?([A-Z]{1,3})\$?(\d+)/.exec(ref);
  return m ? `${sheet}::${m[2]}` : occurrence;
}

function checkDuplicateCalculationLogic(workbook) {
  const bySignature = new Map(); // signature -> [{sheet, cell, formula, fnName}]

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        const fnMatch = AGGREGATE_FN_RE.exec(formula);
        if (!fnMatch) return; // not an aggregate function at all — includes bare references, the correct "link" pattern

        const openParenIndex = formula.indexOf('(', fnMatch.index);
        const extent = extractCallExtent(formula, openParenIndex);
        if (!extent) return;
        const signature = buildSignature(extent.argsText, ws.name);
        if (!signature) return;

        const key = fnMatch[1].toUpperCase() + '::' + signature;
        if (!bySignature.has(key)) bySignature.set(key, []);
        bySignature.get(key).push({ sheet: ws.name, cell: cell.address, formula, fnName: fnMatch[1].toUpperCase() });
      });
    });
  });

  // FIX: found via investigating a real production report — 62 of 71
  // findings this check produced were all the same underlying row-
  // level duplication (Underwriting row 228/229 vs VALUATION & RETURNS
  // row 27/29), just shifted by one period-column each time, since
  // each period column's literal precedent range (L228 vs M228 vs
  // N228...) builds a genuinely different exact-range signature above.
  // Groups those signature-level groups a second time by the
  // underlying (sheet, row) pairs involved — independent of which
  // specific column each occurrence sits in — so period-column
  // repetition of the same row-level defect collapses into one
  // finding with an instance count, the same fix already applied to
  // total-range-check.js and daisy-chain-check.js for this exact bug
  // class (R-16).
  const byRowPattern = new Map(); // "fnName::sorted (sheet,row) pairs" -> [{occurrences, sample}]

  for (const [, occurrences] of bySignature) {
    const distinctSheets = new Set(occurrences.map(o => o.sheet));
    if (distinctSheets.size < 2) continue; // same aggregate repeated down a column on ONE sheet is a different, already-covered concern
    if (occurrences.length < 2) continue;

    const rowPairs = [...new Set(occurrences.map(o => sheetRowOf(`${o.sheet}!${o.cell}`)))].sort();
    const rowPatternKey = occurrences[0].fnName + '::' + rowPairs.join('|');
    if (!byRowPattern.has(rowPatternKey)) byRowPattern.set(rowPatternKey, []);
    byRowPattern.get(rowPatternKey).push({ distinctSheets, occurrences });
  }

  const findings = [];
  for (const [, groups] of byRowPattern) {
    const sampleGroup = groups[0];
    const sample = sampleGroup.occurrences.slice(0, 5);
    const totalOccurrences = groups.reduce((sum, g) => sum + g.occurrences.length, 0);
    findings.push({
      sheets: [...sampleGroup.distinctSheets],
      occurrences: sampleGroup.occurrences.map(o => `${o.sheet}!${o.cell}`),
      fnName: sampleGroup.occurrences[0].fnName,
      instanceCount: groups.length,
      note: `The same ${sampleGroup.occurrences[0].fnName}() aggregate, over the exact same precedent range, is independently computed in ${sampleGroup.occurrences.length} separate location(s) across ${sampleGroup.distinctSheets.size} different sheets: ${sample.map(o => `${o.sheet}!${o.cell}`).join(', ')}${sampleGroup.occurrences.length > 5 ? ' and others' : ''}${groups.length > 1 ? ` (and ${groups.length - 1} other period-column instance(s) of this same row-level pattern, ${totalOccurrences} total cells across all periods)` : ''}. Per standard financial-modelling practice, an intermediate or final result should be calculated once and then linked elsewhere — not independently rebuilt. If the underlying detail range changes later (a row added, a period extended), one copy may be updated while the other is silently left behind. Confirm whether one of these should instead be a simple reference to the other.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags the same aggregate function (SUM, SUMIF, AVERAGE, COUNT, MAX, MIN, SUBTOTAL, etc.), over the exact same precedent range, independently computed as its own formula on two or more different sheets — rather than computed once and linked. Deliberately excludes bare single-cell/range references (the correct "link" pattern) and same-sheet row/column repetition (already covered by formula-pattern-consistency-check.js and column-pattern-consistency-check.js).',
  };
}

module.exports = { checkDuplicateCalculationLogic };
