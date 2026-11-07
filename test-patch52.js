// Patch 52: front-end report changes (links, headline completion, Issue Log order,
// Unassigned/Unscheduled timing, print set-up). Presentation only - findings, priorities
// and the reliance verdict must not change.
const fs = require('fs');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS: ' + n); } else { fail++; console.log('FAIL: ' + n + (extra ? ' -> ' + extra : '')); } };
const py = code => execFileSync('python3', ['-c', code], { cwd: __dirname, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

// 1. helpers
const h = JSON.parse(py(`
import sys, json; sys.path.insert(0, 'src')
import build_report as b
f = lambda sh, c: b.source_link_target(sh, c, 'M.xlsx')
out = {
 'single': f('Sheet1', 'AP133'), 'abs': f('Sheet1', '$AP$133'), 'lower': f('Sheet1', 'ap133'),
 'range': f('Sheet1', 'AP133:AP135'), 'a1': f('Sheet1', 'A1'), 'blank': f('Sheet1', ''), 'none': f('Sheet1', None),
 'multi': f('Sheet1', 'AP133, AP140'), 'prose': f('Sheet1', 'Multiple'), 'nosheet': f('', 'AP1'), 'wb': f('Workbook', 'AP1'),
 'spaced': f('NGESO (Scenarios)', 'AH176'), 'apos': f("Bob's", 'B2'),
 'h1': b.complete_headline('Saved ratings are constants (e.g.'), 'h2': b.complete_headline('Complete headline (see note)'),
 'h3': b.complete_headline('(e.g. only'), 'h4': b.complete_headline(''),
}
print(json.dumps(out))
`));
check('single cell links to that cell', h.single[0] === '=HYPERLINK("[M.xlsx]Sheet1!AP133","View")');
check('absolute and lower-case forms resolve alike', h.abs[0] === h.single[0] && h.lower[0] === h.single[0]);
check('range links to the range', h.range[0] === '=HYPERLINK("[M.xlsx]Sheet1!AP133:AP135","View")');
check('A1 / blank / None / list / Multiple are sheet-level and labelled View sheet',
  [h.a1, h.blank, h.none, h.multi, h.prose].every(x => x[1] === 'View sheet' && x[0].endsWith('!A1","View sheet")')));
check('no sheet or Workbook gives no link', h.nosheet[0] === null && h.wb[0] === null);
check('sheet names with spaces are quoted', h.spaced[0] === `=HYPERLINK("'[M.xlsx]NGESO (Scenarios)'!AH176","View")`, h.spaced[0]);
check('apostrophes are doubled', h.apos[0].includes("'[M.xlsx]Bob''s'!B2"), h.apos[0]);
check('dangling "(e.g." removed', h.h1 === 'Saved ratings are constants', h.h1);
check('balanced parentheses untouched', h.h2 === 'Complete headline (see note)');
check('headline never emptied', h.h3 === '(e.g. only' && h.h4 === '');

// 2. integration: build a report and read it back
const mk = (id, sev, sheet, cell, extra) => Object.assign({ id, severity: sev, sheet, cell, title: id + ' title', category: 'Test', consequence: 'c', corrective_action: 'a', fscore: 1 }, extra || {});
const payload = {
  originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
  modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['Sheet1'] },
  tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
  overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
  ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
  namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
  duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
  crossRunStats: { isFirstRun: true, newFindingCount: 0 },
  findings: [
    mk('T0-A-001', 'low', 'Sheet1', 'B2'),
    mk('T0-B-001', 'critical', 'Sheet1', 'C3', { fscore: 5 }),
    mk('T0-C-001', 'medium', 'My Sheet', 'D4', { fscore: 9 }),
    mk('T0-D-001', 'medium', 'Sheet1', 'A1', { fscore: 2, title: 'Trailing note (e.g.' }),
    mk('T0-E-001', 'low', 'Sheet1', 'E5', { investment_grade_blocker: true }),
  ],
};
fs.writeFileSync('/tmp/test-p52-payload.json', JSON.stringify(payload));
execFileSync('python3', ['src/build_report.py', '/tmp/test-p52-payload.json', '/tmp/test-p52-out.xlsx'], { cwd: __dirname });
const r = JSON.parse(py(`
import openpyxl, json
wb = openpyxl.load_workbook('/tmp/test-p52-out.xlsx')
il = wb['Issue Log']; rm = wb['Remediation']
hdr = None
for r in range(1, 12):
    vals = [il.cell(r, c).value for c in range(1, 40)]
    if 'ID' in vals and 'Priority' in vals: hdr = r; names = {v: i + 1 for i, v in enumerate(vals) if v}; break
rows = []
r = hdr + 1
while il.cell(r, names['ID']).value:
    rows.append([il.cell(r, names['ID']).value, il.cell(r, names['Priority']).value, il.cell(r, names['View']).value, il.cell(r, names['Finding']).value]); r += 1
rh = None
for r in range(1, 12):
    vals = [rm.cell(r, c).value for c in range(1, 40)]
    if 'Timing' in vals and 'Owner' in vals: rh = r; rn = {v: i + 1 for i, v in enumerate(vals) if v}; break
tim = rm.cell(rh + 1, rn['Timing']).value
print(json.dumps({'rows': rows, 'timing': tim, 'il_land': il.page_setup.orientation, 'il_fit': il.sheet_properties.pageSetUpPr.fitToPage,
  'il_titles': il.print_title_rows, 'rm_land': rm.page_setup.orientation, 'rm_titles': rm.print_title_rows,
  'tdnote': il.cell(hdr, names['Target Date']).comment.text if il.cell(hdr, names['Target Date']).comment else None}))
`));
const ids = r.rows.map(x => x[0]);
check('Issue Log order: blocker, then P1, then P2 by F-Score, then P3', JSON.stringify(ids) === JSON.stringify(['T0-E-001', 'T0-B-001', 'T0-C-001', 'T0-D-001', 'T0-A-001']), JSON.stringify(ids));
check('all 5 IDs kept', ids.length === 5);
const byId = Object.fromEntries(r.rows.map(x => [x[0], x]));
check('precise cell link in the report', byId['T0-B-001'][2].includes('Sheet1!C3'), byId['T0-B-001'][2]);
check('spaced sheet name quoted in the report', byId['T0-C-001'][2].includes("'[test.xlsx]My Sheet'!D4") || byId['T0-C-001'][2].includes("My Sheet'!D4"), byId['T0-C-001'][2]);
check('A1 shows View sheet', byId['T0-D-001'][2].includes('View sheet'), byId['T0-D-001'][2]);
check('dangling headline repaired', byId['T0-D-001'][3] === 'Trailing note', byId['T0-D-001'][3]);
check('timing formula has Unassigned and Unscheduled', /Unassigned/.test(r.timing) && /Unscheduled/.test(r.timing), r.timing);
check('landscape and fit-to-page on both tabs', r.il_land === 'landscape' && r.il_fit === true && r.rm_land === 'landscape');
check('header rows repeat on both tabs', !!r.il_titles && !!r.rm_titles, r.il_titles + ' / ' + r.rm_titles);
check('Target Date header explains it is a suggestion', !!r.tdnote && /not an agreed commitment/.test(r.tdnote));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
