const ExcelJS = require('exceljs');
const fs = require('fs');
const { checkImpossibleCountaTarget, rangeMaxCells } = require('./src/utils/impossible-counta-target-check.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// rangeMaxCells unit tests
check('rangeMaxCells: a single-column range computes the correct cell count',
  rangeMaxCells("'Sheet1'!$Q$1:$Q$884") === 884);
check('rangeMaxCells: a multi-column range computes rows × columns correctly',
  rangeMaxCells('$A$1:$C$10') === 30);
check('rangeMaxCells: an unparseable reference (named range, no colon) returns null rather than guessing',
  rangeMaxCells('SomeNamedRange') === null);

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: DATA MAP!C172 (and 3 other cells)
// test COUNTA('URWLD COMPANY INPUTS'!$Q$1:$Q$884)+COUNTA('INPUT
// REGISTER'!$Q$1:$Q$670)=1708. The two ranges sum to at most 1,554
// cells — 1,708 can never be reached.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DATA MAP');
  const ws2 = wb.addWorksheet('URWLD COMPANY INPUTS');
  const ws3 = wb.addWorksheet('INPUT REGISTER');
  ws.getCell('C172').value = {
    formula: "IF(COUNTA('URWLD COMPANY INPUTS'!$Q$1:$Q$884)+COUNTA('INPUT REGISTER'!$Q$1:$Q$670)=1708,\"OK\",\"EXCEPTION\")",
    result: 'EXCEPTION',
  };
  const result = checkImpossibleCountaTarget(wb);
  check('real defect fixed: the exact real formula (884+670 ranges, target 1708) is correctly flagged as impossible',
    result.flaggedCount === 1 && result.findings[0].target === 1708 && result.findings[0].maxAchievable === 1554);
}

// ══════════════════════════════════════════════════════════════════
// The exact same defect repeated across 4 cells collapses to ONE
// finding with an instance count of 4, matching the real file.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DATA MAP');
  const formula = "IF(COUNTA('URWLD COMPANY INPUTS'!$Q$1:$Q$884)+COUNTA('INPUT REGISTER'!$Q$1:$Q$670)=1708,\"OK\",\"EXCEPTION\")";
  ['C172', 'C455', 'C468'].forEach(addr => { ws.getCell(addr).value = { formula, result: 'EXCEPTION' }; });
  const ws2 = wb.addWorksheet('MODEL GUIDE');
  ws2.getCell('B11').value = { formula: formula.replace('"OK","EXCEPTION"', '"PASS","FAIL"'), result: 'FAIL' };

  const result = checkImpossibleCountaTarget(wb);
  check('the same impossible target repeated across 4 cells collapses to ONE finding with instanceCount 4',
    result.flaggedCount === 1 && result.findings[0].instanceCount === 4);
}

// ══════════════════════════════════════════════════════════════════
// Confirms a GENUINELY achievable target is correctly NOT flagged —
// the check must not over-fire on any COUNTA equality test.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = { formula: "COUNTA($A$1:$A$100)=50", result: 'FALSE' };
  const result = checkImpossibleCountaTarget(wb);
  check('a genuinely achievable target (COUNTA of a 100-cell range = 50) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// Confirms COUNTA(range)=0 (a real, valid, achievable pattern — this
// model genuinely uses it at DATA MAP!C448) is correctly NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = { formula: "COUNTA($G$19:$L$19)=0", result: 'TRUE' };
  const result = checkImpossibleCountaTarget(wb);
  check('COUNTA(range)=0 (a real, valid pattern used elsewhere in this exact model) is correctly NOT flagged',
    result.flaggedCount === 0);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against every discovered reference file —
// dynamically found via fixtures-helper.js, not a fixed list.
// ══════════════════════════════════════════════════════════════════
const { getFixtureFiles, getKnownExpectation } = require('./fixtures-helper.js');
const KNOWN_EXPECTATIONS = {
  'The_Bend_FInancial_Model_3_8_2026.xlsx': { count: 1, instances: 4 },
  'CarlsbergFinancialModel_1.xlsm': { count: 0, instances: null },
  'Financial_Model_The_Bend_13_7_2026_Audited.xlsx': { count: 0, instances: null },
  'Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm': { count: 0, instances: null },
  'Qantas_1.xlsx': { count: 0, instances: null },
};
(async () => {
  const fixtures = getFixtureFiles();
  if (fixtures.length === 0) {
    console.log('SKIPPED: no reference files found (checked test-fixtures/ and the sandbox fallback)');
  }
  for (const { path: filePath, filename } of fixtures) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    const result = checkImpossibleCountaTarget(wb);
    const known = getKnownExpectation(KNOWN_EXPECTATIONS, filename);
    if (known !== undefined) {
      check(`end-to-end: ${filename} — flaggedCount === ${known.count}`, result.flaggedCount === known.count);
      if (known.instances !== null) {
        check(`end-to-end: ${filename} — instanceCount === ${known.instances}`, result.findings[0].instanceCount === known.instances);
      }
    } else {
      check(`end-to-end: ${filename} — ran without crashing (no known expected count yet; actual flaggedCount: ${result.flaggedCount} — review and add to KNOWN_EXPECTATIONS once verified)`, true);
    }
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
