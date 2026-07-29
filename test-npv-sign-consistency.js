const ExcelJS = require('exceljs');
const { checkNpvSignConsistency } = require('./src/utils/reasonableness-checks.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: Project NPV (+$510.2m) and Project
// XNPV (-$262.6m) disagree on sign for what should be the same
// underlying project value. This wasn't caught by Tier 2 even after
// every row-extraction fix, because the sheet it lives on isn't
// consistently selected as a key sheet by Familiarisation — the same
// architectural cause as the model-status-flag gap. This check scans
// directly, independent of that selection.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('VALUATIONS');
  ws.getCell('J44').value = 'Project NPV';
  ws.getCell('K44').value = 510.2;
  ws.getCell('J45').value = 'Project XNPV';
  ws.getCell('K45').value = -262.6;

  const result = checkNpvSignConsistency(wb);
  check('real defect fixed: opposite-sign "Project NPV" vs "Project XNPV" is found',
    result.found === true && result.flagged[0].base === 'project');
}

// ══════════════════════════════════════════════════════════════════
// Confirms unrelated NPV-adjacent labels don't get falsely grouped
// and compared — found via checking three other real files directly
// before building this check.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Years for NPV';
  ws.getCell('B1').value = 11;
  ws.getCell('A2').value = 'Option NPV';
  ws.getCell('B2').value = -9.14;

  const result = checkNpvSignConsistency(wb);
  check('unrelated NPV-adjacent labels ("Years for NPV", "Option NPV") are not falsely grouped or flagged',
    result.found === false);
}

// ══════════════════════════════════════════════════════════════════
// Confirms genuinely different metrics (Project vs Equity) with
// different signs are correctly NOT flagged — only a shared base
// label with opposite signs should trigger this.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Project NPV';
  ws.getCell('B1').value = 100;
  ws.getCell('A2').value = 'Equity NPV';
  ws.getCell('B2').value = -20;

  const result = checkNpvSignConsistency(wb);
  check('genuinely distinct metrics ("Project NPV" vs "Equity NPV") with different signs are correctly NOT flagged against each other',
    result.found === false);
}

// ══════════════════════════════════════════════════════════════════
// Confirms the same base label agreeing on sign is correctly NOT flagged.
// ══════════════════════════════════════════════════════════════════
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 'Project NPV @ WACC';
  ws.getCell('B1').value = 62469534;
  ws.getCell('A2').value = 'Equity NPV @ Ke';
  ws.getCell('B2').value = 37710060;

  const result = checkNpvSignConsistency(wb);
  check('all-positive values (no genuine sign disagreement) are correctly NOT flagged',
    result.found === false);
}

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation across the real file with the defect, and
// the three other real files confirmed free of false positives.
// ══════════════════════════════════════════════════════════════════
const fs = require('fs');
(async () => {
  const files = [
    ['/mnt/user-data/uploads/The_Bend_Precinct_Model_26_7_2026_Investor_Ready_v6.xlsm', true],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', false],
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', false],
    ['/mnt/project/Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm', false],
  ];
  for (const [file, expectFound] of files) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const result = checkNpvSignConsistency(wb);
    check(`end-to-end: ${file.split('/').pop()} — found === ${expectFound}`, result.found === expectFound);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
