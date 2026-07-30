const ExcelJS = require('exceljs');
const { checkZeroBaseRates } = require('./src/utils/zero-base-rate-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: three debt facility base rates
// (Construction, Working-capital, Term-debt), all genuinely zero.
// Includes the real resolution gap found while building this — some
// cells have no cached value at all when their formula is a bare
// reference to another cell with no cached result of its own.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DEBT');
  const proj = wb.addWorksheet('PROJECTS');
  ws.getCell('A12').value = 'Construction base rate';
  ws.getCell('B12').value = { formula: 'PROJECTS!$E$50' }; // bare reference, no cached result
  ws.getCell('A25').value = 'Working-capital base rate';
  ws.getCell('B25').value = { formula: 'PROJECTS!$E$60' };
  ws.getCell('A39').value = 'Term-debt base rate';
  ws.getCell('B39').value = { formula: '0', result: 0 };
  proj.getCell('E50').value = 0;
  proj.getCell('E60').value = 0;

  const result = checkZeroBaseRates(wb);
  check('real defect fixed: all-zero base rates are found, including one resolved through a bare-reference chain with no cached value',
    result.found === true && result.candidates.length === 3);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a workbook where at least one base rate is genuinely
// nonzero is correctly NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DEBT');
  ws.getCell('A12').value = 'Construction base rate';
  ws.getCell('B12').value = { formula: '0', result: 0 };
  ws.getCell('A25').value = 'Working-capital base rate';
  ws.getCell('B25').value = { formula: '0.045', result: 0.045 };

  const result = checkZeroBaseRates(wb);
  check('a workbook with at least one genuinely nonzero base rate is correctly NOT flagged',
    result.found === false);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a workbook with no base-rate labels at all is correctly
// NOT flagged (not applicable, not a false "all zero" claim).
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Some unrelated label';
  ws.getCell('B1').value = 0;

  const result = checkZeroBaseRates(wb);
  check('a workbook with no base-rate labels at all is correctly NOT flagged',
    result.found === false);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against all four real files.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
(async () => {
  const files = [
    ['/tmp/test_fixed2.xlsm', true],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', false],
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', false],
    ['/mnt/project/Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm', false],
  ];
  for (const [file, expectFound] of files) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const result = checkZeroBaseRates(wb);
    check(`end-to-end: ${file.split('/').pop()} — found === ${expectFound}`, result.found === expectFound);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
