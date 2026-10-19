// Remediation tab: findings sharing related_group_id sit together, P1 before P2, and the group id shows.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rem-grp-'));
const mk = (id, sev, grp, rc) => ({ id, severity: sev, confidence: 90, issue_type: rc, root_cause: rc, record_type: 'Confirmed Finding',
  description: 'd', corrective_action: 'fix ' + id, sheet: 'S', cell: 'A1', related_group_id: grp });
const findings = [mk('T2-A', 'medium', 'RC-X', 'rc1'), mk('T2-B', 'high', null, 'rc2'), mk('T2-C', 'medium', 'RC-X', 'rc1'), mk('T2-D', 'critical', null, 'rc3'), mk('T2-E', 'medium', null, 'rc4')];
fs.writeFileSync(path.join(tmp, 'd.json'), JSON.stringify({ modelName: 'm', sourceFile: 'm.xlsx', domainSkill: 'generic', ruleResults: [], findings }));
const r = spawnSync('python3', [path.join(__dirname, 'src', 'build_report.py'), path.join(tmp, 'd.json'), path.join(tmp, 'o.xlsx')], { encoding: 'utf8' });
assert.strictEqual(r.status, 0, r.stderr);
const o = spawnSync('python3', ['-c', `
import openpyxl, json
wb = openpyxl.load_workbook(${JSON.stringify(path.join(tmp, 'o.xlsx'))}, read_only=True, data_only=True)
ws = wb['Remediation']; rows = []
for row in ws.iter_rows(min_row=6, values_only=True):
    if row[2]: rows.append([row[2], row[3], row[12]])
print(json.dumps(rows))`], { encoding: 'utf8' });
const rows = JSON.parse(o.stdout);
const ids = rows.map(x => x[0]);
console.log(JSON.stringify(rows));
assert.strictEqual(ids[0], 'T2-D', 'P1 first');
assert.ok(Math.abs(ids.indexOf('T2-A') - ids.indexOf('T2-C')) === 1, 'group members adjacent');
assert.ok(String(rows[ids.indexOf('T2-A')][2]).startsWith('RC-X'), 'group id shown');
console.log('3 check(s) passed');
