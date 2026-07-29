// degenerate-covenant-branch-check.js
//
// Found via an independent review directly disproving the automated
// audit's own output: the review's single most serious finding was a
// distribution covenant gate that returns TRUE (pass) whenever its
// denominator is zero or otherwise unavailable — the exact opposite
// of the conservative default a covenant/gate test should have.
// Confirmed directly on the real file: DEBT!F152 contains
// IF(F$123+F$124=0,TRUE,F$144/(F$123+F$124)>=$B$48) — when debt
// service (the denominator) is zero, the test evaluates to TRUE
// rather than blocking. Swept across all periods on the real file:
// 121 cells share this exact pattern (one full period range via
// shared-formula mechanics), and a related OR(x=0,ratio>=threshold)
// variant (functionally identical — an OR is TRUE if either operand
// is TRUE, so a zero-denominator flag defaults the whole test to
// pass) appears in a further 242 cells across the same and adjacent
// covenant rows (DSCR, ICR, debt yield).
//
// This is a formula-TEXT pattern, not something inferrable from
// extracted values or labels alone — exactly the class of defect a
// values-only review structurally cannot see. A Tier 0 scan over raw
// formula text is the reliable way to catch it, independent of
// whichever sheets Tier 2 happens to review.
//
// PREVALENCE TESTED before finalizing: zero matches (either pattern)
// on three other real test files (Carlsberg, The Bend Audited, Hidden
// Gem) — this is not a broad, generic formula shape that would create
// noise; it specifically requires a self-referential zero-check
// immediately gating a ratio comparison.

const IF_ZERO_DEFAULTS_TRUE_RE = /IF\s*\(\s*[^,()]*(?:\([^()]*\))?[^,()]*=\s*0\s*,\s*TRUE\s*,/gi;
const OR_ZERO_DEFAULTS_TRUE_RE = /OR\s*\(\s*[A-Za-z][\w.]*\$?\d+\s*=\s*0\s*,\s*[A-Za-z][\w.]*\$?\d+\s*>=/gi;

function rowKey(sheetName, address) {
  const m = /^([A-Z]+)(\d+)$/.exec(address);
  return m ? `${sheetName}!row${m[2]}` : `${sheetName}!${address}`;
}

function checkDegenerateCovenantBranch(workbook) {
  const groups = new Map(); // rowKey -> { sheet, rowNum, cells: [{address, formula, pattern}], }

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, cell => {
        const formula = cell.formula;
        if (!formula) return;
        let matchedPattern = null;
        if (IF_ZERO_DEFAULTS_TRUE_RE.test(formula)) matchedPattern = 'IF(x=0,TRUE,...)';
        IF_ZERO_DEFAULTS_TRUE_RE.lastIndex = 0;
        if (!matchedPattern && OR_ZERO_DEFAULTS_TRUE_RE.test(formula)) matchedPattern = 'OR(x=0,ratio>=threshold)';
        OR_ZERO_DEFAULTS_TRUE_RE.lastIndex = 0;
        if (!matchedPattern) return;

        const key = rowKey(ws.name, cell.address);
        if (!groups.has(key)) {
          groups.set(key, { sheet: ws.name, rowNum, cells: [], pattern: matchedPattern });
        }
        groups.get(key).cells.push({ address: cell.address, formula });
      });
    });
  });

  if (groups.size === 0) {
    return { applicable: true, flaggedCount: 0, findings: [],
      note: 'No covenant/gate formula defaulting to pass on a zero or unavailable denominator was found.' };
  }

  const findings = [];
  for (const [key, g] of groups) {
    const sample = g.cells[0];
    findings.push({
      sheet: g.sheet, rowNum: g.rowNum, sampleCell: sample.address,
      instanceCount: g.cells.length, pattern: g.pattern, sampleFormula: sample.formula,
      note: `${g.sheet}!${sample.address} (and ${g.cells.length - 1} other period(s) on the same row) contains a covenant/gate test of the shape ${g.pattern} — when the denominator or gating value is zero or unavailable, the test defaults to PASS rather than blocking. This is the opposite of the conservative default a covenant gate should have: an inability to measure should block a distribution or release, not permit one.`,
    });
  }
  findings.sort((a, b) => b.instanceCount - a.instanceCount);

  return {
    applicable: true,
    flaggedCount: findings.length,
    totalInstances: [...groups.values()].reduce((sum, g) => sum + g.cells.length, 0),
    findings,
    note: `${findings.length} distinct row(s) contain a covenant/gate formula that defaults to PASS on a zero or unavailable denominator, across ${[...groups.values()].reduce((sum, g) => sum + g.cells.length, 0)} total cells. Each is a genuine formula-text pattern, not inferred from values — a distribution or covenant test that cannot measure its own ratio should block, not release.`,
  };
}

module.exports = { checkDegenerateCovenantBranch };
