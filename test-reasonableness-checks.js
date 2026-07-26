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

  // ══════════════════════════════════════════════════════════════════
  // Real bugs found via investigating a live-flagged report showing a
  // nonsensical "-1143634%" terminal-value concentration. Two separate
  // instances of the same underlying issue in pickModalCandidate: when
  // every candidate has a unique value (no genuine frequency-based
  // mode to find), the old code silently picked whichever candidate
  // came first in array/iteration order, which is arbitrary. Confirmed
  // directly on the real file: an "Enterprise value" label won over a
  // genuine "Project NPV" label purely by search-term array order, and
  // a long row-description sentence that merely contains the phrase
  // "terminal value" won over a clean, exact "Terminal value" label
  // purely by workbook iteration order.
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Valuation');
    // A clean, exact "Terminal value" label, plus an unrelated row
    // description that merely mentions the same phrase in passing —
    // the clean label must win, not whichever was found first.
    ws.getCell('A12').value = 'Pre-terminal unlevered cash flows plus one discounted terminal value.';
    ws.getCell('X12').value = -3185000;
    ws.getCell('A13').value = 'Terminal value';
    ws.getCell('B13').value = 255.31;
    // A genuine "Project NPV" label, plus an unrelated "Enterprise
    // value" label that should not win just because it's listed first
    // in the search-terms array.
    ws.getCell('A44').value = 'Enterprise value';
    ws.getCell('B44').value = 278.50;
    ws.getCell('J44').value = 'Project NPV';
    ws.getCell('K44').value = 180.67;

    const r = checkTerminalValueConcentration(wb);
    check('real bug fixed: the clean, exact "Terminal value" label (255.31) wins over a long row-description sentence that merely mentions the phrase (-3185000)',
      r.terminalValue === 255.31 && r.terminalValueLocation === 'Valuation!B13');
    check('real bug fixed: the genuine "Project NPV" label (180.67) wins over the unrelated "Enterprise value" label (278.50), regardless of array order',
      r.totalNpv === 180.67 && r.totalNpvLocation === 'Valuation!K44');
    check('real bug fixed: the resulting concentration is a sane, real percentage, not a nonsensical negative six-figure one',
      r.concentrationPct > 0 && r.concentrationPct < 10);
  }

  // ══════════════════════════════════════════════════════════════════
  // The money() display bug found on the same real report — a model
  // whose values are already expressed in millions (per its own "A$m"
  // unit label) was having those values divided by a million AGAIN,
  // producing a misleading "$0.0M" for genuinely material figures like
  // $255.3M and $180.7M.
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Valuation');
    ws.getCell('A1').value = 'Terminal value';
    ws.getCell('B1').value = 255.31; // already in millions, per this model's own convention
    ws.getCell('A2').value = 'Project NPV';
    ws.getCell('B2').value = 180.67;

    const r = checkTerminalValueConcentration(wb);
    check('real display bug fixed: an already-in-millions value is shown as-is, not divided by a million again ("$255.3M", not "$0.0M")',
      r.note.includes('$255.3M') && !r.note.includes('$0.0M'));

    // Confirm the fix doesn't break the ordinary, intended case — a
    // genuinely raw-dollar value, in a scenario that actually crosses
    // the flag threshold so the money()-formatted note path is
    // exercised (the non-flagged note template never calls money() at
    // all, so a below-threshold case wouldn't test this).
    const wb2 = new ExcelJS.Workbook();
    const ws2 = wb2.addWorksheet('Valuation');
    ws2.getCell('A1').value = 'Terminal value';
    ws2.getCell('B1').value = 70000000; // genuine raw dollars, matching the real Wave 1 verification figure's order of magnitude
    ws2.getCell('A2').value = 'Project NPV';
    ws2.getCell('B2').value = 100000000;
    const r2 = checkTerminalValueConcentration(wb2);
    check('the money() fix does not break the ordinary raw-dollar case — still correctly shown as "$70.0M", not divided again',
      r2.note.includes('$70.0M'));
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
