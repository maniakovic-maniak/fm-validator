// error-literal-in-formula-check.js — sourced from the Operis Analysis
// Kit manual's "Error constants" section (found in a book-mining
// pass): "Besides numeric constants... and text constants... Excel
// permits a handful of other constants to be present in a formula...
// the error values, #N/A!, #DIV/0, #REF!, and #NUM!... Most of the
// time, their presence in a formula is the result of an error. The
// most common example is when a formula mentions a range that is
// later deleted; Excel changes the reference to #REF!."
//
// Deliberately complementary to embedded-error-branch-check.js, which
// already covers the narrower case of an error literal as the ENTIRE
// content of an IF() TRUE/FALSE branch (sourced independently from
// Plum Solutions/Mazars and FAST 3.03-11). This check explicitly
// excludes that exact pattern — a bare error literal that IS the whole
// of an IF() branch argument — to avoid reporting the same cell twice
// under two different check IDs. Everything else (an error literal as
// an arithmetic term, inside SUM/other function arguments, anywhere
// else in a formula) is this check's actual scope, matching Operis's
// own broader framing: any bare error constant appearing in formula
// text at all, not just inside an IF().

const ERROR_LITERALS = ['#REF!', '#VALUE!', '#DIV/0!', '#N/A', '#NAME?', '#NULL!', '#NUM!'];
// Matches any of the 7 error literals as a standalone token — not
// preceded/followed by a word character, so "#REF!" inside a longer
// identifier-like string can't spuriously match (this is a defensive
// bound; Excel error tokens don't appear inside identifiers in
// practice, but the boundary keeps the regex honest either way).
const ERROR_LITERAL_RE = new RegExp(
  '(?<![\\w])(' + ERROR_LITERALS.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\w])',
  'g'
);

const IF_CALL_RE = /\bIF\s*\(/gi;

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

function splitTopLevelArgs(argsText) {
  const args = [];
  let depth = 0;
  let current = '';
  for (const ch of argsText) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; }
    else current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// Replays embedded-error-branch-check.js's own IF()-branch scan just
// far enough to know which character ranges within a formula are
// "the entire content of an IF() TRUE/FALSE branch" — so this check
// can exclude exactly that overlap, not approximate it.
function findIfBranchExactSpans(formula) {
  const spans = [];
  IF_CALL_RE.lastIndex = 0;
  let match;
  while ((match = IF_CALL_RE.exec(formula)) !== null) {
    const openParenIndex = formula.indexOf('(', match.index);
    const extent = extractCallExtent(formula, openParenIndex);
    if (!extent) continue;
    const args = splitTopLevelArgs(extent.argsText);
    // Reconstruct each arg's actual start offset within the original
    // formula string (splitTopLevelArgs only returns trimmed text,
    // not positions) by searching for it within the argsText region.
    let searchFrom = 0;
    for (let i = 1; i < args.length && i <= 2; i++) {
      const argText = args[i];
      const idxInArgs = extent.argsText.indexOf(argText, searchFrom);
      if (idxInArgs === -1) continue;
      const absoluteStart = openParenIndex + 1 + idxInArgs;
      spans.push([absoluteStart, absoluteStart + argText.length]);
      searchFrom = idxInArgs + argText.length;
    }
  }
  return spans;
}

function stripStringLiterals(formula) {
  return formula.replace(/"[^"]*"/g, m => ' '.repeat(m.length));
}

function checkErrorLiteralInFormula(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;

        const cleanFormula = stripStringLiterals(formula);
        const ifBranchSpans = findIfBranchExactSpans(formula);

        ERROR_LITERAL_RE.lastIndex = 0;
        let m;
        while ((m = ERROR_LITERAL_RE.exec(cleanFormula)) !== null) {
          const matchStart = m.index;
          const matchEnd = m.index + m[0].length;
          // Skip if this exact match IS the entire content of an IF()
          // branch — already covered by embedded-error-branch-check.js.
          const isWholeIfBranch = ifBranchSpans.some(([s, e]) => s === matchStart && e === matchEnd);
          if (isWholeIfBranch) continue;

          findings.push({
            sheet: ws.name,
            cell: cell.address,
            formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
            errorLiteral: m[0],
            note: `${ws.name}!${cell.address} contains the literal error constant ${m[0]} directly in its formula text ("${formula.length > 100 ? formula.slice(0, 100) + '…' : formula}"). Per Operis's own guidance, this is most commonly the result of a formula referencing a range that was later deleted — Excel automatically rewrites the dead reference to this literal error token. Confirm whether this is a genuine, intentional error constant or a stale reference left behind by a deletion.`,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a bare Excel error literal (#REF!, #VALUE!, #DIV/0!, #N/A, #NAME?, #NULL!, #NUM!) appearing directly in a formula\'s text, most commonly left behind when a referenced range is deleted. Deliberately excludes the case where the literal is the entire content of an IF() TRUE/FALSE branch — that narrower, independently-sourced pattern is already covered by embedded-error-branch-check.js. String literals (quoted text) are excluded so a genuine text mention is never mistaken for a live broken reference.',
  };
}

module.exports = { checkErrorLiteralInFormula };
