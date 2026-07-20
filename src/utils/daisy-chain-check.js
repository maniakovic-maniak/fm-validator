// daisy-chain-check.js — sourced from THREE independent standards:
// FAST 3.06-02 ("Do not create daisy chains; do not link to links"),
// PwC Global Financial Modeling Guidelines (D1, appears twice
// independently in that document), and ICAEW's "How to Review a
// Spreadsheet" (D6): "formulas pull values from other formulas that
// themselves link to a source without alteration, rather than linking
// directly to the original input cell."
//
// A "link" (per FAST's own terminology) is the simplest possible
// formula: a bare reference to a single other cell, with no operators,
// functions, or arithmetic — e.g. "=A1" or "=Timing!C7". A daisy chain
// is a link whose OWN target is also just a bare link, rather than the
// original source calculation or input. The fix is always the same:
// redirect the outer link to point at the ultimate source directly.
//
// METHOD: build a map of every formula cell in the workbook once, then
// for each cell whose formula is a bare link, check whether its target
// is ALSO a bare link. If so, walk the chain to find the true ultimate
// source (for a more useful message) and flag the cell.

function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// Matches a formula that is ENTIRELY a single cell reference — nothing
// else. Deliberately anchored start-to-end: "=A1+1" or "=SUM(A1)" must
// NOT match, only a bare "=A1" (or "=Sheet1!A1", "=$A$1", etc.).
const BARE_LINK_RE = /^(?:(?:'([^']+)'|([A-Za-z0-9_]+))!)?\$?([A-Z]{1,3})\$?(\d+)$/;

function parseBareLink(formula, currentSheet) {
  if (!formula) return null;
  const m = BARE_LINK_RE.exec(formula.trim());
  if (!m) return null;
  const [, quotedSheet, bareSheet, col, row] = m;
  const sheet = (quotedSheet || bareSheet || currentSheet).trim();
  return `${sheet}!${col.toUpperCase()}${row}`;
}

// For fan-in counting: every individual cell reference anywhere in a
// formula, not just bare-link formulas. Sheet-qualified references are
// masked out before the plain-reference pass runs — the same corruption
// class found and fixed in recalc_check.py's _extract_refs (L23) and
// formula-pattern-consistency-check.js earlier this session: a bare
// regex run directly on "Sheet1!B5" text can misinterpret "Sheet1" as if
// "Sheet" + row "1" were itself a cell reference.
//
// SCOPE, disclosed: a range reference (e.g. SUM(A1:A100)) contributes
// only its two endpoints to fan-in counts, not every cell inside the
// range — full range expansion isn't worth the cost here, since the
// candidates this matters for (bare-link target cells) are, by
// definition, single-value holders that would typically be referenced
// individually (as confirmed in the real fan-in example found: a local
// call-up cell referenced inside IF()/SUMIF() criteria arguments, not as
// part of a summed range itself), not commonly summed as part of a range.
const SHEET_QUALIFIED_REF_RE = /(?:'([^']+)'|([A-Za-z0-9_]+))!\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/g;
const PLAIN_CELL_REF_RE = /\$?([A-Z]{1,3})\$?(\d+)/g;

function extractCellRefs(formula, currentSheet) {
  if (!formula) return [];
  const refs = new Set();
  const masked = formula.replace(SHEET_QUALIFIED_REF_RE, (m, qSheet, bSheet, col1, row1, col2, row2) => {
    const sheet = (qSheet || bSheet).trim();
    refs.add(`${sheet}!${col1.toUpperCase()}${row1}`);
    if (col2 && row2) refs.add(`${sheet}!${col2.toUpperCase()}${row2}`);
    return '\u0000'; // masked so the plain-reference pass can't re-match inside/around it
  });
  PLAIN_CELL_REF_RE.lastIndex = 0;
  let m;
  while ((m = PLAIN_CELL_REF_RE.exec(masked)) !== null) {
    refs.add(`${currentSheet}!${m[1].toUpperCase()}${m[2]}`);
  }
  return [...refs];
}

const MAX_CHAIN_DEPTH = 20; // defensive cap — a genuine chain this long would itself be a separate, worse problem

function checkDaisyChains(workbook) {
  const findings = [];

  // Build the formula map once — O(n), reused for every cell's lookup
  // rather than re-scanning the workbook per candidate.
  const formulaByKey = {};
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.formula) formulaByKey[`${ws.name}!${cell.address}`] = cell.formula;
      });
    });
  });

  // FIX #2 (found via further real testing against The Bend, before
  // shipping): a same-sheet-only restriction (an earlier version of this
  // fix) resolved the specific cross-sheet staging-sheet flood, but left
  // a SECOND, closely-related false-positive source: a same-sheet "local
  // call-up" cell (FAST/ICAEW's own term — a single cell that makes one
  // cross-sheet reference, which OTHER same-sheet formulas then reuse,
  // rather than each reaching across individually) still got flagged for
  // every one of its legitimate reusing formulas. Confirmed directly on
  // a real cell: Cashflow!D7 was referenced by 6 different formulas
  // (D13, D14, D15, D21, D44, D82) — real, deliberate reuse, not an
  // accident. The correct signal is FAN-IN, not which sheet is involved:
  // a genuine accidental daisy chain has an intermediate cell used by
  // NOBODY except the one cell chaining through it; a legitimate local
  // reference cell is reused by multiple formulas. This single pass
  // computes fan-in for every cell once, workbook-wide.
  const fanIn = {};
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (!cell.formula) return;
        const selfKey = `${ws.name}!${cell.address}`;
        for (const ref of extractCellRefs(cell.formula, ws.name)) {
          if (ref === selfKey) continue; // a formula's own self-reference (e.g. a malformed circular case) doesn't count as external reuse
          fanIn[ref] = (fanIn[ref] || 0) + 1;
        }
      });
    });
  });

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        const key = `${ws.name}!${cell.address}`;
        const target = parseBareLink(formula, ws.name);
        if (!target || target === key) return; // not a bare link, or a (malformed) self-reference — not this check's concern

        const targetFormula = formulaByKey[target];
        if (!targetFormula) return; // target is a plain value/input — the correct, non-chained case
        const targetIsBareLink = parseBareLink(targetFormula, target.split('!', 1)[0]) !== null;
        if (!targetIsBareLink) return; // target is a real calculation — linking to it directly is fine, not a chain

        // The core fix: only flag when the intermediate target has no
        // real reuse value — referenced by nobody but this one cell.
        if ((fanIn[target] || 0) > 1) return;

        // Confirmed: this cell links to a cell that is ALSO just a link.
        // Walk the chain to find the true ultimate source for a more
        // useful message, capped defensively against a pathological or
        // circular chain.
        let current = target;
        let hops = 1;
        const visited = new Set([key, target]);
        while (hops < MAX_CHAIN_DEPTH) {
          const currentFormula = formulaByKey[current];
          if (!currentFormula) break; // reached a plain value — this is the ultimate source
          const nextSheet = current.split('!', 1)[0];
          const next = parseBareLink(currentFormula, nextSheet);
          if (!next || visited.has(next)) break; // not a further link, or a circular chain — stop here either way
          current = next;
          visited.add(next);
          hops++;
        }

        findings.push({
          sheet: ws.name,
          cell: cell.address,
          formula,
          immediateTarget: target,
          ultimateSource: current,
          hopCount: hops,
          note: `${ws.name}!${cell.address} links to ${target}, which is itself just a link (not a calculation or input) — a daisy chain of at least ${hops} hop(s), ultimately tracing back to ${current}. Redirect ${ws.name}!${cell.address} to reference ${current} directly instead of routing through the intermediate link.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a cell whose formula is a bare reference to another cell that is itself just a bare reference AND has no other real use in the workbook (fan-in of 1 — referenced only by the flagged cell) — a genuine daisy chain, per FAST Standard 3.06-02, PwC\'s Global Financial Modeling Guidelines, and ICAEW\'s "How to Review a Spreadsheet". A target cell referenced by multiple formulas is treated as a legitimate local call-up/Import cell (FAST and ICAEW\'s own term for exactly this pattern) and never flagged, regardless of which sheets are involved. Confirmed via real testing that fan-in, not which sheet is crossed, is the correct signal: two separate false-positive patterns were found and fixed this way — a cross-sheet staging sheet (1,125 false positives) and a same-sheet local call-up cell referenced by 6 other formulas — both resolved by requiring fan-in of exactly 1.',
  };
}

module.exports = { checkDaisyChains };
