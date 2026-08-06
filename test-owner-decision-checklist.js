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
// End-to-end confirmation against real models.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.readFile('/mnt/user-data/uploads/The_Bend_FInancial_Model_3_8_2026.xlsx');
  const result1 = findOwnerDecisionChecklist(wb1);
  check('real defect fixed: the exact 6-item real checklist (Summary!O17) is found and parsed correctly',
    result1 && result1.sheet === 'Summary' && result1.cell === 'O17' && result1.items.length === 6);

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile('/mnt/project/The_Bend_Precinct_Model_Investor_Ready_12.xlsm');
  const result2 = findOwnerDecisionChecklist(wb2);
  check('a genuinely different, related model with a different 7-item checklist is also found and parsed correctly',
    result2 && result2.items.length === 7 && result2.items[0] === 'executed investor/shareholder documents');

  const wb3 = new ExcelJS.Workbook();
  await wb3.xlsx.readFile('/mnt/project/Qantas_1.xlsx');
  const result3 = findOwnerDecisionChecklist(wb3);
  check('a model with no owner-decisions cell at all correctly returns null, not a false positive',
    result3 === null);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
})();
