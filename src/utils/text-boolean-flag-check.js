// text-boolean-flag-check.js
//
// Found via independent review (Rees, "Financial Modelling in
// Practice"): a direct comparison expression like =F7>F6 evaluates to
// a genuine boolean TRUE/FALSE — which Excel silently treats as 1/0 in
// any subsequent numeric formula (e.g. =50*(F7>F6) returns 50, not an
// error). But =IF(F7>F6,"TRUE","FALSE") is a materially different
// thing: it returns the literal TEXT strings "TRUE"/"FALSE", which
// look identical on screen but will produce #VALUE! the moment
// they're used in any arithmetic (multiplication, SUM, PRODUCT,
// addition) — exactly the flag-combination usage this kind of formula
// is normally built for in the first place.
//
// Confirmed distinct from this project's existing coverage:
// embedded-error-branch-check.js and error-literal-in-formula-check.js
// both use "TRUE"/"FALSE" only as terminology for IF() BRANCH
// POSITIONS (which side of the IF executes) — neither covers a
// formula that returns the quoted string "TRUE"/"FALSE" as its actual
// output value. This check is about the returned data type, not
// branch position, and doesn't overlap with either.
//
// SCOPE, DELIBERATELY NARROW: this is a structural flag only — it
// does not attempt to trace whether the flagged cell is later used
// arithmetically elsewhere in the workbook (that would require the
// same kind of cross-cell tracing that led to the PR-04 check being
// abandoned earlier this project, after a ~158:1 false-positive
// ratio). A cell producing "TRUE"/"FALSE" as text is a genuine latent
// risk regardless of whether it happens to be used arithmetically
// today — a future edit could easily introduce that usage without the
// modeller realizing this cell was never boolean-safe to begin with.

// Matches an IF(...) call whose two result arguments are exactly the
// quoted strings "TRUE" and "FALSE" (in either order), case-
// insensitive on the quoted text itself (Excel treats "true"/"TRUE"
// the same as text, though not as a genuine boolean either way).
const TEXT_BOOLEAN_IF_RE = /\bIF\s*\([^,]+,\s*"(?:true|false)"\s*,\s*"(?:true|false)"\s*\)/i;

function checkTextBooleanFlag(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const formula = cell.formula;
        if (!formula) return;
        if (!TEXT_BOOLEAN_IF_RE.test(formula)) return;

        findings.push({
          sheet: ws.name,
          cell: cell.address,
          formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
          note: `${ws.name}!${cell.address} returns the literal text "TRUE"/"FALSE" rather than a genuine boolean or 1/0. A direct comparison (e.g. =F7>F6) or =IF(condition,1,0) would work correctly in any downstream arithmetic use (multiplication, SUM, PRODUCT), but this quoted-text version will produce #VALUE! the moment it's used that way — exactly the flag-combination usage this kind of formula is typically built for. Worth confirming this cell is genuinely only used for display, not as an input to any calculation, now or in a future edit.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags an IF() call returning the literal quoted text "TRUE"/"FALSE" rather than a genuine boolean or 1/0 — this looks identical on screen to a real boolean but will produce #VALUE! if ever used arithmetically. Structural flag only, no cross-cell tracing of whether the cell is currently used that way.',
  };
}

module.exports = { checkTextBooleanFlag };
