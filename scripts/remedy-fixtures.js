'use strict';
// Synthetic workbook and findings for the remedy check and the applicability record (acceptance cases 15 and 16,
// test-patch33.js). Mirrors the two review examples: a cell cited with a formula the file does not hold (AP242), and a
// negative OFFSET displacement described as a negative width.
const fs = require('fs'), os = require('os'), path = require('path');
const ExcelJS = require('exceljs');

async function buildRemedyWorkbook() {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('S');
  s.getCell('A1').value = -2; s.getCell('D1').value = 5; s.getCell('E1').value = 6; s.getCell('F1').value = 7;
  s.getCell('B1').value = { formula: 'SUM(OFFSET(G1,0,A1))', result: 11 };        // A1 is a COLUMNS displacement
  s.getCell('C1').value = { formula: 'SUM(OFFSET(D1,0,0,1,A1))', result: 0 };     // A1 is a genuine negative WIDTH
  for (let r = 10; r <= 12; r++) s.getCell('AP' + r).value = 1;
  s.getCell('AP242').value = { formula: 'SUM(AP10:AP37)', result: 3 };
  // Patch 34: a sheet whose name has a space, for remedies that cite cells in plain prose
  const fin = wb.addWorksheet('Fin Stmts');
  fin.getCell('AP35').value = 480;                                                    // a constant, not a formula
  fin.getCell('AP42').value = 0;
  fin.getCell('AP608').value = { formula: 'S!AP242*4000000', result: 12200000 };
  fin.getCell('AP122').value = { formula: 'AP608', result: 12200000 };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'remedyfx-')), 'fixture.xlsx');
  await wb.xlsx.writeFile(file);
  return file;
}

const F = o => Object.assign({ id: 'T2-X', sheet: 'S', condition: '', fix_instruction: '' }, o);
function remedyFindings() {
  return {
    wrongCitation: F({ cell: 'AP242', condition: 'AP242 counts a subtotal twice', fix_instruction: 'AP242 holds `=SUM(AP10:AP19)`; change it to `=SUM(AP10:AP19)+AP20`.' }),
    rightCitation: F({ cell: 'AP242', condition: 'AP242 counts a subtotal twice', fix_instruction: 'AP242 holds `=SUM(AP10:AP37)`; change it to `=SUM(AP20:AP37)`.' }),
    displacementAsWidth: F({ cell: 'B1', condition: 'The OFFSET in B1 has a negative width', fix_instruction: 'Change the negative width in the OFFSET to a positive number.' }),
    realNegativeWidth: F({ cell: 'C1', condition: 'The OFFSET in C1 has a negative width of -2', fix_instruction: 'Change the negative width in the OFFSET to a positive number.' }),
    suppression: F({ cell: 'B1', condition: 'B1 returns #N/A', fix_instruction: 'Wrap the formula in IFERROR(...,0) so the error no longer shows.' }),
    causeFix: F({ cell: 'B1', condition: 'B1 returns #N/A', fix_instruction: 'Find why the lookup key is missing and correct the key; do not wrap it in IFERROR.' }),
    plain: F({ cell: 'B1', fix_instruction: 'Review the formula.' }),
    emptyCell: F({ cell: 'Z9', fix_instruction: 'Z9 holds `=A1+1`; change it.' }),
  };
}

// Patch 34: remedies that cite cells in prose, as the reviewer writes them.
function proseFindings() {
  return {
    formulaOnConstant: F({ cell: 'AP42', sheet: 'Fin Stmts', fix_instruction: "Inspect Fin Stmts!AP35's source formula in Excel to confirm it reflects the regearing." }),
    formulaOnFormula: F({ cell: 'AP42', sheet: 'Fin Stmts', fix_instruction: "Inspect the formula in Fin Stmts!AP122 and confirm it points at the equity line." }),
    valueRight: F({ cell: 'AP42', sheet: 'Fin Stmts', fix_instruction: 'Fin Stmts!AP42 shows 0 while Fin Stmts!AP122 shows ~12.2m in the same period; link AP42 to AP122.' }),
    valueWrong: F({ cell: 'AP42', sheet: 'Fin Stmts', fix_instruction: 'Fin Stmts!AP122 shows 31.5m, so AP42 should be linked to it.' }),
    percentNotValue: F({ cell: 'AP42', sheet: 'Fin Stmts', fix_instruction: 'Fin Stmts!AP122 is 20% of the total; review the split.' }),
    unknownSheet: F({ cell: 'B1', fix_instruction: 'Open Nowhere!Z9 formula and compare.' }),
  };
}

// Reviewer answers for the applicability record.
function applicabilityResults() {
  const base = { status: 'uncertain', confidence: 0.55, sheet: '', cell: 'A1' };
  return {
    notApplicable: Object.assign({}, base, { id: 'T2-S6-001', condition: 'No debt schedule was found in any sheet.', reason: 'This is an unlevered project model with no borrowings, so a debt schedule does not apply to this model type.' }),
    realAbsence: Object.assign({}, base, { id: 'T2-S5-008', condition: 'No receivables roll-forward was found in any sheet.', reason: 'The model records trade receivables on the balance sheet but has no schedule supporting the movement.' }),
    fatalRule: Object.assign({}, base, { id: 'T2-S1-001', severity: 'fatal', condition: 'No balance check was found in any sheet.', reason: 'A balance check does not apply to this kind of model.' }),
    limitation: Object.assign({}, base, { id: 'T2-S3-002', condition: 'No evidence of data validation was found in any sheet.', reason: 'Formatting was not available in the formula-only extract so this could not be ruled out.' }),
  };
}

module.exports = { buildRemedyWorkbook, remedyFindings, proseFindings, applicabilityResults };
