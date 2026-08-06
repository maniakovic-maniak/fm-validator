const fs = require('fs');
const ExcelJS = require('exceljs');
const { findOwnerDecisionChecklist, extractOwnerDecisionItems } = require('./src/utils/owner-decision-checklist.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// Unit tests for the parsing logic directly.
// ══════════════════════════════════════════════════════════════════
check('extractOwnerDecisionItems correctly parses the exact real pattern into 6 items',
  JSON.stringify(extractOwnerDecisionItems('OWNER DECISIONS: executed lender terms; written Australian tax/GST advice; independent property valuation; approved OpCo margin and multiple; final QS cost plan; executed shareholder and waterfall terms.'))
  === JSON.stringify(['executed lender terms', 'written Australian tax/GST advice', 'independent property valuation', 'approved OpCo margin and multiple', 'final QS cost plan', 'executed shareholder and waterfall terms']));

check('extractOwnerDecisionItems returns null for ordinary text that is not an owner-decisions cell',
  extractOwnerDecisionItems('Just some ordinary label text') === null);

check('extractOwnerDecisionItems returns null for a non-string input',
  extractOwnerDecisionItems(null) === null && extractOwnerDecisionItems(42) === null);

check('extractOwnerDecisionItems is case-insensitive and tolerates minor spacing variation',
  JSON.stringify(extractOwnerDecisionItems('owner decisions:  item one; item two')) === JSON.stringify(['item one', 'item two']));

// ══════════════════════════════════════════════════════════════════
// End-to-end confirmation against real models. FIX: found via a real
// deployment crash on the user's own server — these paths only exist
// in the analysis sandbox that originally verified this check, not on
// a production machine. Guarded with fs.existsSync (matching the
// pattern already proven correct in test-error-scan-coverage-check.js)
// so this test degrades to a graceful skip in an environment without
// these files, rather than crashing the whole test run before the
// file-independent unit tests above even get a chance to report.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const refFiles = [
    ['/mnt/user-data/uploads/The_Bend_FInancial_Model_3_8_2026.xlsx', 'real defect fixed: the exact 6-item real checklist (Summary!O17) is found and parsed correctly',
      r => r && r.sheet === 'Summary' && r.cell === 'O17' && r.items.length === 6],
    ['/mnt/project/The_Bend_Precinct_Model_Investor_Ready_12.xlsm', 'a genuinely different, related model with a different 7-item checklist is also found and parsed correctly',
      r => r && r.items.length === 7 && r.items[0] === 'executed investor/shareholder documents'],
    ['/mnt/project/Qantas_1.xlsx', 'a model with no owner-decisions cell at all correctly returns null, not a false positive',
      r => r === null],
  ];
  for (const [file, desc, assertion] of refFiles) {
    if (!fs.existsSync(file)) { console.log(`SKIPPED: ${file} not present in this environment`); continue; }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const result = findOwnerDecisionChecklist(wb);
    check(desc, assertion(result));
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
