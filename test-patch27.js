// Patch 27: run provenance, the acceptance-case baseline, and the timed baseline script.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execFile } = require('child_process');
const util = require('util');
const execFileAsync = util.promisify(execFile);
const prov = require('./src/utils/run-provenance');

let allPass = true;
const check = (desc, pass) => { console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`); if (!pass) allPass = false; };

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'p27-'));

  // 1. input hash is the real SHA-256 of the file, and the size is right
  const f = path.join(tmp, 'm.xlsx');
  fs.writeFileSync(f, Buffer.from('some workbook bytes'));
  const want = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const h = await prov.sha256File(f);
  check('input hash equals an independent SHA-256 of the file', h.sha256 === want && h.bytes === 19);
  const missing = await prov.sha256File(path.join(tmp, 'nope.xlsx'));
  check('a missing file gives "unknown", not a throw', missing.sha256 === 'unknown' && missing.bytes === null);

  // 2. the record carries every field and never throws on a bad path
  const rec = await prov.buildRunProvenance({ filePath: f, originalName: 'Model A.xlsx' });
  check('record has name, hash, size, commit, rule version, models, node', rec.input_name === 'Model A.xlsx' && rec.input_sha256 === want && rec.input_bytes === 19 && /^[0-9a-f]{40}$|^unknown$/.test(rec.code_commit) && /^[0-9a-f]{12}$/.test(rec.rule_version) && Array.isArray(rec.model_ids) && rec.node === process.version);
  const bad = await prov.buildRunProvenance({ filePath: path.join(tmp, 'x', 'y.xlsx') });
  check('a bad path still yields a record with unknown fields', bad.input_sha256 === 'unknown' && bad.schema === 1);
  check('the real repo reports the model names found in source', rec.model_ids.length >= 1 && rec.model_ids.every(m => /^claude-/.test(m)));

  // 3. rule version changes when any rule file changes, and is stable otherwise
  const root = path.join(tmp, 'root'); fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'checklist.json'), '{"a":1}');
  fs.writeFileSync(path.join(root, 'config', 'skill.md'), 'one');
  const v1 = prov.configHashes(root).rule_version, v1b = prov.configHashes(root).rule_version;
  fs.writeFileSync(path.join(root, 'config', 'skill.md'), 'two');
  const v2 = prov.configHashes(root).rule_version;
  fs.writeFileSync(path.join(root, 'config', 'notes.txt'), 'unrelated');
  const v3 = prov.configHashes(root).rule_version;
  check('rule version is stable for unchanged files', v1 === v1b);
  check('rule version changes when a skill file changes', v1 !== v2);
  check('rule version ignores unrelated files', v2 === v3);
  check('an empty config directory gives "unknown"', prov.configHashes(path.join(tmp, 'empty')).rule_version === 'unknown');

  // 4. commit detection: env wins, then .git HEAD (loose and packed refs, detached)
  const g = path.join(tmp, 'g'); fs.mkdirSync(path.join(g, '.git', 'refs', 'heads'), { recursive: true });
  const sha = 'a'.repeat(40), sha2 = 'b'.repeat(40);
  fs.writeFileSync(path.join(g, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(g, '.git', 'refs', 'heads', 'main'), sha + '\n');
  const savedEnv = process.env.GIT_COMMIT; delete process.env.GIT_COMMIT;
  check('commit read from a loose ref', prov.codeCommit(g) === sha);
  fs.unlinkSync(path.join(g, '.git', 'refs', 'heads', 'main'));
  fs.writeFileSync(path.join(g, '.git', 'packed-refs'), `# pack-refs\n${sha2} refs/heads/main\n`);
  check('commit read from packed-refs', prov.codeCommit(g) === sha2);
  fs.writeFileSync(path.join(g, '.git', 'HEAD'), sha + '\n');
  check('commit read from a detached HEAD', prov.codeCommit(g) === sha);
  check('no .git gives "unknown"', prov.codeCommit(path.join(tmp, 'nogit')) === 'unknown');
  process.env.GIT_COMMIT = 'deadbeef1234';
  check('GIT_COMMIT from the deploy overrides', prov.codeCommit(g) === 'deadbeef1234');
  if (savedEnv === undefined) delete process.env.GIT_COMMIT; else process.env.GIT_COMMIT = savedEnv;

  // 5. sidecar file sits beside the report with a predictable name
  const rp = path.join(tmp, 'Fm-1_PROCESSED.xlsx');
  check('sidecar path is beside the report', prov.provenancePathFor(rp) === path.join(tmp, 'Fm-1_PROCESSED.provenance.json'));
  check('sidecar is written and parses back', prov.writeProvenance(rp, rec) && JSON.parse(fs.readFileSync(prov.provenancePathFor(rp), 'utf8')).input_sha256 === want);
  check('a write failure returns false and does not throw', prov.writeProvenance(path.join(tmp, 'no', 'dir', 'r.xlsx'), rec) === false);

  // 6. both pipelines compute it before the report and write it after; the payload carries it
  const server = fs.readFileSync('server.js', 'utf8'), index = fs.readFileSync('index.js', 'utf8'), rt = fs.readFileSync('src/report-tab.js', 'utf8');
  for (const [name, src] of [['server.js', server], ['index.js', index]]) {
    check(`${name} builds the record before buildReportFile`, src.indexOf('buildRunProvenance({') !== -1 && src.indexOf('buildRunProvenance({') < src.indexOf('buildReportFile(reportPath'));
    check(`${name} passes runProvenance into the report and writes the sidecar`, /ownerDecisionChecklist,\s*runProvenance/.test(src) && src.includes('writeProvenance(reportPath, runProvenance)'));
  }
  check('report-tab forwards runProvenance in the payload', /runProvenance:\s+meta\.runProvenance \|\| null/.test(rt));

  // 7. the Scope and Reliance tab shows the panel when given a record and omits it otherwise
  async function scopeText(runProvenance) {
    const payloadPath = path.join(tmp, 'pl.json'), out = path.join(tmp, 'o.xlsx');
    const payload = {
      originalName: 'test.xlsx', modelType: 'test', modelIndustry: 'test',
      modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['Sheet1'] },
      tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] },
      overallAssessment: 'not_fit_for_purpose', igReadiness: 0, igCommentary: 'test',
      ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false },
      namedRangeAudit: { applicable: false }, formulaDeepDive: { findings: [] }, reasonableness: {},
      duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {},
      crossRunStats: { isFirstRun: true, newFindingCount: 0 }, findings: []
    };
    if (runProvenance) payload.runProvenance = runProvenance;
    fs.writeFileSync(payloadPath, JSON.stringify(payload));
    await execFileAsync('python3', ['src/build_report.py', payloadPath, out]);
    const py = 'import openpyxl,sys\nws=openpyxl.load_workbook(sys.argv[1],data_only=True)["Scope and Reliance"]\nprint("|||".join(str(c.value) for row in ws.iter_rows() for c in row if c.value is not None))';
    fs.writeFileSync(path.join(tmp, 'r.py'), py);
    return (await execFileAsync('python3', [path.join(tmp, 'r.py'), out])).stdout;
  }
  const withP = await scopeText(rec);
  check('Scope and Reliance shows a RUN PROVENANCE panel', withP.includes('RUN PROVENANCE'));
  check('it shows the full input hash', withP.includes(want));
  check('it shows the short commit and rule version', withP.includes(String(rec.code_commit).slice(0, 12)) && withP.includes(rec.rule_version));
  check('it shows the reviewer model', withP.includes(rec.model_ids[0]));
  check('it shows the size with thousands separators', withP.includes('19 bytes'));
  const withoutP = await scopeText(null);
  check('with no record the panel is omitted and the tab still builds', !withoutP.includes('RUN PROVENANCE') && withoutP.includes('ENGAGEMENT DETAILS'));
  const unknownP = await scopeText({ schema: 1 });
  check('a record with missing fields shows "unknown" rather than failing', unknownP.includes('RUN PROVENANCE') && unknownP.includes('unknown'));

  // 8. provenanceRows wording matches what the tab shows
  const rows = prov.provenanceRows(rec).map(r => r[0]);
  check('provenanceRows lists the five facts in the same order as the tab', rows.join('|') === 'Input file hash (SHA-256)|Input size|Validator code version|Rule set version|Reviewer model(s)');

  // 9. acceptance baseline harness: all 16 cases present, and the committed baseline matches the code
  const acc = require('./scripts/acceptance-baseline');
  check('all 16 acceptance cases are defined, each with an owner patch', acc.CASES.length === 16 && acc.CASES.every(c => c.owner_patch >= 28 && c.owner_patch <= 33));
  const base = JSON.parse(fs.readFileSync('acceptance/baseline.json', 'utf8'));
  check('the committed baseline covers every case', acc.CASES.every(c => base[c.id]));
  let accOut = '', accOk = true;
  try { accOut = execFileSync('node', ['scripts/acceptance-baseline.js'], { encoding: 'utf8', timeout: 240000 }); } catch (e) { accOk = false; accOut = String(e.stdout || e.message); }
  check('current statuses equal the committed baseline', accOk && accOut.includes('unchanged'));

  // 10. the baseline-run script refuses a missing file cleanly
  let code = 0; try { execFileSync('node', ['scripts/baseline-run.js', path.join(tmp, 'none.xlsx')], { stdio: 'pipe' }); } catch (e) { code = e.status; }
  check('baseline-run exits 1 with a usage message for a missing file', code === 1);

  console.log(allPass ? '\nAll Patch 27 checks pass.' : '\nSOME CHECKS FAILED');
  process.exit(allPass ? 0 : 1);
})();
