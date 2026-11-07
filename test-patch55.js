// Patch 55 (step 1): master-finding identity comes from the rule, not from a stripped suffix (Review R7), and the cross-reference
// note no longer promises one repair and one retest.
const { annotateMasterFindings, countMasters, issueKey } = require('./src/utils/master-findings');
const { linkRelatedFindings } = require('./src/utils/related-findings');
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS: ' + n); } else { fail++; console.log('FAIL: ' + n + (extra ? ' -> ' + extra : '')); } };
const mk = (id, extra) => Object.assign({ id, sheet: 'S', cell: 'D12', severity: 'medium', record_type: 'Confirmed Finding', label: id + ' title', condition: 'Problem at S!D12' }, extra || {});

check('issueKey keeps the rule number for Tier 2 rules', issueKey({ id: 'T2-S4-006' }) === 'T2-S4-006' && issueKey({ id: 'T2-S4-007' }) === 'T2-S4-007');
check('issueKey folds a Tier 2 occurrence into its rule', issueKey({ id: 'T2-S4-006-002' }) === 'T2-S4-006');
check('issueKey keeps a Tier 1 rule and folds its occurrence', issueKey({ id: 'T1-013' }) === 'T1-013' && issueKey({ id: 'T1-013-002' }) === 'T1-013');
check('numbered occurrences of one T0 detector stay one issue', issueKey({ id: 'T0-BLANKCELLREF-001' }) === issueKey({ id: 'T0-BLANKCELLREF-004' }));
check('an explicit rule_id / check_id is never stripped', issueKey({ id: 'X-1', rule_id: 'T2-S4-006' }) === 'T2-S4-006' && issueKey({ id: 'X-1', check_id: 'CHK-007' }) === 'CHK-007');
check('a T0 id that ends in a cell is unchanged', issueKey({ id: 'T0-DUPCALC-FinancialRatios-AP133' }) === 'T0-DUPCALC-FinancialRatios-AP133');

// R7: two distinct rules in one section on the same cell
const two = [mk('T2-S4-006', { related_group_id: 'RC-1' }), mk('T2-S4-007', { related_group_id: 'RC-1' })];
annotateMasterFindings(two);
check('two distinct same-section rules show two issues', two.every(f => f.issue_count === 2) && two[0].issue_label === 'Issue 1 of 2' && two[1].issue_label === 'Issue 2 of 2');
check('both issue summaries are exposed', Array.isArray(two[0].issue_summaries) && two[0].issue_summaries.length === 2 && new Set(two[0].issue_summaries.map(i => i.id)).size === 2);

// the T0 control: six occurrences of one detector are still one issue
const six = Array.from({ length: 6 }, (_, i) => mk('T0-BLANKCELLREF-00' + (i + 1), { related_group_id: 'RC-2', severity: 'low' }));
annotateMasterFindings(six);
check('six occurrences of one T0 detector remain one issue', six.every(f => f.issue_count === 1 && f.issue_label === null));

// mixed: a T2 rule, its occurrence, and a different T2 rule
const mix = [mk('T2-S5-007', { related_group_id: 'RC-3' }), mk('T2-S5-007-002', { related_group_id: 'RC-3' }), mk('T2-S10-014', { related_group_id: 'RC-3', severity: 'high' })];
annotateMasterFindings(mix);
check('a rule and its occurrence are one issue; another rule is a second', mix[0].issue_no === mix[1].issue_no && mix[0].issue_no !== mix[2].issue_no && mix[0].issue_count === 2);

// counts unchanged: a group still counts once at its highest priority
const cnt = countMasters(two);
check('a group still counts once in the master count', cnt.P2 === 1, JSON.stringify(cnt));

// related-findings note
const a = mk('T2-A-001', { sheet: 'S', cell: 'D12', condition: 'Check S!D12 and S!D13' }), b = mk('T0-B-001', { sheet: 'S', cell: 'D12', condition: 'Check S!D12 and S!D13' });
linkRelatedFindings([a, b]);
check('the cross-reference note names the other finding', /also reported by T0-B-001/.test(a.condition));
check('the note no longer promises one repair and one retest', !/one repair and one retest/.test(a.condition) && /each keeps its own fix and retest/.test(a.condition), a.condition);
check('related ids and group id are still set', a.related_ids.includes('T0-B-001') && !!a.related_group_id);

// ---- Part 2: occurrence-level de-duplication (Review R5)
const { dedupFindings } = require('./src/utils/dedup-findings');
const f2 = (id, cell, text, extra) => Object.assign({ id, sheet: 'SystemOperator', cell, severity: 'medium', condition: text }, extra || {});
{
  const r = dedupFindings([f2('T2-S5-007', 'AP681', 'Tax rate does not match 19%'), f2('T2-S5-007', 'AP700', 'Capital allowance base looks cumulative', { severity: 'critical' })]);
  check('same rule + sheet at a different cell and claim keeps both', r.kept.length === 2, JSON.stringify(r.kept.map(k => k.id)));
  check('the later occurrence gets an occurrence suffix and keeps its base id', r.kept[1].id === 'T2-S5-007-002' && r.kept[1].base_id === 'T2-S5-007');
  check('the later critical concern is not lost', r.kept.some(k => k.severity === 'critical'));
}
{
  const r = dedupFindings([f2('T2-S5-007', 'AP681', 'Tax rate does not match 19%'), f2('T2-S5-007', 'ap681', '  tax rate does not   match 19%  ', { severity: 'high', affected_cells: ['SystemOperator!AP681'] })]);
  check('a true duplicate (same rule, sheet, cell, claim) collapses to one', r.kept.length === 1 && r.merged.length === 1);
  check('the survivor takes the higher severity and records the count', r.kept[0].severity === 'high' && r.kept[0].duplicate_reports === 2);
  check('the survivor keeps the union of affected cells', r.kept[0].affected_cells.includes('SystemOperator!AP681'));
}
{
  const r = dedupFindings([f2('T2-S5-007', 'AP681', 'claim A'), f2('T2-S5-007', 'AP681', 'claim B')]);
  check('same cell but a different claim is kept (same-cell, distinct-claim)', r.kept.length === 2);
  const r2 = dedupFindings([f2('T2-S5-007', 'AP681', 'same claim', { sheet: 'A' }), f2('T2-S5-007', 'AP681', 'same claim', { sheet: 'B' })]);
  check('same claim on another sheet is kept', r2.kept.length === 2);
  const r3 = dedupFindings([{ reason: 'no id one' }, { reason: 'no id two' }]);
  check('id-less findings with different text do not collide', r3.kept.length === 2);
}
{
  const input = [f2('T2-S5-007', 'AP681', 'x')]; const copy = JSON.stringify(input);
  dedupFindings(input);
  check('the input array and its findings are not mutated', JSON.stringify(input) === copy);
}

// ---- Part 3: lossless grouping in the report (Review R6)
const fs = require('fs'); const { execFileSync } = require('child_process');
const py = code => execFileSync('python3', ['-c', code], { cwd: __dirname, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
const t0 = (n, extra) => Object.assign({ id: 'T0-BLANKCELLREF-00' + n, severity: 'low', sheet: 'FinancialRatios', cell: 'AP' + (90 + n), category: 'Structure', title: 'Blank cell referenced', condition: 'Cell ' + n + ' refers to a blank cell', consequence: 'c', corrective_action: 'a', fscore: 1, record_type: 'Confirmed Finding' }, extra || {});
function build(findings, tag) {
  const payload = {
    originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
    modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['A'] },
    tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
    overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
    ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
    namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
    duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
    crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings,
  };
  fs.writeFileSync(`/tmp/test-p55-${tag}.json`, JSON.stringify(payload));
  execFileSync('python3', ['src/build_report.py', `/tmp/test-p55-${tag}.json`, `/tmp/test-p55-${tag}.xlsx`], { cwd: __dirname });
  return JSON.parse(py(`
import openpyxl, json
wb = openpyxl.load_workbook('/tmp/test-p55-${tag}.xlsx'); il = wb['Issue Log']
for r in range(1, 12):
    vals = [il.cell(r, c).value for c in range(1, 40)]
    if 'ID' in vals and 'Priority' in vals: hdr = r; names = {v: i + 1 for i, v in enumerate(vals) if v}; break
out = []; r = hdr + 1
while il.cell(r, names['ID']).value:
    out.append({k: il.cell(r, names[k]).value for k in ('ID', 'Priority', 'Finding', 'What is wrong', 'Investment\\nBlocker') if k in names}); r += 1
print(json.dumps(out))
`));
}
{
  const six = [1, 2, 3, 4, 5, 6].map(n => t0(n));
  const rows = build(six, 'six');
  check('six members of one detector become one row', rows.length === 1 && /6 instances/.test(rows[0].ID), JSON.stringify(rows.map(r => r.ID)));
  check('the row names the real member count and lists every member id', /6 instance/.test(rows[0]['What is wrong']) && [1, 2, 3, 4, 5, 6].every(n => rows[0]['What is wrong'].includes('T0-BLANKCELLREF-00' + n)), rows[0]['What is wrong']);
  check('the sample is not capped at five (sixth member shown)', rows[0]['What is wrong'].includes('FinancialRatios!AP96'), rows[0]['What is wrong']);
}
{
  const mixed = [1, 2, 3, 4, 5].map(n => t0(n, n === 4 ? { severity: 'high' } : {}));
  const rows = build(mixed, 'sev');
  check('the group takes the most severe member, not the first', rows.length === 1 && rows[0].Priority === 'P2', JSON.stringify(rows.map(r => r.Priority)));
}
{
  const blk = [1, 2, 3, 4, 5].map(n => t0(n, n === 5 ? { investment_grade_blocker: true } : {}));
  const rows = build(blk, 'blk');
  check('a blocking flag on any member survives grouping', rows.length === 1 && String(rows[0]['Investment\nBlocker'] || '').toLowerCase().startsWith('y'), JSON.stringify(rows[0]));
}
{
  const types = [1, 2, 3, 4, 5].map(n => t0(n)).concat([6, 7, 8, 9, 10].map(n => t0(n, { record_type: 'Query' })));
  const rows = build(types, 'types');
  check('Confirmed Findings and Queries are never folded into one row', rows.length === 2 && new Set(rows.map(r => r.Priority)).size === 2, JSON.stringify(rows.map(r => [r.ID, r.Priority])));
}
{
  const four = [1, 2, 3, 4].map(n => t0(n));
  const rows = build(four, 'four');
  check('a group of four stays as four rows (below the threshold)', rows.length === 4);
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
