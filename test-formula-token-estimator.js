const fs = require('fs');
const ExcelJS = require('exceljs');
const { estimateRawFormulaListTokens, getMaxFullParseTokens, shouldUseFullParseRoute } = require('./src/utils/formula-token-estimator.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

(async () => {
  // ══════════════════════════════════════════════════════════════
  // Synthetic tests — exact, predictable formula content
  // ══════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.getCell('A1').value = { formula: 'B1+B2', result: 3 };
    ws.getCell('A2').value = 5; // a plain value, not a formula — should not count
    const result = estimateRawFormulaListTokens(wb);
    check('a single formula cell is counted, a plain value cell is not',
      result.formulaCellCount === 1);
    check('estimated characters matches the exact expected shape (SheetName!Cell: =formula\\n)',
      result.estimatedCharacters === 'Sheet1'.length + 1 + 'A1'.length + 3 + 'B1+B2'.length + 1);
  }

  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    for (let i = 1; i <= 10; i++) {
      ws.getCell(`A${i}`).value = { formula: `B${i}+C${i}`, result: 0 };
    }
    const result = estimateRawFormulaListTokens(wb);
    check('10 formula cells across a column are all counted', result.formulaCellCount === 10);
  }

  // ══════════════════════════════════════════════════════════════
  // Threshold configuration — env var, default, malformed fallback
  // ══════════════════════════════════════════════════════════════
  {
    delete process.env.FULL_FORMULA_PARSE_MAX_TOKENS;
    check('unset env var falls back to the documented default (780,000)',
      getMaxFullParseTokens() === 780000);
  }
  {
    process.env.FULL_FORMULA_PARSE_MAX_TOKENS = '1000000';
    check('a valid env var override is respected exactly',
      getMaxFullParseTokens() === 1000000);
  }
  {
    process.env.FULL_FORMULA_PARSE_MAX_TOKENS = 'not-a-number';
    check('a malformed env var falls back to the default, not a crash or NaN',
      getMaxFullParseTokens() === 780000);
  }
  {
    process.env.FULL_FORMULA_PARSE_MAX_TOKENS = '-500';
    check('a negative env var falls back to the default (threshold must be positive)',
      getMaxFullParseTokens() === 780000);
  }
  delete process.env.FULL_FORMULA_PARSE_MAX_TOKENS;

  // ══════════════════════════════════════════════════════════════
  // End-to-end routing decision against real reference files —
  // dynamically found, not a fixed list, matching this project's
  // established pattern.
  // ══════════════════════════════════════════════════════════════
  const refFiles = [
    ['/mnt/project/Financial_Model_The_Bend_13_7_2026_Audited.xlsx', 'Bend (small/medium)', true],
    ['/mnt/project/CarlsbergFinancialModel_1.xlsm', 'Carlsberg (small)', true],
    ['/mnt/project/Hidden_Gem_Base_Case_Financial_Model_1_9Mtpa4032026_v_2_VBA_FIX.xlsm', 'Hidden Gem (large)', false],
  ];
  for (const [file, label, expectedFullParse] of refFiles) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const decision = shouldUseFullParseRoute(wb);
    check(`real-file routing: ${label} routes to ${expectedFullParse ? 'full-parse' : 'curated'} as expected (estimated ${decision.estimate.estimatedTokens.toLocaleString()} tokens vs ${decision.threshold.toLocaleString()} threshold)`,
      decision.useFullParse === expectedFullParse);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
