const { detectRedundantInputs } = require('./src/utils/redundant-inputs.js');
const ExcelJS = require('exceljs');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ══════════════════════════════════════════════════════════════════
  // Case 1: baseline — a sheet named "Inputs" with a genuinely
  // unreferenced constant and a genuinely referenced one
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const inputs = wb.addWorksheet('Inputs');
    const pl = wb.addWorksheet('P&L');
    inputs.getCell('A1').value = 'Growth Rate';
    inputs.getCell('B1').value = 0.03; // referenced below
    inputs.getCell('A2').value = 'Unused Constant';
    inputs.getCell('B2').value = 42; // never referenced anywhere
    pl.getCell('A1').value = { formula: 'Inputs!B1*1000', result: 30 };

    const result = detectRedundantInputs(wb);
    check('baseline: a sheet named "Inputs" is recognized directly by name', result.inputSheets.includes('Inputs'));
    check('baseline: the referenced constant is NOT flagged as redundant', !result.redundant.some(r => r.cell === 'B1'));
    check('baseline: the genuinely unreferenced constant IS flagged', result.redundant.some(r => r.cell === 'B2'));
  }

  // ══════════════════════════════════════════════════════════════════
  // Case 2: the real bug found on a live run — a sheet named "PROJECT
  // DATA" (no match on "input/assumption/driver/settings" in the NAME
  // alone) whose own title row literally reads "CENTRALISED INPUT
  // SCHEDULE". Before the fix, this sheet was invisible to the check
  // entirely — 0 sheets recognized, 0 inputs found, an empty tab that
  // looked like "no redundant inputs" but was actually "nothing was
  // even checked".
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const pd = wb.addWorksheet('PROJECT DATA');
    pd.getCell('A4').value = 'PROJECT DATA | CENTRALISED INPUT SCHEDULE';
    pd.getCell('A7').value = 'Field ID';
    pd.getCell('B7').value = 'Category';
    pd.getCell('A8').value = 'PRJ-001';
    pd.getCell('B8').value = 91.57; // an unreferenced constant

    const result = detectRedundantInputs(wb);
    check('real bug fixed: "PROJECT DATA" (no name match) IS now recognized via its own title-area text',
      result.inputSheets.includes('PROJECT DATA'));
    check('real bug fixed: the check is now applicable and finds the genuine constant',
      result.applicable !== false && result.totalInputs > 0);
  }

  // ══════════════════════════════════════════════════════════════════
  // Case 3: the real false-positive class found on the same run — a
  // sheet named "DATA MAP" whose own title reads "SOURCE-TO-TARGET
  // TRACEABILITY & ISSUE..." must NOT be recognized as an input sheet,
  // since its title text contains none of input/assumption/driver/
  // settings — this confirms the title-text check is precise, not a
  // blanket "any sheet with DATA in the name" match.
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const dm = wb.addWorksheet('DATA MAP');
    dm.getCell('A4').value = 'DATA MAP | SOURCE-TO-TARGET TRACEABILITY & ISSUE LOG';
    dm.getCell('A7').value = 'Field ID';
    dm.getCell('B8').value = 'Project name';

    const result = detectRedundantInputs(wb);
    check('a documentation/traceability sheet ("DATA MAP") is correctly NOT recognized as an input sheet, despite sharing "DATA" in its name with a genuine input sheet',
      !result.inputSheets.includes('DATA MAP'));
  }

  // ══════════════════════════════════════════════════════════════════
  // Case 4: the real, severe false-positive class found on the same
  // run — a genuine summary/display "INVESTOR DASHBOARD" sheet
  // incidentally mentions "assumptions" in narrative prose describing
  // what underlies its figures, without being an input schedule at
  // all. On the real file, this alone contributed 196 of 274 findings
  // (71%) — sensitivity-table range labels misread as unreferenced
  // input constants. Must be excluded from title-text-based detection.
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const dash = wb.addWorksheet('INVESTOR DASHBOARD');
    dash.getCell('A4').value = 'Current assumption';
    dash.getCell('A6').value = 'Under the current funding and valuation assumptions, the investor invests $12m across three tranches.';
    dash.getCell('A9').value = '50.00% \u2192 5.39%'; // a sensitivity-table range label, not a genuine input
    dash.getCell('B9').value = 12;

    const result = detectRedundantInputs(wb);
    check('real severe false-positive fixed: a genuine dashboard sheet mentioning "assumptions" only in narrative prose is NOT recognized as an input sheet',
      !result.inputSheets.includes('INVESTOR DASHBOARD'));
  }

  // ══════════════════════════════════════════════════════════════════
  // Case 5: a sheet EXPLICITLY named with "dashboard" AND an explicit
  // input-style word in its own NAME (not just title text) should
  // still be excluded from title-text detection specifically, but
  // this does not change the existing name-based Level check — the
  // exclusion is scoped to the title-text path only, confirming the
  // dashboard guard doesn't accidentally suppress a legitimate direct
  // name match elsewhere in the codebase's OTHER name-matching logic.
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const dash = wb.addWorksheet('Assumptions Dashboard');
    dash.getCell('A1').value = 'Growth Rate';
    dash.getCell('B1').value = 55;

    const result = detectRedundantInputs(wb);
    check('a sheet whose own NAME contains an input-style word (not just title text) is still recognized even if it also contains "dashboard"',
      result.inputSheets.includes('Assumptions Dashboard'));
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
