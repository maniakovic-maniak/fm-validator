// formula-logic-checks.js — deterministic formula-LOGIC checks, distinct
// from formula-VALUE checks.
//
// NOTE ON NAMING: this project's own code comments already use "A2" (SUM()
// range exclusion) and "A3" (sign-convention) for a DIFFERENT numbering
// scheme than the Phase D adoption plan's "A2 — Formualizer-based
// formula-logic checks". Both schemes independently reuse A1/A2/A3 for
// different things (A1 happens to coincide — Formualizer recalculation in
// both — A2/A3 do not). Deliberately not using the bare "A2" shorthand
// anywhere in this file to avoid creating a THIRD collision — see fm-
// validator project chat history ("Continuing wave 2 report changes" vs.
// the docx-derived "audit-xls" plan) for the full account of how this
// ambiguity has caused real confusion before.
//
// WHY THIS IS A SEPARATE CATEGORY FROM recalc_check.py (A1): A1 catches a
// wrong REFERENCE or WIRING — a formula that recalculates to a DIFFERENT
// value than its own cached result, because Formualizer resolves it
// differently than Excel did. The checks in this file catch the opposite
// class of problem: a formula that recalculates to EXACTLY the same value
// it's supposed to (no mismatch, nothing for A1 to ever find), but whose
// own structure embodies a financially-wrong pattern regardless — e.g. an
// NPV() call that includes the period-0 investment inside its own range,
// discounting it by one period it shouldn't be discounted by. No amount of
// recalculation comparison catches this, because the "wrong" formula and
// Excel agree with each other perfectly; the error is in what the formula
// was built to represent, not in how it was evaluated.
//
// SOURCE: both rules below trace directly to a concrete worked example in
// "Mastering Advanced Excel Formulas and Functions" (Harjit Suman) — see
// fm-validator project chat history, book-mining findings L19 and L20.
//
// SCOPE, DELIBERATELY NARROW: both rules only handle simple, single-area,
// same-sheet ranges — matching this project's own established discipline
// (see total-range-check.js) of skipping anything more complex rather than
// guessing at it. Multi-area ranges (IRR(C5:C10,C15:C20)), cross-sheet
// ranges, and ranges built via INDIRECT/OFFSET are out of scope for this
// first pass and are silently skipped, not flagged as clean.

// Matches "NPV(" or "IRR(" as a function call start, case-insensitive,
// optionally preceded by a sheet-qualifying nothing (both are always
// unqualified function names in Excel, never "Sheet1!NPV(").
const NPV_CALL_RE = /\bNPV\s*\(/i;
const IRR_CALL_RE = /\bIRR\s*\(/i;

// A simple, single-area, same-sheet range like "C5:C60" or "C5" (a lone
// cell) — deliberately does not attempt to match cross-sheet
// ("Sheet1!C5:C60") or multi-area ("C5:C10,C15:C20") ranges; those are
// left alone rather than mishandled.
const SIMPLE_RANGE_RE = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/i;

function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// FIX (found via testing against real files, not just synthetic cells):
// a FORMULA cell's .value in ExcelJS is an object — {formula, result} or
// {sharedFormula, result} for a shared-formula cell — not a plain number.
// `typeof cell.value === 'number'` is only true for a cell holding a
// literal, non-formula number. Confirmed directly: every IRR() range
// sampled from Carlsberg and The Bend is built entirely from FORMULA
// cells, so a naive typeof check silently treated every one of them as
// non-numeric, making this check bail out via "range is empty/non-
// numeric" on ranges that genuinely do (or don't) contain a negative —
// the check was never actually seeing the numbers at all.
function getNumericValue(cell) {
  const v = cell.value;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && typeof v.result === 'number') return v.result;
  return null;
}

/** Finds the full extent of a function call starting at a "NAME(" match,
 * respecting nested parentheses, and splits its arguments on top-level
 * commas (not commas inside a nested function call). Returns
 * { argsText, endIndex } where endIndex is the index just past the
 * call's closing ")", or null if parentheses are unbalanced (malformed
 * formula text — skip rather than guess). */
function extractCallExtent(formula, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < formula.length; i++) {
    if (formula[i] === '(') depth++;
    else if (formula[i] === ')') {
      depth--;
      if (depth === 0) {
        return { argsText: formula.slice(openParenIndex + 1, i), endIndex: i + 1 };
      }
    }
  }
  return null; // unbalanced — malformed or truncated formula text, skip
}

function splitTopLevelArgs(argsText) {
  const args = [];
  let depth = 0;
  let current = '';
  for (const ch of argsText) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// ── Rule 1 (L19): NPV period-0 inclusion risk ───────────────────────────
//
// A correctly-built NPV formula almost always looks like
// "=NPV(rate, C6:C60) + C5" — the period-0 investment (C5) added
// SEPARATELY, outside and un-discounted, because NPV()'s own summation
// treats its FIRST value as occurring one period from now, not now. If
// the entire formula is just "=NPV(rate, range)" with nothing added
// outside it, that's the specific risk pattern the source (Suman) calls
// out explicitly: the period-0 investment may have been folded into the
// NPV range itself, where it would be silently discounted by one extra
// period it shouldn't be.
//
// This is a TEXT-STRUCTURE check, not a values check: it flags "no visible
// separate addition", not "the range definitely includes period 0" — it
// cannot know which column represents period 0 without semantic knowledge
// of the model's own timeline, which is out of scope for a deterministic
// check. Framed as a verification prompt, not an assertion of error.
function checkNpvPeriodZeroRisk(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const formula = cell.formula;
        if (!formula || !NPV_CALL_RE.test(formula)) return;

        const match = NPV_CALL_RE.exec(formula);
        const openParenIndex = formula.indexOf('(', match.index);
        const extent = extractCallExtent(formula, openParenIndex);
        if (!extent) return; // malformed — skip rather than guess

        const before = formula.slice(0, match.index).trim();
        const after = formula.slice(extent.endIndex).trim();

        // "NPV(...)" with nothing before it (or just a bare "+"/"-" sign
        // — ExcelJS's cell.formula has no leading "=", confirmed via
        // direct testing) and nothing after it at all is the risk
        // pattern. Anything else — "NPV(...)+C5", "C5+NPV(...)",
        // "NPV(...)*1000", nested inside another function, etc. — has
        // SOME surrounding structure that at least plausibly represents
        // the separate period-0 handling (or is different enough in
        // shape that this narrow check shouldn't guess at it either
        // way), so it's left alone.
        const beforeIsJustEquals = /^[-+]?\s*$/.test(before);
        const afterIsEmpty = after === '';

        if (beforeIsJustEquals && afterIsEmpty) {
          findings.push({
            sheet: ws.name,
            cell: cell.address,
            formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
            note: `${ws.name}!${cell.address} is an NPV() formula with no separate term added outside the NPV() call. NPV()'s own summation treats its first value as occurring one period from now — if the value range passed to this NPV() includes the period-0 (initial) investment, it would be incorrectly discounted by one extra period. Confirm the range starts at period 1, not period 0, and that any period-0 investment is added separately outside this NPV() call (the standard correct pattern is "=NPV(rate, period_1_onward_range) + period_0_cell"). NOTE: this is a distinct risk from NPV()'s implicit even-period-spacing assumption (flagged separately, if applicable, as NPV-vs-XNPV timing) — switching this formula to XNPV would NOT resolve this specific finding, since XNPV has the identical period-0-must-be-added-separately requirement.`,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags NPV() formulas with no visible separate addition for a period-0 investment — a structural risk pattern, not a confirmed error. Cannot determine from formula text alone whether the NPV range actually includes period 0; this requires the model\'s own timeline to be checked against the flagged range.',
  };
}

// ── Rule 2 (L20): IRR negative-cash-flow risk ───────────────────────────
//
// IRR() requires its value range to contain at least one negative number
// (the initial investment) — without one, Excel returns #NUM!. This check
// looks at the CACHED VALUES in a simple, single-area IRR() range and
// flags ranges with no negative value at all — either a genuine missing-
// investment model defect, or (given this project's own documented
// Formualizer limitation around IRR()) a useful diagnostic BEFORE
// attributing an IRR-related unresolved_error purely to that known
// library limitation — this check can confirm or rule out a real
// underlying cause independently.
function checkIrrNegativeCashFlowRisk(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const formula = cell.formula;
        if (!formula || !IRR_CALL_RE.test(formula)) return;

        const match = IRR_CALL_RE.exec(formula);
        const openParenIndex = formula.indexOf('(', match.index);
        const extent = extractCallExtent(formula, openParenIndex);
        if (!extent) return;

        const args = splitTopLevelArgs(extent.argsText);
        if (args.length === 0) return;
        const rangeArg = args[0].trim();

        const rangeMatch = SIMPLE_RANGE_RE.exec(rangeArg);
        if (!rangeMatch) return; // cross-sheet, multi-area, or non-literal range — skip, don't guess

        const [, col1, row1Str, col2, row2Str] = rangeMatch;
        const c1 = colToNum(col1);
        const r1 = parseInt(row1Str, 10);
        const c2 = col2 ? colToNum(col2) : c1;
        const r2 = row2Str ? parseInt(row2Str, 10) : r1;
        const colLo = Math.min(c1, c2), colHi = Math.max(c1, c2);
        const rowLo = Math.min(r1, r2), rowHi = Math.max(r1, r2);

        // Same "skip pathologically large ranges" discipline as
        // recalc_check.py's own _extract_refs — not worth the cost, and a
        // range this large is very unlikely to be a genuine IRR cash-flow
        // series anyway (real cash-flow series are typically tens to a
        // few hundred periods, not thousands).
        if ((colHi - colLo + 1) * (rowHi - rowLo + 1) > 2000) return;

        let hasNegative = false;
        let hasAnyNumeric = false;
        for (let r = rowLo; r <= rowHi; r++) {
          for (let c = colLo; c <= colHi; c++) {
            const v = getNumericValue(ws.getCell(r, c));
            if (v !== null) {
              hasAnyNumeric = true;
              if (v < 0) { hasNegative = true; break; }
            }
          }
          if (hasNegative) break;
        }
        if (!hasAnyNumeric) return; // range is empty/non-numeric — not this check's concern

        if (!hasNegative) {
          findings.push({
            sheet: ws.name,
            cell: cell.address,
            formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
            range: `${col1}${r1}:${col2 || col1}${r2 || r1}`,
            note: `${ws.name}!${cell.address} calls IRR() over ${col1}${r1}:${col2 || col1}${r2 || r1}, but every value currently in that range is zero or positive. IRR() requires at least one negative value (the initial investment/outflow) to be mathematically defined — Excel returns #NUM! without one. If this model shows a real IRR-related error here, check whether the initial investment is genuinely missing or zero before attributing the error to any recalculation-engine limitation.`,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags IRR() calls over a simple range containing no negative value — IRR is mathematically undefined without at least one negative cash flow. Only evaluates simple, single-area, same-sheet ranges; cross-sheet, multi-area, and non-literal (INDIRECT/OFFSET-built) ranges are skipped, not guessed at.',
  };
}

module.exports = { checkNpvPeriodZeroRisk, checkIrrNegativeCashFlowRisk };
