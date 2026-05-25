const XLSX = require('xlsx');

const EXCEL_ERRORS = ['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NULL!', '#NUM!'];

function fixFormulaErrors(workbook, sheetName) {
  const fixes = [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return fixes;

  for (const [cellAddr, cell] of Object.entries(sheet)) {
    if (cellAddr.startsWith('!')) continue;
    if (cell && cell.w && EXCEL_ERRORS.some(e => String(cell.w).includes(e))) {
      const originalValue = cell.w;
      cell.v = 0;
      cell.w = '0';
      cell.t = 'n';
      delete cell.f;
      fixes.push({
        sheet: sheetName,
        cell: cellAddr,
        issue: `Formula error: ${originalValue}`,
        fix: 'Replaced with 0 — review required',
        fixable: true
      });
    }
  }
  return fixes;
}

function fixEmptyCells(workbook, sheetName, requiredColumns) {
  const fixes = [];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return fixes;

  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');

  for (let row = range.s.r + 1; row <= range.e.r; row++) {
    for (const col of requiredColumns) {
      const colIndex = XLSX.utils.decode_col(col);
      const cellAddr = XLSX.utils.encode_cell({ r: row, c: colIndex });
      if (!sheet[cellAddr] || sheet[cellAddr].v === null || sheet[cellAddr].v === '') {
        sheet[cellAddr] = { v: 'N/A', w: 'N/A', t: 's' };
        fixes.push({
          sheet: sheetName,
          cell: cellAddr,
          issue: 'Empty mandatory cell',
          fix: 'Filled with N/A — review required',
          fixable: true
        });
      }
    }
  }
  return fixes;
}

function applyFixes(workbook, validationResults) {
  const allFixes = [];

  for (const result of validationResults) {
    if (result.status === 'fail' && result.fixable) {
      if (result.type === 'formula_error') {
        const fixes = fixFormulaErrors(workbook, result.sheet);
        allFixes.push(...fixes);
      }
      if (result.type === 'empty_cells') {
        const fixes = fixEmptyCells(workbook, result.sheet, result.columns || []);
        allFixes.push(...fixes);
      }
    }
  }

  return { workbook, fixes: allFixes };
}

module.exports = { applyFixes, fixFormulaErrors };
