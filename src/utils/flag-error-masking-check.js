// flag-error-masking-check.js
//
// Found via independent review (Bastick, "Continuing Financial Modelling"):
// a common pattern combines multiple 1/0 "flags" using PRODUCT() as a
// lightweight AND-equivalent — preferred over MIN() specifically because
// MIN() can give non-smooth outputs in optimization contexts. This is a
// genuinely useful, common pattern. But it has a real, easy-to-miss
// failure mode: PRODUCT() cannot trap an error the way an IF() statement
// can. If one of the multiplied terms itself evaluates to an error (most
// commonly #DIV/0! from a ratio-based condition, e.g. testing whether a
// margin or coverage ratio exceeds a threshold), the error propagates
// through the entire product rather than being masked to 0 or 1 — the
// "flag" formula's whole point (producing a clean 0/1 signal) silently
// fails at exactly the moment a genuine underlying problem occurs.
//
// SCOPE, DELIBERATELY NARROW: this project abandoned a related check
// earlier (a broken-provenance-reference check, PR-04) after finding a
// naive version over-matched roughly 158:1 against real models. To avoid
// repeating that mistake, this check only flags a PRODUCT() call whose
// own argument text contains an inline division operator "/" — i.e. the
// division has to be directly embedded in the SAME formula as the
// PRODUCT() call, not requiring this check to trace into other cells'
// formulas to determine whether a referenced flag could itself error.
// This is a conservative, lower-recall trade-off, deliberately: cross-
// cell tracing of "could this referenced cell ever produce an error"
// would require far more context (and far more false-positive risk) than
// this check can safely establish on its own.
//
// A formula already wrapped in IFERROR(...) (anywhere enclosing the
// PRODUCT() call) is correctly NOT flagged — that's the exact protection
// this check is verifying is present, not absent.

const PRODUCT_CALL_RE = /\bPRODUCT\s*\(/i;
const IFERROR_RE = /\bIFERROR\s*\(/i;

/** Finds the full extent of a function call starting at a "NAME(" match,
 * tracking nested parens so the true closing paren is found even across
 * commas (not commas inside a nested function call). Returns the
 * argument text between the parens, or null if unbalanced. */
function extractCallExtent(formula, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < formula.length; i++) {
    if (formula[i] === '(') depth++;
    else if (formula[i] === ')') {
      depth--;
      if (depth === 0) {
        return { argsText: formula.slice(openParenIndex + 1, i), endIndex: i };
      }
    }
  }
  return null; // unbalanced — malformed formula text, skip rather than guess
}

function checkFlagProductErrorMasking(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const formula = cell.formula;
        if (!formula || !PRODUCT_CALL_RE.test(formula)) return;

        const match = PRODUCT_CALL_RE.exec(formula);
        const openParenIndex = formula.indexOf('(', match.index);
        const extent = extractCallExtent(formula, openParenIndex);
        if (!extent) return;

        // The division has to be inline within the PRODUCT() call's own
        // argument text — a bare cell reference like PRODUCT(B5,C5) is
        // NOT flagged, since B5/C5's own formulas are out of scope here.
        if (!extent.argsText.includes('/')) return;

        // Already protected — this is exactly what a correctly-guarded
        // version of this pattern looks like.
        if (IFERROR_RE.test(formula)) return;

        findings.push({
          sheet: ws.name,
          cell: cell.address,
          formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
          note: `${ws.name}!${cell.address} combines flags using PRODUCT(), with a division embedded directly inside the PRODUCT() call. PRODUCT() cannot trap an error the way IF() can — if that division ever produces #DIV/0! (e.g. from a zero denominator), the error propagates through the whole product rather than being masked to a clean 0/1 signal, silently defeating the flag's own purpose at exactly the moment a real underlying problem occurs. Worth wrapping the division in IFERROR() (or restructuring as an explicit IF-based test) if this flag is meant to degrade gracefully rather than surface as a raw Excel error.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a PRODUCT()-based flag-combination formula with an inline division and no IFERROR() protection — PRODUCT() cannot trap an underlying error the way IF() can, so a #DIV/0! inside one term propagates through the whole flag rather than being masked. Deliberately narrow in scope (inline division only, no cross-cell tracing) to keep false-positive risk low.',
  };
}

module.exports = { checkFlagProductErrorMasking };
