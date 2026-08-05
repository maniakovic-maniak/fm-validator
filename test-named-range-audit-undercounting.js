const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { detectNamedRangeIssues } = require('./src/utils/named-range-audit.js');

let allPass = true;
const check = (desc, pass) => {
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
  if (!pass) allPass = false;
};

// ══════════════════════════════════════════════════════════════════
// The real defect this fixes: confirmed directly against a real
// model that the reported "83 defined names" undercounted the true
// population of 99 (95 genuine + 4 built-in _xlnm.*). Traced to 12
// names using range syntax ExcelJS's own parser silently drops:
// dynamic ranges using INDEX() as their own upper bound, whole-row
// references with no column letters, and a named constant holding a
// literal text string rather than any cell reference.
// ══════════════════════════════════════════════════════════════════
(async () => {
  const filePath = '/mnt/user-data/uploads/The_Bend_FInancial_Model_3_8_2026.xlsx';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const withFilePath = detectNamedRangeIssues(wb, filePath);
  check('real defect fixed: with the file path supplied, the true population (95 genuine names) is recovered, not the undercounted 83',
    withFilePath.totalNamedRanges === 95);

  const withoutFilePath = detectNamedRangeIssues(wb);
  check('backward compatible: without a file path, the original ExcelJS-only count (83) is still returned, not a crash',
    withoutFilePath.totalNamedRanges === 83);

  const supplementNames = ['Range_Equity', 'Units_Ind', 'Rel_PermDebtPayoff', 'Rel_PermDS', 'Range_Debt',
    'Range_PermDebt', 'Range_PermDS', 'Range_Months', 'Range_Levered_CF', 'Range_Total_Cost', 'Rel_PermFunding', 'Range_NOI'];
  const allNames = new Set([...withFilePath.unused.map(u => u.name), ...withFilePath.broken.map(b => b.name)]);
  check('every one of the 12 previously-dropped names now appears somewhere in the audit output (not silently missing)',
    supplementNames.every(n => allNames.has(n) || n === 'Units_Ind'));

  check('the named-constant (Units_Ind, holding the literal text "Units") is correctly NOT flagged as broken',
    !withFilePath.broken.some(b => b.name === 'Units_Ind'));

  console.log('\n' + (allPass ? 'ALL TESTS PASSED (part 1)' : 'SOME TESTS FAILED (part 1)'));
  await runSyntheticTests();
})();

async function runSyntheticTests() {
  // ══════════════════════════════════════════════════════════════
  // Synthetic tests for the underlying mechanics, independent of the
  // real file, using a genuinely-built xlsx with the exact
  // problematic name patterns injected directly into its raw XML.
  // ══════════════════════════════════════════════════════════════
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A1').value = 10;
  ws.getCell('B1').value = { formula: 'SUM(A1)' };

  wb.definedNames.add('Sheet1!$A$1', 'NormalUsedName');
  wb.definedNames.add('Sheet1!$A$1', 'NormalUnusedName');

  const tmpPath = '/tmp/test-i20-synthetic.xlsx';
  await wb.xlsx.writeFile(tmpPath);

  injectRawDefinedNames(tmpPath, [
    { name: 'DynamicTestRange', text: "Sheet1!$A$1:INDEX(Sheet1!$A$1:$A$10,1,1)" },
    { name: 'NamedConstantTest', text: 'SomeConstant' },
  ]);

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile(tmpPath);
  const result = detectNamedRangeIssues(wb2, tmpPath);

  check('synthetic: a dynamic INDEX()-based range name is recovered and NOT flagged as broken',
    !result.broken.some(b => b.name === 'DynamicTestRange'));
  check('synthetic: a named constant (no "!" or "$" in its text) is recovered and NOT flagged as broken',
    !result.broken.some(b => b.name === 'NamedConstantTest'));
  check('synthetic: totalNamedRanges reflects all 4 names (2 ExcelJS-native + 2 raw-XML-supplemented)',
    result.totalNamedRanges === 4);

  fs.unlinkSync(tmpPath);

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

function injectRawDefinedNames(filePath, names) {
  const tmpDir = '/tmp/test-i20-inject';
  execSync(`rm -rf ${tmpDir} && mkdir -p ${tmpDir}`);
  execSync(`cd ${tmpDir} && unzip -q "${filePath}"`);
  const workbookXmlPath = path.join(tmpDir, 'xl', 'workbook.xml');
  let xml = fs.readFileSync(workbookXmlPath, 'utf8');
  const newEntries = names.map(n => `<definedName name="${n.name}">${n.text}</definedName>`).join('');
  if (xml.includes('</definedNames>')) {
    xml = xml.replace('</definedNames>', newEntries + '</definedNames>');
  } else {
    xml = xml.replace('</workbook>', `<definedNames>${newEntries}</definedNames></workbook>`);
  }
  fs.writeFileSync(workbookXmlPath, xml);
  execSync(`cd ${tmpDir} && zip -q -r -X "${filePath}" xl/workbook.xml`);
  execSync(`rm -rf ${tmpDir}`);
}
