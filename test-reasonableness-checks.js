const {
  checkWaccOverride,
  checkTerminalValueConcentration,
  checkOutputReasonableness,
  checkRevenuePerUnitMetric,
  checkTerminalValueCrossCheck,
} = require('./src/utils/reasonableness-checks.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ══════════════════════════════════════════════════════════════════
  // checkWaccOverride — pre-existing, had no test coverage at all
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Valuation');
    ws.getCell('A1').value = 'WACC (Calculated)';
    ws.getCell('B1').value = 0.0922;
    ws.getCell('A2').value = 'Applied discount rate';
    ws.getCell('B2').value = 0.10;
    const r = checkWaccOverride(wb);
    check('WACC override: a genuine mismatch between calculated and applied rate is flagged', r.applicable && r.mismatch === true);

    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('Valuation');
    ws2.getCell('A1').value = 'WACC (Calculated)';
    ws2.getCell('B1').value = 0.10;
    ws2.getCell('A2').value = 'Applied discount rate';
    ws2.getCell('B2').value = 0.10;
    const r2 = checkWaccOverride(wb2);
    check('WACC override: matching rates are NOT flagged as a mismatch', r2.applicable && r2.mismatch === false);

    const wb3 = new ExcelJS.Workbook();
    const ws3 = wb3.addWorksheet('Sheet1');
    const r3 = checkWaccOverride(wb3);
    check('WACC override: no calculated WACC present at all is not applicable', r3.applicable === false);
  }

  // ══════════════════════════════════════════════════════════════════
  // checkTerminalValueConcentration — pre-existing, had no test coverage
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Valuation');
    ws.getCell('A1').value = 'PV of Terminal Value';
    ws.getCell('B1').value = 70;
    ws.getCell('A2').value = 'Project NPV';
    ws.getCell('B2').value = 100;
    const r = checkTerminalValueConcentration(wb);
    check('TV concentration: 70% of NPV from terminal value IS flagged (above 60% default trigger)', r.applicable && r.flagged === true);

    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('Valuation');
    ws2.getCell('A1').value = 'PV of Terminal Value';
    ws2.getCell('B1').value = 30;
    ws2.getCell('A2').value = 'Project NPV';
    ws2.getCell('B2').value = 100;
    const r2 = checkTerminalValueConcentration(wb2);
    check('TV concentration: 30% of NPV from terminal value is NOT flagged', r2.applicable && r2.flagged === false);
  }

  // ══════════════════════════════════════════════════════════════════
  // checkOutputReasonableness — pre-existing, had no test coverage
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Dashboard');
    ws.getCell('A1').value = 'EBITDA Margin';
    ws.getCell('B1').value = 0.53; // above the 40% trigger
    ws.getCell('A2').value = 'Unlevered IRR';
    ws.getCell('B2').value = 0.15; // below the 20% trigger
    const r = checkOutputReasonableness(wb);
    const ebitdaResult = r.results.find(x => x.metric === 'EBITDA margin');
    const irrResult = r.results.find(x => x.metric === 'Unlevered IRR');
    check('Output reasonableness: 53% EBITDA margin IS flagged (above 40% trigger)', ebitdaResult && ebitdaResult.flagged === true);
    check('Output reasonableness: 15% unlevered IRR is NOT flagged (below 20% trigger)', irrResult && irrResult.flagged === false);
  }

  // ══════════════════════════════════════════════════════════════════
  // checkRevenuePerUnitMetric — NEW, sourced from the 2026-07-25
  // gap-analysis review. Real-file verification: tested directly
  // against the actual uploaded model and found a genuine match
  // ("Revenue per Event Day" at Debt Dashboard!J31, correctly computed
  // as Total Revenue / Annual Event Days) — confirming this is not a
  // coincidental label collision but working as intended.
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Debt Dashboard');
    ws.getCell('I31').value = 'Revenue per Event Day';
    ws.getCell('J31').value = 126988.22;
    const r = checkRevenuePerUnitMetric(wb);
    check('Revenue-per-unit: a genuine metric present in the workbook IS found', r.applicable && r.found === true && r.location === 'Debt Dashboard!J31');

    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('P&L');
    ws2.getCell('A1').value = 'Total Revenue';
    ws2.getCell('B1').value = 20000000;
    const r2 = checkRevenuePerUnitMetric(wb2);
    check('Revenue-per-unit: a workbook with only a bare "Total Revenue" label and no per-unit metric is correctly flagged as not found', r2.applicable && r2.found === false);
  }

  // ══════════════════════════════════════════════════════════════════
  // checkTerminalValueCrossCheck — NEW, sourced from the same review.
  // Real-file verification: tested directly against the actual
  // uploaded model. Confirmed the "not found" result was genuinely
  // correct by inspecting the Valuation sheet directly — it has "Exit
  // EBITDA Multiple" and "Yield on Cost (Exit)" but no independent
  // cross-check method (implied buyer return, replacement cost,
  // revenue multiple) distinct from the exit multiple itself.
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Valuation');
    ws.getCell('A1').value = 'PV of Terminal Value';
    ws.getCell('B1').value = 97;
    ws.getCell('A2').value = 'Implied Buyer Return';
    ws.getCell('B2').value = 0.08;
    const r = checkTerminalValueCrossCheck(wb);
    check('TV cross-check: a genuine independent cross-check metric present IS found', r.applicable && r.found === true);

    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('Valuation');
    ws2.getCell('A1').value = 'PV of Terminal Value';
    ws2.getCell('B1').value = 97;
    ws2.getCell('A2').value = 'Exit EBITDA Multiple';
    ws2.getCell('B2').value = 7.0;
    const r2 = checkTerminalValueCrossCheck(wb2);
    check('TV cross-check: an exit multiple alone, with no independent cross-check, is correctly flagged as not found', r2.applicable && r2.found === false);

    const wb3 = new ExcelJS.Workbook();
    const ws3 = wb3.addWorksheet('Sheet1');
    const r3 = checkTerminalValueCrossCheck(wb3);
    check('TV cross-check: no terminal value present at all is not applicable', r3.applicable === false);
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
