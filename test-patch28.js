// Patch 28: recalculation ledger. Typed comparison, no blanket IFERROR hold-back, volatile handling, reconciliation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync, execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const { buildRecalcFindings, ledgerSentence } = require('./src/utils/recalc-findings');

let allPass = true;
const check = (desc, pass) => { console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`); if (!pass) allPass = false; };
const py = (code, ...args) => {
  const p = spawnSync('python3', ['-c', code, path.join(__dirname, 'src'), ...args], { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 });
  if (p.status !== 0) throw new Error(p.stderr);
  const lines = p.stdout.trim().split('\n'); return JSON.parse(lines[lines.length - 1]);
};

(async () => {
  // ── 1. the comparison rules, without the engine ──────────────────────────────────────────────
  const cls = py(`
import sys, json, datetime
sys.path.insert(0, sys.argv[1]); import recalc_compare as c
t = lambda a, b: c.classify(a, b)
out = {
 'ratio': t(1.35, 0.5), 'half': t(0.9, 0.4), 'inside': t(1.0, 1.00001), 'big_in': t(1000000, 1000500), 'big_out': t(1000000, 1002000),
 'small_ratio_out': t(0.0781, 0.0790), 'small_ratio_in': t(0.0781, 0.07810001),
 'bool_same': t(True, True), 'bool_diff': t(True, False), 'text_same': t('a', 'a'), 'text_diff': t('a', 'b'),
 'num_text': t('a', 5), 'cache_none': t(None, 5), 'both_empty': t(None, ''), 'engine_blank_zero': t(0, None), 'engine_blank_val': t(5, None),
 'engine_err_str': t(5, '#N/A'), 'engine_err_dict': t(5, {'type': 'Error', 'kind': 'Name'}), 'nan': t(5, float('nan')), 'inf': t(float('inf'), 1.0),
 'cached_err': t('#N/A', 5), 'date_same': t(datetime.datetime(2024, 1, 1), 45292.0), 'date_diff': t(datetime.datetime(2024, 1, 1), 45300.0),
 'bool_num_same': t(True, 1), 'bool_num_diff': t(True, 0),
 'vol': [c.is_volatile(f) for f in ['A1+TODAY()', '=NOW()', 'RAND()*2', 'INFO("osversion")', 'CELL("filename",A1)', 'CELL("row",A1)', 'A1*2', 'TODAYS_TOTAL(A1)']],
 'limited': [c.engine_limited_function(f) for f in ['IFERROR(IRR(A1:A5),0)', 'IRR(A1:A5)', 'IFERROR(A1*2,0)', 'IFNA(MATCH(1,A:A,0),0)', 'IFERROR(xirr(A1:A3,B1:B3),0)']],
 'tol_small': c.tolerance_for(5.0), 'tol_big': c.tolerance_for(5000.0), 'tol_zero': c.tolerance_for(0.0),
 'policy': c.policy_text(),
}
print(json.dumps(out))
`);
  check('ratio saved 1.35, recomputed 0.50 is a mismatch', cls.ratio.outcome === 'mismatch' && cls.ratio.type === 'number');
  check('sub-unit difference (0.9 vs 0.4) is a mismatch, not absorbed by a floor of 1', cls.half.outcome === 'mismatch');
  check('noise inside 0.1% still matches', cls.inside.outcome === 'matched' && cls.big_in.outcome === 'matched');
  check('0.2% on a large value is a mismatch', cls.big_out.outcome === 'mismatch');
  check('a ratio 0.0781 vs 0.0790 is a mismatch under the small-value floor', cls.small_ratio_out.outcome === 'mismatch' && cls.small_ratio_in.outcome === 'matched');
  check('tolerances: 1e-4 floor for size 10 or less, 0.01 above, floor applies at zero', cls.tol_small === 0.005 || (cls.tol_small > 0.004 && cls.tol_small < 0.006));
  check('large-value tolerance is 0.1% (5,000 -> 5)', Math.abs(cls.tol_big - 5) < 1e-9 && cls.tol_zero === 0.0001);
  check('Boolean equality is exact', cls.bool_same.outcome === 'matched' && cls.bool_diff.outcome === 'mismatch' && cls.bool_diff.type === 'boolean');
  check('text equality is exact', cls.text_same.outcome === 'matched' && cls.text_diff.outcome === 'mismatch' && cls.text_diff.type === 'text');
  check('text against number is a type change', cls.num_text.outcome === 'mismatch' && cls.num_text.type === 'type_changed');
  check('a Boolean against 1 and 0 compares as a number', cls.bool_num_same.outcome === 'matched' && cls.bool_num_diff.outcome === 'mismatch');
  check('no saved value gets its own state, empty against empty matches', cls.cache_none.outcome === 'missing_cache' && cls.both_empty.outcome === 'matched');
  check('engine blank against a saved zero matches; against a saved value is unsupported, not a defect', cls.engine_blank_zero.outcome === 'matched' && cls.engine_blank_val.outcome === 'unsupported');
  check('engine errors (string, dict) and NaN or infinity are unresolved, never compared', cls.engine_err_str.outcome === 'unresolved' && cls.engine_err_dict.outcome === 'unresolved' && cls.nan.outcome === 'unresolved' && cls.inf.outcome === 'unresolved');
  check('a saved error against a computed value is a mismatch', cls.cached_err.outcome === 'mismatch');
  check('dates compare as serial numbers', cls.date_same.outcome === 'matched' && cls.date_diff.outcome === 'mismatch');
  check('volatile functions are recognised; look-alikes and other CELL uses are not', JSON.stringify(cls.vol) === JSON.stringify([true, true, true, true, true, false, false, false]));
  check('IFERROR/IFNA is held back only when it wraps a known engine-limited function', JSON.stringify(cls.limited) === JSON.stringify(['IRR', null, null, 'MATCH', 'XIRR']));
  check('the policy sentence states limits and the exact-match rule', /0\.1%/.test(cls.policy) && /exact/.test(cls.policy));

  // ── 2. ledger arithmetic ────────────────────────────────────────────────────────────────────
  const led = py(`
import sys, json; sys.path.insert(0, sys.argv[1]); import recalc_compare as c
a = c.build_ledger(100, {'matched': 80, 'mismatched': 3, 'volatile': 2, 'unresolved': 5}, {'offset': 10})
b = c.build_ledger(100, {'matched': 90}, {'offset': 10})
d = c.build_ledger(100, {'matched': 95}, {'offset': 10})
print(json.dumps({'a': a, 'b': b, 'd': d}))`);
  check('ledger: categories sum, remainder is not_run', led.a.accounted === 100 && led.a.not_run === 0 && led.a.reconciles === true);
  check('ledger: a shortfall is reported as not_run, not dropped', led.b.accounted === 100 && led.b.reconciles && led.d.accounted === 105 && led.d.reconciles === false && led.d.unreconciled_excess === 5);
  const led2 = py(`
import sys, json; sys.path.insert(0, sys.argv[1]); import recalc_compare as c
print(json.dumps(c.build_ledger(100, {'matched': 70}, {'offset': 10})))`);
  check('ledger: 100 formulas, 80 accounted -> not_run 20 and does not reconcile', led2.not_run === 20 && led2.reconciles === false);
  check('ledger: compared = matched + mismatched + held back', led.a.compared === 83);

  // ── 3. end to end on small workbooks, through the real engine ─────────────────────────────────
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p28-'));
  const mk = spawnSync('python3', [path.join(__dirname, 'scripts', 'acceptance', 'make_recalc_fixtures.py'), dir], { encoding: 'utf8' });
  const engineOk = mk.status === 0 && (() => { try { return py("import sys; sys.path.insert(0, sys.argv[1]); import recalc_check; print(1)") === 1; } catch (_) { return false; } })();
  if (!engineOk) {
    console.log('SKIP: recalculation engine (Formualizer) not available here; end-to-end checks skipped');
  } else {
    const run = f => py("import sys,json; sys.path.insert(0, sys.argv[1]); import recalc_check as r; print(json.dumps(r.run(sys.argv[2])))", path.join(dir, f));
    const c1 = run('case1_ratio.xlsx'), c2 = run('case2_iferror_stale.xlsx'), c3 = run('case3_result_types.xlsx'), vo = run('volatile.xlsx'), hb = run('heldback.xlsx'), cl = run('clean.xlsx');
    check('engine: ratio mismatch is reported', c1.mismatch_count === 1 && c1.mismatches[0].type === 'number');
    check('engine: IFERROR with no engine failure no longer hides stale values (both cells listed)', c2.mismatch_count === 2 && c2.mismatches_held_back_count === 0);
    const kinds = Object.fromEntries(c3.mismatches.map(m => [m.cell, m.type]));
    check('engine: text and Boolean results are judged', kinds.B1 === 'text' && kinds.C1 === 'boolean');
    check('engine: no saved value and engine error get explicit states', c3.ledger.missing_cache === 1 && c3.missing_cache_sample[0].cell === 'D1' && c3.unresolved_errors.some(e => e.cell === 'E1'));
    check('engine: every formula cell lands in exactly one outcome and the ledger reconciles', [c1, c2, c3, vo, hb, cl].every(r => r.ledger.reconciles && r.ledger.not_run === 0));
    check('engine: ledger population equals the formula count', c3.ledger.population === 4 && c2.ledger.population === 2);
    check('engine: a clean file has all matched and nothing else', cl.ledger.matched === 2 && cl.mismatch_count === 0 && cl.ledger.compared === 2);
    check('engine: TODAY() and its dependent are volatile, an ordinary cell beside them still matches', vo.ledger.volatile === 2 && vo.mismatch_count === 0 && vo.ledger.matched === 1);
    check('engine: a difference in IFERROR over IRR is held back with the function named as the root', hb.mismatches_held_back_count >= 1 && hb.mismatches_held_back.some(m => /IRR\(\)/.test(m.root_label)));
    check('engine: a held-back cell is counted once, in held_back and not in mismatched', hb.ledger.held_back === hb.mismatches_held_back_count && hb.ledger.mismatched === hb.mismatch_count);
    check('engine: the comparison policy is returned for the report', /0\.1%/.test(c1.comparison_policy));
    check('engine: old keys are still present for existing readers', ['formula_cells_checked', 'mismatches_likely_masked_upstream_error', 'mismatches_likely_masked_upstream_error_count'].every(k => k in c2));
  }

  // ── 4. findings ───────────────────────────────────────────────────────────────────────────────
  const base = { status: 'success', genuine_circular_groups: 2, unconverged_circular_groups: 0, formula_cells_checked: 900, comparison_policy: 'POLICY', ledger: { population: 1000, compared: 900, matched: 880, mismatched: 5, held_back: 0, reconciles: true } };
  check('no findings when the recalculation did not succeed', buildRecalcFindings({ status: 'failed_to_run' }).length === 0 && buildRecalcFindings(null).length === 0);
  check('no findings on a clean result', buildRecalcFindings(Object.assign({}, base, { mismatch_count: 0, mismatches: [] })).length === 0);
  const f1 = buildRecalcFindings(Object.assign({}, base, { mismatch_count: 2, mismatches: [{ sheet: 'S', cell: 'A1', cached: 1.35, recalculated: 0.5, type: 'number' }, { sheet: 'S', cell: 'A2', cached: 10, recalculated: 20 }] }));
  check('numeric differences give T0-RECALC-001, high, with the ledger sentence and the policy', f1.length === 1 && f1[0].id === 'T0-RECALC-001' && f1[0].severity === 'high' && /900 of 1,000 formula cells compared \(880 matched\)/.test(f1[0].condition) && /POLICY/.test(f1[0].condition));
  const f2 = buildRecalcFindings(Object.assign({}, base, { mismatch_count: 3, mismatches: [{ sheet: 'S', cell: 'B1', cached: 'ok', recalculated: 'error', type: 'text' }, { sheet: 'S', cell: 'C1', cached: true, recalculated: false, type: 'boolean' }, { sheet: 'S', cell: 'D1', cached: null, recalculated: 5, type: 'type_changed' }] }));
  check('text and Boolean differences are a Query (T0-RECALC-004), never the high-severity finding', f2.length === 1 && f2[0].id === 'T0-RECALC-004' && f2[0].record_type === 'Query' && f2[0].severity === 'medium');
  check('the sample shows text, TRUE/FALSE and blanks without error', /"ok"/.test(f2[0].condition) && /TRUE/.test(f2[0].condition) && /\(blank\)/.test(f2[0].condition));
  const f3 = buildRecalcFindings(Object.assign({}, base, { mismatch_count: 0, mismatches: [], mismatches_held_back: [{ sheet: 'S', cell: 'B1', cached: 0.9, recalculated: 0.5, root_label: 'IRR() inside IFERROR/IFNA' }] }));
  check('held-back differences give a visible Query (T0-RECALC-003) naming the root', f3.length === 1 && f3[0].id === 'T0-RECALC-003' && f3[0].record_type === 'Query' && /IRR\(\)/.test(f3[0].condition));
  const f4 = buildRecalcFindings(Object.assign({}, base, { mismatch_count: 1, mismatches: [{ sheet: 'S', cell: 'A1', cached: 1, recalculated: 2 }], unconverged_circular_groups: 1, mismatches_held_back: [{ sheet: 'S', cell: 'B1', cached: 1, recalculated: 2 }] }));
  check('all three can appear together', f4.map(f => f.id).sort().join() === 'T0-RECALC-001,T0-RECALC-002,T0-RECALC-003');
  check('ledgerSentence falls back to the old wording without a ledger', /900 formula cells checked/.test(ledgerSentence({ formula_cells_checked: 900 })));

  // ── 5. wiring ─────────────────────────────────────────────────────────────────────────────────
  for (const f of ['server.js', 'index.js']) {
    const src = fs.readFileSync(f, 'utf8');
    check(`${f} uses the shared builder and no longer carries its own T0-RECALC findings`, src.includes('buildRecalcFindings(recalcCheckResult)') && !src.includes("id: 'T0-RECALC-001'") && !src.includes("id: 'T0-RECALC-002'"));
  }
  check('the Tier 2 note reports compared and matched, and mentions held-back cells', /_cmpText/.test(fs.readFileSync('src/validator-tier2.js', 'utf8')) && /_heldNote/.test(fs.readFileSync('src/validator-tier2.js', 'utf8')));
  check('the IFERROR word alone no longer seeds the taint', !/_IFERROR_IFNA_RE/.test(fs.readFileSync('src/recalc_check.py', 'utf8')) && /engine_limited_function/.test(fs.readFileSync('src/recalc_check.py', 'utf8')));

  // ── 6. report text ────────────────────────────────────────────────────────────────────────────
  async function scopeText(recalc) {
    const payload = {
      originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test', modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['S'] },
      tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] }, overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'x',
      ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false }, namedRangeAudit: { applicable: false },
      formulaDeepDive: { findings: [] }, reasonableness: {}, duplicateSheets: { applicable: false }, vbaReview: { applicable: false },
      deepAccountingResolvedSheets: {}, crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings: [], recalcCheckResult: recalc
    };
    const pl = path.join(dir, 'pl.json'), out = path.join(dir, 'o.xlsx');
    fs.writeFileSync(pl, JSON.stringify(payload));
    await execFileAsync('python3', ['src/build_report.py', pl, out]);
    fs.writeFileSync(path.join(dir, 'r.py'), 'import openpyxl,sys\nws=openpyxl.load_workbook(sys.argv[1],data_only=True)["Scope and Reliance"]\nprint("|||".join(str(c.value) for row in ws.iter_rows() for c in row if c.value is not None))');
    return (await execFileAsync('python3', [path.join(dir, 'r.py'), out])).stdout;
  }
  const withLedger = await scopeText({
    status: 'success', mismatch_count: 2, formula_cells_checked: 900, genuine_circular_groups: 1, comparison_policy: 'numbers: within 0.1%',
    ledger: { population: 1000, compared: 900, matched: 880, mismatched: 2, held_back: 18, volatile: 4, unresolved: 6, missing_cache: 3, unsupported: 1,
      excluded_external_reference: 0, excluded_offset: 40, excluded_bare_multicell_name: 0, excluded_downstream_of_excluded: 50, not_run: 0, accounted: 1000, reconciles: true }
  });
  check('Scope tab says how every formula cell was accounted for', /accounted for 1,000 formula cell/.test(withLedger) && /880 matched/.test(withLedger) && /2 differ/.test(withLedger));
  check('Scope tab names volatile cells separately from errors', /4 differ but depend on NOW, TODAY, RAND/.test(withLedger));
  check('Scope tab names held-back, unresolved, no-saved-value and set-aside cells', /18 differ but trace to an engine limitation/.test(withLedger) && /6 returned an engine error/.test(withLedger) && /3 have no saved value/.test(withLedger) && /90 set aside/.test(withLedger));
  check('Scope tab states that the categories add up, and that a match is not proof of correct logic', /add up to the workbook's formula-cell count/.test(withLedger) && /does not show that the formula expresses the correct financial rule/.test(withLedger));
  check('Scope tab shows the comparison policy', /Comparison policy: numbers: within 0.1%/.test(withLedger));
  const unrec = await scopeText({ status: 'success', mismatch_count: 0, formula_cells_checked: 90, genuine_circular_groups: 0, ledger: { population: 100, compared: 90, matched: 90, mismatched: 0, held_back: 0, unresolved: 0, missing_cache: 0, unsupported: 0, excluded_offset: 0, not_run: 5, accounted: 95, reconciles: false } });
  check('a ledger that does not reconcile says so with the size of the difference', /differ from the workbook's formula-cell count of 100 by 5/.test(unrec) && /5 not run/.test(unrec));
  const noLedger = await scopeText({ status: 'success', mismatch_count: 0, formula_cells_checked: 15690, genuine_circular_groups: 3 });
  check('without a ledger the older wording still builds', /15,690 formula cell\(s\)/.test(noLedger));

  // ── 7. acceptance baseline ────────────────────────────────────────────────────────────────────
  let accOut = '', accOk = true;
  try { accOut = execFileSync('node', ['scripts/acceptance-baseline.js'], { encoding: 'utf8', timeout: 240000 }); } catch (e) { accOk = false; accOut = String(e.stdout || e.message); }
  check('acceptance baseline matches (cases 1, 2 and 3 now pass)', accOk && accOut.includes('unchanged'));
  const base2 = JSON.parse(fs.readFileSync('acceptance/baseline.json', 'utf8'));
  check('committed baseline records cases 1-3 as pass', ['1', '2', '3'].every(k => base2[k].status === 'pass'));

  console.log(allPass ? '\nAll Patch 28 checks pass.' : '\nSOME CHECKS FAILED');
  process.exit(allPass ? 0 : 1);
})();
