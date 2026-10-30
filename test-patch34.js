'use strict';
// Patch 34 checks: remedies that cite cells in prose, duplicate Critical Queries.
const { buildRemedyWorkbook, proseFindings } = require('./scripts/remedy-fixtures');
const { applyRemedyChecks, proseCitations, valueAgrees } = require('./src/utils/remedy-check');
const { classifyRecordType, assignRecordTypes, mergeDuplicateCriticalQueries } = require('./src/utils/record-type-classifier');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };

(async () => {
  const { parseExcel } = require('./src/parser');
  const { runTier0 } = require('./src/validator-tier0');
  const parsed = await parseExcel(await buildRemedyWorkbook());
  const t0 = await runTier0(parsed);
  const f = proseFindings();
  const sum = applyRemedyChecks(Object.values(f), { workbook: parsed._raw, cellScoreIndex: t0.cellScoreIndex });
  const st = k => f[k].remedy_check && f[k].remedy_check.status;

  check('a pointer at the formula in a cell that holds a constant is withheld', st('formulaOnConstant') === 'withheld' && /no formula/.test(f.formulaOnConstant.remedy_check.reasons[0]));
  check('the cell is found although its sheet name has a space', /Fin Stmts!AP35/.test(f.formulaOnConstant.remedy_check.reasons[0]));
  check('a pointer at the formula in a cell that holds one is confirmed', st('formulaOnFormula') === 'verified');
  check('a quoted value the file supports (0, and ~12.2m for 12,200,000) is confirmed', st('valueRight') === 'verified');
  check('a quoted value the file contradicts is withheld', st('valueWrong') === 'withheld' && /saved value is 12200000/.test(f.valueWrong.remedy_check.reasons[0]));
  check('a percentage is not read as a cell value', st('percentNotValue') === 'unverified');
  check('a sheet the workbook does not have is not guessed at', st('unknownSheet') === 'unverified');
  check('the withheld text is replaced and the original kept', /Remedy withheld/.test(f.valueWrong.fix_instruction) && /31\.5m/.test(f.valueWrong.remedy_check.original));
  check('summary counts', sum.checked === 6 && sum.withheld === 2 && sum.verified === 2 && sum.unverified === 2);
  check('valueAgrees allows rounding and units', valueAgrees(12200000, { expected: 12.2, unit: 1e6, decimals: 1 }) && valueAgrees(12.2, { expected: 12.2, unit: 1, decimals: 1 }) && !valueAgrees(12200000, { expected: 31.5, unit: 1e6, decimals: 1 }));
  check('prose citations without a claim are ignored', proseCitations('Look at Fin Stmts!AP35 again.', parsed._raw).length === 0);

  // duplicate Critical Queries
  const cq = (id, conf, cell = 'AP42') => ({ id, sheet: 'FinancialStatements', cell, severity: 'critical', confidence: conf, condition: 'AP42 shows 0 while AP122 shows 12.2m', record_type: 'Critical Query' });
  const set = [cq('T2-S5-004', 45), cq('T2-S10-004', 50), cq('T2-S10-014', 40, 'AP666'), cq('T2-S1-009', 50, 'A1'), cq('T2-S1-010', 50, 'A1')];
  const merged = mergeDuplicateCriticalQueries(set);
  // Patch 38: grouped for display only; every concern stays a Critical Query and keeps blocking
  check('two Critical Queries on one cell are grouped, none is demoted', merged.length === 1 && set.filter(x => x.record_type === 'Critical Query').length === 5);
  check('the weaker one names the stronger and both share a location group', set[0].record_type === 'Critical Query' && set[0].grouped_with === 'T2-S10-004' && set[0].same_location_group === set[1].same_location_group && !set[1].grouped_with);
  check('nothing is dropped', set.length === 5);
  check('cells that are only the A1 fallback are never merged', set[3].record_type === 'Critical Query' && set[4].record_type === 'Critical Query');
  check('running it twice changes nothing', mergeDuplicateCriticalQueries(set).length === 0);

  // Patch 7 stays: a critical-severity absence at low confidence keeps its Critical Query escalation
  const abs = { id: 'T2-S10-014', sheet: 'SystemOperator', cell: 'AP666', severity: 'critical', confidence: 40, category: 'Tax', condition: 'No explicit deferred tax balance or movement is tracked separately.' };
  check('a critical-rule absence at 40% keeps the Critical Query escalation (Patch 7 rule, unchanged)', classifyRecordType(abs) === 'Critical Query');

  console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
  process.exit(fails ? 1 : 0);
})();
