// balance-sheet-plug-check.js — sourced from ICAEW's "How to Review a
// Spreadsheet" (D6): a "balancing figure" — a formula computing a
// residual specifically to force a check to zero — is a common sign of
// an issue elsewhere in the model rather than a genuine independent
// calculation.
//
// DELIBERATE SCOPE DECISION, made explicitly rather than attempting
// full semantic plug-detection (identifying which cell "is the check"
// a specific plug feeds, then confirming the plug's only purpose is
// forcing that check to zero — genuinely a Tier 2 judgment call, not a
// clean deterministic pattern). This check only flags a cell whose
// LABEL is already suggestive of being a plug (a modeller who names a
// line "Balancing Figure" is telling you what it is) AND whose formula
// has a residual shape (a SUM() combined with a subtraction). This is
// narrower than full plug detection — it will miss an UNLABELLED plug
// entirely — but avoids the much higher false-positive risk of trying
// to infer plug-ness from formula shape alone across a whole model.

const PLUG_LABEL_TERMS = ['balancing figure', 'balancing item', 'plug', 'other/balancing', 'residual balancing'];

function hasResidualShape(formula) {
  if (!formula) return false;
  return /\bSUM\s*\(/i.test(formula) && /[-−]/.test(formula.replace(/^-/, ''));
}

function checkBalanceSheetPlug(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        // Look left for a matching label, same proximity convention
        // used throughout this project.
        let labelText = null;
        for (let c = colNum - 1; c >= Math.max(1, colNum - 8); c--) {
          const v = row.getCell(c).value;
          if (typeof v === 'string' && v.trim()) {
            const lower = v.toLowerCase();
            if (PLUG_LABEL_TERMS.some(t => lower.includes(t))) labelText = v;
            break;
          }
        }
        if (!labelText) return;
        if (!hasResidualShape(cell.formula)) return;

        findings.push({
          sheet: ws.name,
          cell: cell.address,
          labelText,
          formula: cell.formula.length > 150 ? cell.formula.slice(0, 150) + '…' : cell.formula,
          note: `${ws.name}!${cell.address} is labelled "${labelText}" and has a residual-shaped formula (a SUM() combined with a subtraction) — a common pattern for a figure computed specifically to force a check to balance, rather than an independent calculation. Confirm what this line represents commercially, and whether its presence indicates an unresolved discrepancy elsewhere.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a cell whose label already suggests it is a balancing/plug figure AND whose formula has a residual shape (SUM combined with subtraction). Deliberately does not attempt to detect an UNLABELLED plug — that requires identifying which cell is "the check" being forced to balance, a judgment call closer to Tier 2 semantic review than a clean deterministic pattern.',
  };
}

module.exports = { checkBalanceSheetPlug };
