'use strict';
// Patch 36 checks: text results in date-formatted cells, calculated lookup keys, the scope line.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { buildLabelWorkbook } = require('./scripts/check-fixtures');
const { evalKeyExpr, deriveValue } = require('./src/utils/key-expression');
const { checkLookupContracts } = require('./src/utils/lookup-contract');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };

(async () => {
  const { parseExcel } = require('./src/parser');
  const { runTier0 } = require('./src/validator-tier0');
  const { makeReader } = require('./src/utils/path-checks-common');
  const file = await buildLabelWorkbook();

  // the reader problem, and its repair
  const ExcelJS = require('exceljs');
  const raw = new ExcelJS.Workbook(); await raw.xlsx.readFile(file);
  const before = raw.getWorksheet('P').getCell('D1').result;
  check('exceljs alone turns a text result in a date-formatted cell into an Invalid Date (the problem)', before instanceof Date && isNaN(before.getTime()));
  const parsed = await parseExcel(file);
  const rd = makeReader(parsed._raw);
  check('the loader reads the text back from the file', rd.value('P', 1, 4) === 'FY27' && rd.value('P', 1, 5) === 'FY28');
  check('the recovery is reported', parsed._textRecovery && parsed._textRecovery.found === 3 && parsed._textRecovery.recovered === 3 && parsed._textRecovery.skipped === 0);
  check('the sheet rows given to the reviewer carry the text too', JSON.stringify(parsed.sheets.P).includes('FY27'));
  check('formulas are untouched', /FY/.test(String(parsed._raw.getWorksheet('P').getCell('D1').value.formula)));
  check('a real date in a date cell is left alone', parsed._raw.getWorksheet('P').getCell('C3').value instanceof Date && !isNaN(parsed._raw.getWorksheet('P').getCell('C3').value.getTime()));

  // expressions
  const ev = (e) => evalKeyExpr(e, 'P', rd);
  check('a year from a label: 2000+VALUE(RIGHT(E1,2)) = 2028', ev('2000+VALUE(RIGHT(E1,2))') === 2028);
  check('prior year from a date: YEAR($C$3)-1 = 2027', ev('YEAR($C$3)-1') === 2027);
  check('brackets, unary minus and precedence', ev('-(2+3)*2') === -10 && ev('2+3*4') === 14 && ev('(2+3)*4') === 20);
  check('text in arithmetic is not guessed', ev('A1+1') === null && ev('"x"+1') === null);
  check('an unknown function, a range, a blank, a divide by zero and an open bracket give null', ev('SUM(C2:E2)') === null && ev('Z99+1') === null && ev('1/0') === null && ev('(1+2') === null && ev('FOO(1)') === null);
  check('MID, LEFT and LEN', ev('VALUE(MID(E1,3,2))') === 28 && ev('LEFT(E1,2)') === 'FY' && ev('LEN(E1)') === 4);
  check('deriveValue reads a date or a serial', deriveValue('YEAR', new Date(Date.UTC(2027, 5, 30))) === 2027 && deriveValue('YEAR', 46203) === 2026 && deriveValue('YEAR', 'x') === null);

  // lookups end to end
  const t0 = await runTier0(parsed);
  const lc = checkLookupContracts(parsed._raw, t0.cellScoreIndex);
  const rec = c => lc.records.find(r => r.cell === c);
  check('a lookup on a recovered label is tested and passes', rec('C6') && rec('C6').verdict === 'passed');
  check('a lookup on a calculated key is tested and passes', rec('C7') && rec('C7').verdict === 'passed');
  check('a lookup on the prior year of a date passes', rec('C8') && rec('C8').verdict === 'passed');
  check('a lookup whose array is YEAR(range) passes', rec('C9') && rec('C9').verdict === 'passed');
  check('a calculated key that matches no row is a defect, not a pass', rec('C12') && rec('C12').verdict === 'defect');
  check('nothing is left as not read', lc.notCompleted === 0 && lc.tested === 5);
  const nc = checkLookupContracts(parsed._raw, Object.assign({}, t0.cellScoreIndex), {});
  check('examples of anything not completed are kept for the reader', typeof nc.notCompletedExamples === 'object');

  // scope line in the report
  const cl = JSON.parse(fs.readFileSync('config/checklist.json', 'utf8'));
  const allPass = [...(cl.tier1 || []), ...(cl.tier2 || [])].map(r => ({ id: r.id, status: 'pass' }));
  const build = (scopeSummary, excluded) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rep36-'));
    const payload = { originalName: 't.xlsx', modelType: 't', modelIndustry: 't', modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['S'] },
      tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] }, overallAssessment: 'audit_complete', igReadiness: 90, igCommentary: 't', ruleResults: allPass, errorScan: [],
      redundantInputs: { applicable: false }, orphanSheets: { applicable: false }, namedRangeAudit: { applicable: false }, formulaDeepDive: { applicable: false }, reasonableness: {}, duplicateSheets: { applicable: false },
      vbaReview: { applicable: false }, deepAccountingResolvedSheets: {}, crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings: [], scopeSummary, excludedRuleIds: excluded };
    fs.writeFileSync(path.join(d, 'p.json'), JSON.stringify(payload));
    const b = spawnSync('python3', ['src/build_report.py', path.join(d, 'p.json'), path.join(d, 'o.xlsx')], { encoding: 'utf8', timeout: 180000 });
    if (b.status !== 0) return '';
    const py = 'import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1])\nws=wb["Scope and Reliance"]\nprint("\\n".join(str(c.value) for r in ws.iter_rows() for c in r if c.value is not None))';
    return spawnSync('python3', ['-c', py, path.join(d, 'o.xlsx')], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).stdout || '';
  };
  const t2n = (cl.tier2 || []).length;
  const excl = (cl.tier2 || []).slice(0, 40).map(r => r.id);
  const withSent = build({ discloseInReport: true, notApplicable: 40, evidenceRequired: [], extendedNotRun: 0, tier2Sent: t2n + 5 }, excl);
  check('the Scope tab says how many procedures the reviewer was given and how many are counted', /were put to the reviewer/.test(withSent) && /set aside after the run/.test(withSent));
  const without = build({ discloseInReport: true, notApplicable: 40, evidenceRequired: [], extendedNotRun: 0 }, excl);
  check('a payload without the count adds no line', !/were put to the reviewer/.test(without) && /Claude semantic checks/.test(without));

  console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 36 checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL: ' + e.stack); process.exit(1); });
