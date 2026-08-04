// mismatched-basis-comparison-check.js
//
// Found via an independent review (ER-006, ER-007): Underwriting!C290
// is ROUND(C61,3)=ROUND(F61,3), where C61 is a simple direct link
// ('FUNDING & CAP TABLE'!$I$20 = a fixed 50% target) and F61 is a
// computed ratio (I61/Project_Cost_Total = ~52.4%, a different
// denominator/basis entirely). C291 similarly compares a static 3.00%
// target (a direct link, +G135) against an averaged actual fee rate
// (ROUND(AVERAGE(K291:EN291),4) = ~0.49%). Confirmed directly: both
// are genuinely, structurally comparing a fixed TARGET concept against
// a differently-computed ACTUAL concept — not two independently
// derived measures of the same thing that should agree if the model
// is correct.
//
// This does not mean the two values are wrong — it means the equality
// TEST itself is comparing concepts on different bases, so a mismatch
// here doesn't necessarily indicate anything is broken in the
// underlying figures, and a "pass" would arguably be coincidental
// rather than meaningful. Flagged as a control-design finding, not a
// value-defect finding.

const ROUND_EQ_RE = /ROUND\(\s*([^,()]+)\s*,\s*\d+\s*\)\s*=\s*ROUND\(\s*([^,()]+)\s*,\s*\d+\s*\)/gi;
const SIMPLE_LINK_RE = /^[+\-]?\$?(?:'[^']+'!|[A-Za-z0-9_]+!)?\$?[A-Z]{1,3}\$?\d+$/;
const COMPUTED_RE = /\/|AVERAGE\s*\(/i;

// Resolves a same-sheet cell reference like "C61" (optionally $-
// anchored) against the given worksheet, returning its formula text
// or null if it isn't a simple, resolvable same-sheet reference.
function resolveSameSheetFormula(ws, ref) {
  const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const cell = ws.getCell(ref.trim().replace(/\$/g, ''));
  return cell.formula || null;
}

function checkMismatchedBasisComparison(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula || !/ROUND/i.test(formula)) return;

        ROUND_EQ_RE.lastIndex = 0;
        let m;
        while ((m = ROUND_EQ_RE.exec(formula))) {
          const [, argA, argB] = m;
          // Only handle simple, same-sheet cell-reference arguments —
          // anything more complex (a nested expression as the ROUND
          // argument itself) is left alone rather than guessed at.
          const formulaA = resolveSameSheetFormula(ws, argA);
          const formulaB = resolveSameSheetFormula(ws, argB);
          if (!formulaA || !formulaB) continue;

          const aIsSimpleLink = SIMPLE_LINK_RE.test(formulaA.trim());
          const bIsSimpleLink = SIMPLE_LINK_RE.test(formulaB.trim());
          const aIsComputed = COMPUTED_RE.test(formulaA);
          const bIsComputed = COMPUTED_RE.test(formulaB);

          // Exactly one side must be a simple link and the OTHER must
          // be a computed division/average — this is what distinguishes
          // "a fixed target vs. a differently-based actual" from two
          // ordinary linked or computed values being compared, which
          // is a completely unremarkable, common pattern not worth
          // flagging.
          let linkArg = null, computedArg = null, linkFormula = null, computedFormula = null;
          if (aIsSimpleLink && bIsComputed && !bIsSimpleLink) { linkArg = argA; computedArg = argB; linkFormula = formulaA; computedFormula = formulaB; }
          else if (bIsSimpleLink && aIsComputed && !aIsSimpleLink) { linkArg = argB; computedArg = argA; linkFormula = formulaB; computedFormula = formulaA; }
          else continue;

          findings.push({
            sheet: ws.name, cell: cell.address,
            linkArg: linkArg.trim(), computedArg: computedArg.trim(),
            linkFormula, computedFormula,
            note: `${ws.name}!${cell.address} tests ROUND-equality between ${linkArg.trim()} (a direct link: ${linkFormula}) and ${computedArg.trim()} (a computed value: ${computedFormula}). One side is a fixed target reached by simple reference; the other is independently computed, potentially on a different denominator or via averaging. These are structurally likely to be different concepts being compared for equality rather than two independent derivations of the same figure — confirm both sides genuinely represent the same basis before treating a FAIL here as a value defect rather than a control-design issue.`,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} control formula(s) compare a simple direct-link target against a differently-computed actual (division or averaging) for exact equality.`
      : 'No ROUND-equality control was found comparing a simple link against a computed division/average on a different basis.',
  };
}

module.exports = { checkMismatchedBasisComparison };
