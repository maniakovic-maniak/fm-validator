const ExcelJS = require('exceljs');
const fs = require('fs');
const { checkMismatchedBasisComparison } = require('./src/utils/mismatched-basis-comparison-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defects this fixes: Underwriting!C290 compares a fixed
// 50% target (a direct link) against an actual debt-share ratio
// computed on a different denominator (52.4%). C291 compares a
// static 3.00% fee target against an averaged actual fee rate
// (~0.49%). Both are structurally comparing a fixed target against a
// differently-computed actual, not two independent derivations of
// the same underlying figure.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Underwriting');
  ws.getCell('C61').value = { formula: "'FUNDING & CAP TABLE'!$I$20", result: 0.5 };
  ws.getCell('F61').value = { formula: 'I61/Project_Cost_Total', result: 0.524 };
  ws.getCell('C290').value = { formula: 'ROUND(C61,3)=ROUND(F61,3)', result: false };

  const result = checkMismatchedBasisComparison(wb);
  check('real defect fixed (ER-006): a fixed direct-link target compared against a differently-based computed ratio is flagged',
    result.flaggedCount === 1 && result.findings[0].linkArg === 'C61' && result.findings[0].computedArg === 'F61');
}

// ══════════════════════════════════════════════════════════════════
// The AVERAGE() variant (ER-007) — same structural pattern, different
// computed function.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Underwriting');
  ws.getCell('G291').value = { formula: '+G135', result: 0.03 };
  ws.getCell('G292').value = { formula: 'ROUND(AVERAGE(K291:EN291),4)', result: 0.0049 };
  ws.getCell('C291').value = { formula: 'ROUND(G292,4)=ROUND(G291,4)', result: false };

  const result = checkMismatchedBasisComparison(wb);
  check('real defect fixed (ER-007): a static direct-link target compared against an AVERAGE()-computed actual is flagged',
    result.flaggedCount === 1 && result.findings[0].computedFormula.includes('AVERAGE'));
}

// ══════════════════════════════════════════════════════════════════
// Confirms two ordinary, genuinely comparable values (both simple
// links, or both computed the same way) are NOT flagged — this
// pattern is deliberately narrow, not "any ROUND-equality test".
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = { formula: "'Other Sheet'!$B$5", result: 100 };
  ws.getCell('B1').value = { formula: "'Other Sheet'!$C$5", result: 100 };
  ws.getCell('C1').value = { formula: 'ROUND(A1,2)=ROUND(B1,2)', result: true };

  const result = checkMismatchedBasisComparison(wb);
  check('two ordinary direct-link comparisons (both simple links, neither computed) are correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms two computed values (both divisions, neither a simple
// link) are NOT flagged either — the pattern requires exactly one
// side to be a simple link and the other computed, not any mix.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = { formula: 'X1/Y1', result: 0.5 };
  ws.getCell('B1').value = { formula: 'X2/Y2', result: 0.5 };
  ws.getCell('C1').value = { formula: 'ROUND(A1,2)=ROUND(B1,2)', result: true };

  const result = checkMismatchedBasisComparison(wb);
  check('two independently computed division values compared to each other are correctly NOT flagged (not a link-vs-computed mismatch)',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against every discovered reference file —
// dynamically found via fixtures-helper.js, not a fixed list.
// ══════════════════════════════════════════════════════════════════
const { getFixtureFiles, getKnownExpectation } = require('./fixtures-helper.js');
const KNOWN_EXPECTATIONS = {
  'The_Bend_FInancial_Model_3_8_2026.xlsx': 2,
  'CarlsbergFinancialModel_1.xlsm': 0,
  'Financial_Model_The_Bend_13_7_2026_Audited.xlsx': 0,
  'Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm': 0,
  'Qantas_1.xlsx': 0,
};
(async () => {
  const fixtures = getFixtureFiles();
  if (fixtures.length === 0) {
    console.log('SKIPPED: no reference files found (checked test-fixtures/ and the sandbox fallback)');
  }
  for (const { path: filePath, filename } of fixtures) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const result = checkMismatchedBasisComparison(wb);
    const expected = getKnownExpectation(KNOWN_EXPECTATIONS, filename);
    if (expected !== undefined) {
      check(`end-to-end: ${filename} — flaggedCount === ${expected}`, result.flaggedCount === expected);
    } else {
      check(`end-to-end: ${filename} — ran without crashing (no known expected count yet; actual flaggedCount: ${result.flaggedCount} — review and add to KNOWN_EXPECTATIONS once verified)`, true);
    }
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
