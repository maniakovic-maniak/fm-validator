// stdeva-vara-check.js — L21 (fm-validator book-mining: "Mastering
// Advanced Excel Formulas and Functions", Suman): STDEVA/VARA include
// text and logical values in their calculation (text counts as 0, TRUE
// counts as 1), unlike STDEV/VAR which ignore them — a single-letter
// suffix difference that's easy to type or paste by mistake, and can
// silently distort a statistic if the range includes a header row, a
// label, or a boolean flag alongside the real numeric data.

const STDEVA_VARA_RE = /\b(STDEVA|VARA)\s*\(/gi;

function checkStdevaVaraUsage(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        STDEVA_VARA_RE.lastIndex = 0;
        let match;
        while ((match = STDEVA_VARA_RE.exec(formula)) !== null) {
          findings.push({
            sheet: ws.name,
            cell: cell.address,
            functionUsed: match[1].toUpperCase(),
            formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
            note: `${ws.name}!${cell.address} uses ${match[1].toUpperCase()}(), which includes text and logical values in its calculation (text counts as 0, TRUE counts as 1) — unlike ${match[1].toUpperCase().replace('A', '')}(), which ignores them. Confirm this is intentional, not a mistyped or pasted function name; if the range includes any header, label, or flag cell, this will silently distort the result.`,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags STDEVA()/VARA() usage — these include text (as 0) and logical values (TRUE as 1) in their calculation, unlike STDEV()/VAR(), which ignore them. A single-letter suffix difference that is easy to introduce by mistake and can silently distort a statistic if the range includes anything beyond pure numeric data.',
  };
}

module.exports = { checkStdevaVaraUsage };
