'use strict';
// Patch 39: "not found this run" is stored as not_observed, never as resolved; a run is recorded once; an older run
// finishing late cannot overwrite a newer baseline; two workers cannot lose each other's update.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, spawnSync } = require('child_process');
const H = require('./src/utils/finding-history');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };
const F = (...cells) => [{ root_cause_id: 'T0-X-001', affected_cells: cells, label: 'x' }];
const key = 'p39-test-' + process.pid + '-' + Date.now();
const file = H.historyFilePath(key);
const cleanup = () => { for (const f of fs.readdirSync(path.dirname(file))) if (f.startsWith(path.basename(file))) { try { fs.unlinkSync(path.join(path.dirname(file), f)); } catch (_) {} } };
const T = n => new Date(Date.UTC(2026, 9, 30, 10, 0, n)).toISOString();

(async () => {
  try {
    // 1. vocabulary
    let r1 = H.recordRun(key, F('S!A1', 'S!A2'), { runId: 'R1', startedAt: T(1) });
    check('first run: advanced, first run, both new', r1.baseline === 'advanced' && r1.isFirstRun && r1.new.length === 2);
    let r2 = H.recordRun(key, F('S!A1'), { runId: 'R2', startedAt: T(2) });
    const rec2 = H.readRecord(key);
    check('a finding not found this run is stored as not_observed, not closed or resolved', rec2.entries['T0-X-001::S!A2'].status === 'not_observed' && r2.closed.length === 1 && !JSON.stringify(rec2.entries).includes('"closed"'));
    let r3 = H.recordRun(key, F('S!A1', 'S!A2'), { runId: 'R3', startedAt: T(3) });
    check('a not-observed finding that comes back has reappeared, with its earlier status named', r3.regressed.length === 1 && r3.regressed[0].previousStatus === 'not_observed');

    // 2. legacy file: "closed" is read as not observed and is never promoted
    cleanup();
    fs.writeFileSync(file, JSON.stringify({ 'T0-X-001::S!A9': { status: 'closed', rootCauseId: 'T0-X-001', cell: 'S!A9', closedAt: '2026-01-01T00:00:00Z', timesClosed: 2 } }));
    const legacy = H.readRecord(key).entries['T0-X-001::S!A9'];
    check('legacy closed is read as not_observed and flagged, not as verified', legacy.status === 'not_observed' && legacy.legacyClosed === true);
    const rl = H.recordRun(key, F('S!A9'), { runId: 'L1', startedAt: T(1) });
    check('a legacy closed finding that is found again reappears with its old counts', rl.regressed.length === 1 && rl.regressed[0].timesClosed === 2 && rl.regressed[0].previousStatus === 'not_observed');

    // 3. retry of the run recorded last: replaces it, does not advance the baseline twice
    cleanup();
    const first = H.recordRun(key, F('S!A1', 'S!A2'), { runId: 'ORD-1', startedAt: T(1) });
    const second = H.recordRun(key, F('S!A1', 'S!A2', 'S!A3'), { runId: 'ORD-2', startedAt: T(2) });   // order 2: one new
    const retry = H.recordRun(key, F('S!A1', 'S!A2', 'S!A3'), { runId: 'ORD-2', startedAt: T(2) });     // its report failed; retried
    check('first attempt: A3 is new', second.new.length === 1 && second.stillOpen.length === 2);
    check('retry of the same order gives the same answer (A3 still new, not "still open")', retry.baseline === 'replaced_retry' && retry.new.length === 1 && retry.stillOpen.length === 2);
    check('the retry did not duplicate or advance history', Object.keys(H.readRecord(key).entries).length === 3);

    // 4. an older run finishing late
    const newer = H.recordRun(key, F('S!A1'), { runId: 'ORD-4', startedAt: T(10) });
    const before = fs.readFileSync(file, 'utf8');
    const late = H.recordRun(key, F('S!A1', 'S!A2', 'S!A3', 'S!A7'), { runId: 'ORD-3', startedAt: T(5) });   // started before ORD-4
    check('an older run finishing late does not overwrite the newer baseline', late.baseline === 'not_advanced_older' && fs.readFileSync(file, 'utf8') === before && /newer run/.test(late.recordNote));
    check('and the baseline still holds the newer run (A2, A3 not observed)', H.readRecord(key).entries['T0-X-001::S!A2'].status === 'not_observed' && newer.closed.length === 2);
    const snap = fs.readFileSync(file, 'utf8');
    const again = H.recordRun(key, F('S!A1', 'S!A2', 'S!A3'), { runId: 'ORD-2', startedAt: T(2) });     // a retry of an EARLIER order
    check('retry of an earlier run after a newer one was recorded changes nothing', again.baseline === 'not_advanced_older' && fs.readFileSync(file, 'utf8') === snap);

    // 5. incomplete evidence: a verified status needs evidence and can only be set explicitly
    const entries = H.readRecord(key).entries;
    let threw = 0;
    for (const bad of [{ status: 'verified_resolved' }, { status: 'verified_resolved', evidence: { method: 'retest' } }, { status: 'closed', evidence: { method: 'm', detail: 'd', checkedAt: T(1) } }]) { try { H.markVerification(entries, 'T0-X-001::S!A2', bad); } catch (_) { threw++; } }
    check('verification is refused without evidence or with a wrong status', threw === 3);
    const ok = H.markVerification(entries, 'T0-X-001::S!A2', { status: 'verified_resolved', evidence: { method: 'retest of the original condition', detail: 'S!A2 now equals S!A1', checkedAt: T(20) } });
    check('verification with evidence is recorded and nothing else changes', ok['T0-X-001::S!A2'].status === 'verified_resolved' && ok['T0-X-001::S!A2'].verification.method && entries['T0-X-001::S!A2'].status === 'not_observed');
    const rv = H.computeCrossRunStats(F('S!A2'), ok);
    check('a finding that was verified resolved and comes back is a reappearance', rv.regressed.length === 1 && rv.regressed[0].previousStatus === 'verified_resolved');

    // 6. locking
    cleanup();
    H.recordRun(key, F('S!A1'), { runId: 'B0', startedAt: T(1) });
    fs.writeFileSync(file + '.lock', '');
    process.env.FM_HISTORY_LOCK_WAIT_MS = '300';
    // module constant is read at load: spawn a child that sees the override
    const child = spawnSync(process.execPath, ['-e', `const H=require('./src/utils/finding-history');const r=H.recordRun(${JSON.stringify(key)},[{root_cause_id:'T0-X-001',affected_cells:['S!A5'],label:'x'}],{runId:'BUSY',startedAt:new Date().toISOString()});console.log(JSON.stringify({b:r.baseline,n:r.new.length}))`], { env: Object.assign({}, process.env, { FM_HISTORY_LOCK_WAIT_MS: '300' }), encoding: 'utf8' });
    const busy = JSON.parse(child.stdout.trim().split('\n').pop());
    check('a fresh lock held by another run: stats are still given, history is not written, and it says so', busy.b === 'not_saved_busy' && busy.n === 1 && !('T0-X-001::S!A5' in H.readRecord(key).entries));
    fs.unlinkSync(file + '.lock');
    fs.writeFileSync(file + '.lock', ''); const old = new Date(Date.now() - 120000); fs.utimesSync(file + '.lock', old, old);
    const rs = H.recordRun(key, F('S!A1', 'S!A6'), { runId: 'B1', startedAt: new Date().toISOString() });
    check('a stale lock (older than 60 s) is cleared and the run is recorded', rs.baseline === 'advanced' && !fs.existsSync(file + '.lock'));

    // 7. six workers at once on one model
    cleanup();
    H.recordRun(key, F('S!A1'), { runId: 'W0', startedAt: T(0) });
    const code = i => `const H=require('./src/utils/finding-history');const r=H.recordRun(${JSON.stringify(key)},[{root_cause_id:'T0-X-001',affected_cells:['S!A1','S!W${i}'],label:'x'}],{runId:'W${i}',startedAt:${JSON.stringify('')}+new Date(Date.UTC(2026,9,30,10,0,${i + 1})).toISOString()});console.log(r.baseline)`;
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map(i => new Promise(res => { const c = spawn(process.execPath, ['-e', code(i)], { stdio: ['ignore', 'pipe', 'inherit'] }); let out = ''; c.stdout.on('data', d => out += d); c.on('close', () => res(out.trim())); })));
    let parsed = null; try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    check('after six simultaneous runs the file is valid and no lock is left', !!parsed && parsed.version === 2 && !fs.existsSync(file + '.lock'));
    const last = parsed && parsed.meta.lastRun;
    check('the baseline is the run with the latest start time, whatever order they finished in', last && last.runId === 'W6' && parsed.entries['T0-X-001::S!W6'] && parsed.entries['T0-X-001::S!W6'].status === 'open');
    check('every worker got an answer', results.length === 6 && results.every(x => /advanced|not_advanced_older/.test(x)));

    // 8. report: wording and note reach the Audit Output
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rep39-'));
    const payload = { originalName: 't.xlsx', modelType: 't', modelIndustry: 't', modelSummary: { currency: 'AUD', periodicity: 'monthly', key_sheets: ['S'] }, tier0: { stats: {}, cellScoreIndex: {}, uniqueFormulas: [], edgeList: [] }, overallAssessment: 'audit_complete', igReadiness: 97, igCommentary: 't', ruleResults: [], errorScan: [], redundantInputs: { applicable: false }, orphanSheets: { applicable: false }, namedRangeAudit: { applicable: false }, formulaDeepDive: { applicable: false }, reasonableness: {}, duplicateSheets: { applicable: false }, vbaReview: { applicable: false }, deepAccountingResolvedSheets: {}, findings: [],
      crossRunStats: { isFirstRun: false, closed: [{}], new: [], regressed: [{}], stillOpen: [], closedFindingCount: 1, regressedFindingCount: 1, closedDeterministicCount: 1, regressedDeterministicCount: 1, newFindingCount: 0, stillOpenFindingCount: 0, recordNote: 'A newer run of this model was recorded while this one was running.' } };
    fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify(payload));
    const b = spawnSync('python3', ['src/build_report.py', path.join(dir, 'p.json'), path.join(dir, 'o.xlsx')], { encoding: 'utf8', timeout: 180000 });
    const py = 'import openpyxl,sys\nwb=openpyxl.load_workbook(sys.argv[1])\nfor c in (c for r in wb["Audit Output"].iter_rows() for c in r if c.value is not None): print(str(c.value).replace("\\n"," "))';
    const text = b.status === 0 ? spawnSync('python3', ['-c', py, path.join(dir, 'o.xlsx')], { encoding: 'utf8' }).stdout : '';
    check('report: "reappeared" replaces "regressed" and the history note is shown', /1 reappeared \(not found in an earlier run/.test(text) && /REAPPEARED/.test(text) && /Note on history/.test(text) && /newer run of this model/.test(text));
  } finally { cleanup(); }
  console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 39 checks passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL: ' + e.stack); try { cleanup(); } catch (_) {} process.exit(1); });
