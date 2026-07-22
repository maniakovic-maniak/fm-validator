const { extractCellRef, buildRootCauseFields } = require('./src/utils/root-cause-consolidation');

function run() {
  let allPass = true;

  // extractCellRef: cover every field-name variant surveyed across real checks
  const cases = [
    [{ sheet: 'Model', cell: 'A1' }, 'Model!A1', 'standard cell field'],
    [{ sheet: 'Model', componentCell: 'B10' }, 'Model!B10', 'componentCell field (revenue-double-counting)'],
    [{ sheet: 'Model', taxCell: 'C11' }, 'Model!C11', 'taxCell field (tax-effective-rate)'],
    [{ sheet: 'Model', beforeCell: 'D5', afterCell: 'E5' }, 'Model!D5', 'paired beforeCell/afterCell (period-sequence-gap)'],
    [{ sheet: 'Model', row: 20, terminalCells: ['J20', 'K20'] }, 'Model!J20', 'row-based with terminalCells (terminal-period)'],
    [{ sheet: 'Model', row: 30 }, 'Model!Row30', 'row-based fallback with no terminalCells'],
    [{ notASheet: 'x' }, null, 'no sheet at all -> null'],
    [{ sheet: 'Model' }, null, 'sheet present but no recognizable cell field -> null'],
    [{ componentCell: 'P&L!B10' }, 'P&L!B10', 'ALREADY-formatted "Sheet!Cell" string with no separate sheet field (the real revenue-double-counting bug found and fixed)'],
  ];
  for (const [input, expected, desc] of cases) {
    const got = extractCellRef(input);
    const pass = got === expected;
    if (!pass) allPass = false;
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc} (expected ${expected}, got ${got})`);
  }

  // buildRootCauseFields: a realistic synthetic check result
  const checkResult = {
    findings: [
      { sheet: 'SheetA', cell: 'A1' },
      { sheet: 'SheetA', cell: 'A2' },
      { sheet: 'SheetB', cell: 'B5' },
    ],
  };
  const rc = buildRootCauseFields('T0-TEST-001', checkResult, { commonRemediationAction: 'Fix the thing.' });
  const rcPass = rc.root_cause_id === 'T0-TEST-001'
    && rc.master_finding_id === 'T0-TEST-001'
    && rc.occurrence_count === 3
    && rc.material_occurrence_count === 3
    && JSON.stringify(rc.affected_cells) === JSON.stringify(['SheetA!A1', 'SheetA!A2', 'SheetB!B5'])
    && JSON.stringify(rc.affected_sheets) === JSON.stringify(['SheetA', 'SheetB'])
    && rc.common_remediation_action === 'Fix the thing.';
  console.log(`${rcPass ? 'PASS' : 'FAIL'}: buildRootCauseFields produces correct structured output`);
  if (!rcPass) allPass = false;

  // materialityFilter option
  const rcFiltered = buildRootCauseFields('T0-TEST-002', checkResult, {
    materialityFilter: (item) => item.sheet === 'SheetA',
  });
  const filterPass = rcFiltered.occurrence_count === 3 && rcFiltered.material_occurrence_count === 2;
  console.log(`${filterPass ? 'PASS' : 'FAIL'}: materialityFilter correctly narrows material_occurrence_count without changing occurrence_count`);
  if (!filterPass) allPass = false;

  // Empty/missing findings array must not crash
  const rcEmpty = buildRootCauseFields('T0-TEST-003', {});
  const emptyPass = rcEmpty.occurrence_count === 0 && rcEmpty.affected_cells.length === 0;
  console.log(`${emptyPass ? 'PASS' : 'FAIL'}: missing findings array handled gracefully, no crash`);
  if (!emptyPass) allPass = false;

  // buildRootCauseFieldsFromResults: the results[]-shaped adapter, for
  // sign-convention-check.js (positive+negative nested arrays) and
  // balance-never-negative-check.js (negative-only nested arrays)
  const { buildRootCauseFieldsFromResults } = require('./src/utils/root-cause-consolidation');

  const signConventionShape = {
    results: [
      { label: 'Capex', flagged: true,
        positiveInstances: [{ sheet: 'SheetA', cell: 'A1', value: 100 }],
        negativeInstances: [{ sheet: 'SheetB', cell: 'B2', value: -50 }] },
      { label: 'Opex', flagged: false, positiveInstances: [], negativeInstances: [] }, // must be excluded — not flagged
    ],
  };
  const rcSign = buildRootCauseFieldsFromResults('T0-SIGNCONV-001', signConventionShape);
  const signPass = rcSign.occurrence_count === 1 // only the flagged group counts
    && JSON.stringify(rcSign.affected_cells.sort()) === JSON.stringify(['SheetA!A1', 'SheetB!B2'])
    && JSON.stringify(rcSign.affected_sheets.sort()) === JSON.stringify(['SheetA', 'SheetB']);
  console.log(`${signPass ? 'PASS' : 'FAIL'}: buildRootCauseFieldsFromResults handles sign-convention shape (positive+negative nested arrays, excludes unflagged groups)`);
  if (!signPass) allPass = false;

  const balanceNeverNegShape = {
    results: [
      { label: 'Cash balance', flagged: true,
        negativeInstances: [{ sheet: 'SheetC', cell: 'C10', value: -1 }, { sheet: 'SheetC', cell: 'C11', value: -2 }] },
    ],
  };
  const rcBalNeg = buildRootCauseFieldsFromResults('T0-BALNEG-001', balanceNeverNegShape);
  const balNegPass = rcBalNeg.occurrence_count === 1
    && JSON.stringify(rcBalNeg.affected_cells) === JSON.stringify(['SheetC!C10', 'SheetC!C11']);
  console.log(`${balNegPass ? 'PASS' : 'FAIL'}: buildRootCauseFieldsFromResults handles balance-never-negative shape (negative-only nested array)`);
  if (!balNegPass) allPass = false;

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}
run();
