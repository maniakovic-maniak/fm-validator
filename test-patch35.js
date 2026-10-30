'use strict';
// Patch 35 checks: check independence, volatile run stamp, placeholder rows that hold zeros.
const { buildCheckWorkbook } = require('./scripts/check-fixtures');
const { runPathChecks, buildPathCheckFindings, pathCheckRows } = require('./src/utils/path-checks');
const { checkPlaceholderText } = require('./src/utils/placeholder-text-check');
const { sides } = require('./src/utils/check-independence');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };

(async () => {
  const { parseExcel } = require('./src/parser');
  const { runTier0 } = require('./src/validator-tier0');
  const parsed = await parseExcel(await buildCheckWorkbook());
  const t0 = await runTier0(parsed);
  const pc = runPathChecks(parsed._raw, t0.cellScoreIndex);
  const ci = pc.independence;
  const rec = c => ci.records.find(r => r.cell === c);

  check('a check whose sides read exactly the same cells is a Query (same cell)', rec('C22') && rec('C22').verdict === 'query' && rec('C22').kind === 'same_cell' && /zero by construction/.test(rec('C22').evidence));
  check('a check whose second side is built from the first is a Query (shared chain)', rec('C32') && rec('C32').verdict === 'query' && rec('C32').kind === 'shared_chain' && /moves both sides together/.test(rec('C32').evidence));
  check('a check with two independent sides passes, with the overlap stated', rec('C42') && rec('C42').verdict === 'passed' && /Neither side of M!C42 is built entirely from the other/.test(rec('C42').evidence) && rec('C42').shared === 0);
  check('a check that is not a plain difference is not judged', rec('C50') && rec('C50').verdict === 'not_applicable');
  check('sides() reads ROUND(A-B,n), ABS(A-B) and A=B', !!sides('ROUND(C1-C2,2)') && !!sides('ABS(C1-C2)') && !!sides('C1=C2') && sides('C1+C2') === null);
  check('two different totals of the same cells are a shared chain', rec('C23') && rec('C23').verdict === 'query' && rec('C23').kind === 'shared_chain');
  check('the counts add up', ci.counts.query === 3 && ci.counts.passed === 1 && ci.notCompleted === 0 && ci.tested === 4);
  check('a limit that stops the walk is counted as not completed, not guessed', (() => {
    const { checkIndependence } = require('./src/utils/check-independence');
    const r = checkIndependence(parsed._raw, t0.cellScoreIndex, { timeBudgetMs: -1 });
    return r.timedOut === true && r.notCompleted > 0 && r.records.length > 0 && r.records.every(x => x.verdict === 'not_completed');
  })());

  const ts = pc.timestamp;
  check('a cell that is only NOW() is reported with its saved date', ts.records.length === 1 && ts.records[0].cell === 'B1' && ts.records[0].saved === '2020-12-07');
  check('NOW() inside a calculation is left alone', !ts.records.some(r => r.cell === 'B2'));

  const findings = buildPathCheckFindings(pc);
  const f = id => findings.find(x => x.id === id);
  check('the independence finding is a Query that names the cells and does not claim a defect', f('T0-CHECKIND-001') && f('T0-CHECKIND-001').record_type === 'Query' && /check/i.test(f('T0-CHECKIND-001').label) && f('T0-CHECKIND-001').confidence < 60);
  check('the timestamp finding is an Observation', f('T0-VOLTIME-001') && f('T0-VOLTIME-001').record_type === 'Observation');
  check('a passed check raises no finding', !findings.some(x => x.cell === 'C42'));
  const rows = pathCheckRows(pc);
  check('the Path Checks tab lists the passed check and both queries', rows.rows.filter(r => r.criterion === 'Check independence').length === 4 && rows.rows.some(r => r.criterion === 'Volatile timestamp'));
  check('the tab summary includes the new criteria', rows.summary.some(s => s.criterion === 'Check independence' && s.tested === 4) && rows.summary.some(s => s.criterion === 'Volatile timestamp'));

  // placeholder rows that hold zeros
  const pt = checkPlaceholderText(parsed._raw);
  check('a placeholder note followed by zeros is flagged', pt.findings.some(x => x.sheet === 'Out' && x.cell === 'B4'));
  check('a note on a row that also holds real numbers is still ignored', !pt.findings.some(x => x.cell === 'B9') && pt.mentionsIgnored >= 1);
  check('the count by sheet is reported', pt.bySheet && pt.bySheet.Out === 1);

  console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
  process.exit(fails ? 1 : 0);
})();
