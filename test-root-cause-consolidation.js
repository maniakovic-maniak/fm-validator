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

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}
run();
