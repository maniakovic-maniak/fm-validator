// Fixer — locates and reports formula errors. NEVER modifies the model.
//
// Core modelling principle: never overwrite a formula with a hardcoded value,
// and never mask an error. Formula errors are surfaced as critical findings
// for the modeller to investigate and fix at source.

const EXCEL_ERRORS = ['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NULL!', '#NUM!'];

function findFormulaErrors(workbook, sheetName) {
  const findings = [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return findings;
  for (const [cellAddr, cell] of Object.entries(sheet)) {
    if (cellAddr.startsWith('!')) continue;
    if (cell && cell.w && EXCEL_ERRORS.some(e => String(cell.w).includes(e))) {
      findings.push({
        sheet: sheetName,
        cell: cellAddr,
        issue: `Formula error: ${cell.w}`,
        reason: `Formula error ${cell.w} in ${sheetName} cell ${cellAddr}`,
        severity: 'critical',
        fixable: false,
        fix_instruction: 'Investigate and correct at source. Never replace with a hardcoded value or mask with IFERROR. Identify the root cause: broken link, missing reference, division by zero, or lookup failure.'
      });
    }
  }
  return findings;
}

// Returns flagged findings only — never modifies the workbook
function applyFixes(workbook, validationResults) {
  const allFlagged = [];
  for (const result of validationResults) {
    if (result.type === 'formula_error' || (result.reason && result.reason.includes('Formula error'))) {
      // already a located formula error from tier1
      allFlagged.push({ ...result, fixable: false });
    }
  }
  // No fixes are ever applied — the model is never modified
  return { workbook, fixes: [] };
}

module.exports = { applyFixes, findFormulaErrors };
