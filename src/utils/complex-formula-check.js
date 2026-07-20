// complex-formula-check.js — sourced from PwC Global Financial Modeling
// Guidelines (D1): a formula with 3 or more parentheses is considered
// complex enough to warrant review.
//
// HONEST NOTE ON EXPECTED VOLUME: this threshold, applied literally,
// will also fire on extremely common, unremarkable patterns —
// IFERROR(INDEX(range,MATCH(...)),0) already has 3 opening parentheses
// (IFERROR, INDEX, MATCH) despite being a completely standard lookup
// idiom, not a readability problem. This check is deliberately shipped
// at low confidence and framed as "worth a glance," not "likely wrong" —
// it is PwC's own stated threshold, applied as specified rather than
// silently raised to dodge the noise, but the person reading a finding
// from this check should expect many, possibly most, hits to be normal.

function countOpenParens(formula) {
  let count = 0;
  for (const ch of formula) if (ch === '(') count++;
  return count;
}

const COMPLEXITY_THRESHOLD = 3;

function checkComplexFormulas(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        const parenCount = countOpenParens(formula);
        if (parenCount >= COMPLEXITY_THRESHOLD) {
          findings.push({
            sheet: ws.name,
            cell: cell.address,
            formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
            parenCount,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: `Flags formulas with ${COMPLEXITY_THRESHOLD} or more opening parentheses, per PwC's Global Financial Modeling Guidelines' explicit named threshold for "complex" formulas. Expect a high volume on real models — common idioms like IFERROR(INDEX(...,MATCH(...)),0) already clear this threshold despite being a standard, unremarkable pattern. This is a readability-review prompt, not an error signal; shipped at low confidence deliberately.`,
  };
}

module.exports = { checkComplexFormulas };
