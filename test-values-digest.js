const ExcelJS = require('exceljs'), assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { buildFullParsePayloadWithText, FULL_PARSE_PROMPT_ADDENDUM } = require('./src/validator-tier2-fullparse');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Ratios');
ws.getCell('A1').value = 'Net debt / RAV';
[0.62, 0.6, 0.58, 0.55].forEach((v, i) => { ws.getCell(1, 10 + i).value = { formula: 'B1/C1', result: v }; });
ws.getCell('A2').value = 'Closing equity';
[10, -2, 5, 7].forEach((v, i) => { ws.getCell(2, 10 + i).value = { formula: 'B2+1', result: v }; });
ws.getCell('A3').value = 'Typed input row';                    // constants only: not a formula row
[1, 2, 3, 4].forEach((v, i) => { ws.getCell(3, 10 + i).value = v; });
ws.getCell('A4').value = 'Too short';                          // fewer than 3 values
ws.getCell('J4').value = { formula: 'B4', result: 1 }; ws.getCell('K4').value = { formula: 'B4', result: 2 };
ws.getCell('A5').value = 'Error row';
[1, 2, 3].forEach((v, i) => { ws.getCell(5, 10 + i).value = { formula: 'B5', result: { error: '#DIV/0!' } }; });

const built = buildFullParsePayloadWithText(wb);
const text = built.payload.Ratios;
ok(/# STORED VALUES DIGEST/.test(text), 'digest section present');
ok(/R1 Net debt \/ RAV: first=0\.620 last=0\.550 min=0\.550 max=0\.620 negatives=0\/4/.test(text), 'ratio row summarised');
ok(/R2 Closing equity: first=10\.0 last=7\.00? ?/.test(text) || /R2 Closing equity: first=10\.0 last=7\.0 min=-2\.0 max=10\.0 negatives=1\/4/.test(text), 'negative counted');
ok(!/Typed input row/.test(text.split('# STORED VALUES DIGEST')[1]), 'constant-only row skipped');
ok(!/Too short/.test(text.split('# STORED VALUES DIGEST')[1]), 'row with under 3 values skipped');
ok(!/Error row/.test(text.split('# STORED VALUES DIGEST')[1]), 'error results skipped');
ok(built.valuesDigest.included && built.valuesDigest.rows === 2, 'digest stats reported');

// switch off and size cap
const off = buildFullParsePayloadWithText(wb, { valuesDigest: false });
ok(!/STORED VALUES DIGEST/.test(off.payload.Ratios) && off.valuesDigest.included === false, 'can be disabled');
const capped = buildFullParsePayloadWithText(wb, { valuesDigestMaxChars: 10 });
ok(capped.valuesDigest.rows === 1 && capped.valuesDigest.truncated === true, 'size cap stops the digest and says so');

// the prompt tells the reviewer what it has
ok(/STORED VALUES DIGEST/.test(FULL_PARSE_PROMPT_ADDENDUM) && /do not say that no values/.test(FULL_PARSE_PROMPT_ADDENDUM), 'prompt describes the digest');

// Validation Matrix evidence text follows the route
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-'));
const rr = { id: 'T2-S5-006', status: 'uncertain', confidence: 30 };
const payload = { modelName: 'm', sourceFile: 'm.xlsx', domainSkill: 'generic', ruleResults: [rr], findings: [], tier2Evidence: { route: 'full_parse', coverage: 'complete_workbook', valuesDigest: true } };
fs.writeFileSync(path.join(tmp, 'd.json'), JSON.stringify(payload));
const r = spawnSync('python3', [path.join(__dirname, 'src', 'build_report.py'), path.join(tmp, 'd.json'), path.join(tmp, 'o.xlsx')], { encoding: 'utf8' });
ok(r.status === 0, r.stderr);
const o = spawnSync('python3', ['-c', `
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(path.join(tmp, 'o.xlsx'))}, read_only=True, data_only=True)
t = [str(v) for row in wb['Validation Matrix'].iter_rows(values_only=True) for v in row if isinstance(v, str)]
print(json.dumps({'full': any('Every formula, all static text and named ranges; stored values as a per-row digest' in x for x in t), 'old': any('Standard data subset' in x or 'Deep financial data subset' in x for x in t)}))`], { encoding: 'utf8' });
const res = JSON.parse(o.stdout);
ok(res.full && !res.old, 'matrix evidence describes the full-parse payload, not a trimmed subset');
console.log(n + ' check(s) passed');
