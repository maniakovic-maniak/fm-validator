const EXCEL_ERRORS = ['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NULL!', '#NUM!'];

function fixFormulaErrors(worksheet, sheetName) {
  const fixes = [];

  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      const cellValue = cell.value ? String(cell.value) : '';
      if (EXCEL_ERRORS.some(e => cellValue.includes(e))) {
        const originalValue = cellValue;
        cell.value = 0;
        cell.dataType = 'n';
        fixes.push({
          sheet: sheetName,
          cell: cell.address,
          issue: `Formula error: ${originalValue}`,
          fix: 'Replaced with 0 — review required',
          fixable: true
        });
      }
    });
  });
  return fixes;
}

function fixEmptyCells(worksheet, sheetName, requiredColumns) {
  const fixes = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header row

    for (const col of requiredColumns) {
      const cell = row.getCell(col);
      if (!cell.value || cell.value === null || cell.value === '') {
        cell.value = 'N/A';
        cell.dataType = 's';
        fixes.push({
          sheet: sheetName,
          cell: cell.address,
          issue: 'Empty mandatory cell',
          fix: 'Filled with N/A — review required',
          fixable: true
        });
      }
    }
  });
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
