// embedded-error-branch-check.js — sourced from Plum Solutions/Mazars
// "Top 10 Errors" (fm-validator book-mining D3, error #1: "Hash errors —
// IF(AND(L$2>=$E8,L$3<=$F8),1,#REF!)"), independently confirmed by FAST
// Standard 3.03-11 ("Beware circularity or #ERRORs protected on inactive
// branch of IF function") — two sources for the same pattern.
//
// A literal Excel error string wired directly into an IF() branch is
// dormant as long as the branch is never taken — it produces no visible
// error today, but will surface the instant the condition flips (a date
// range shifts, a flag changes, a scenario switches). FAST 3.03-11 notes
// this specific danger explicitly: "Model audit software will often not
// detect this problem either" — a direct, named gap this check closes.
//
// Deliberately narrow: only checks IF() calls, and only flags a branch
// that is EXACTLY one of the seven Excel error literals (not a formula
// that might merely evaluate to one) — a clean, unambiguous, low-noise
// signal rather than an attempt to infer intent.

const ERROR_LITERALS = new Set(['#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NAME?', '#NULL!', '#NUM!']);
const IF_CALL_RE = /\bIF\s*\(/gi;

/** Finds the full extent of a call starting at a "NAME(" match, respecting
 * nested parentheses. Returns { argsText, endIndex } or null if
 * parentheses are unbalanced (malformed/truncated formula text — skip
 * rather than guess), matching the same pattern already used in
 * formula-logic-checks.js. */
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
  return null;
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

function checkEmbeddedErrorBranches(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        // Reset lastIndex since IF_CALL_RE is a global regex reused
        // across cells — a fresh formula could otherwise start matching
        // partway through from a previous cell's leftover state.
        IF_CALL_RE.lastIndex = 0;
        let match;
        while ((match = IF_CALL_RE.exec(formula)) !== null) {
          const openParenIndex = formula.indexOf('(', match.index);
          const extent = extractCallExtent(formula, openParenIndex);
          if (!extent) continue; // malformed — skip rather than guess

          const args = splitTopLevelArgs(extent.argsText);
          // args[0] is the condition; args[1]/args[2] are the TRUE/FALSE
          // branches (args[2] may be absent — IF() with no FALSE branch
          // defaults to FALSE, not an error literal, so nothing to check
          // there in that case).
          for (let i = 1; i < args.length && i <= 2; i++) {
            const branch = args[i].trim().toUpperCase();
            if (ERROR_LITERALS.has(branch)) {
              findings.push({
                sheet: ws.name,
                cell: cell.address,
                formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
                errorLiteral: branch,
                branchPosition: i === 1 ? 'TRUE' : 'FALSE',
                note: `${ws.name}!${cell.address} has ${branch} wired directly into the ${i === 1 ? 'TRUE' : 'FALSE'} branch of an IF() call. This produces no visible error today as long as that branch is never taken, but will surface the instant the underlying condition flips (a date range shifts, a flag changes, a scenario switches) — and, per FAST Standard 3.03-11, this pattern is one that model audit software commonly fails to catch, since the cell shows no error under current conditions.`,
              });
            }
          }
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags IF() calls with a literal Excel error string (#REF!, #VALUE!, #DIV/0!, #N/A, #NAME?, #NULL!, #NUM!) wired directly into a TRUE or FALSE branch — dormant until the condition flips. Only exact error-literal branches are flagged, not formulas that might merely evaluate to an error; this is a narrow, low-noise, unambiguous signal.',
  };
}

module.exports = { checkEmbeddedErrorBranches };
