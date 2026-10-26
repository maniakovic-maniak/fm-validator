#!/usr/bin/env node
// test-patch25.js - priority counts follow the report rule; Drive step removed; absence diagnostics; skill text.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { annotateMasterFindings, countMasters, priorityOf } = require('./src/utils/master-findings');
const { keptUncertainReason, isConfirmedAbsence } = require('./src/utils/absence-policy');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');

console.log('Priority from severity');
test('severity decides the priority, not the reviewer label', () => {
  assert.strictEqual(priorityOf({ severity: 'critical', priority: 'P3' }), 'P1');
  assert.strictEqual(priorityOf({ severity: 'fatal' }), 'P1');
  assert.strictEqual(priorityOf({ severity: 'high', priority: 'P1' }), 'P2');
  assert.strictEqual(priorityOf({ severity: 'medium' }), 'P2');
  assert.strictEqual(priorityOf({ severity: 'low', priority: 'P1' }), 'P3');
});
test('Query, Critical Query and Observation have no priority', () => {
  for (const rt of ['Query', 'Critical Query', 'Observation']) assert.strictEqual(priorityOf({ record_type: rt, severity: 'critical', priority: 'P1' }), null);
});
test('counts: reviewer P1 labels on medium findings do not make P1s', () => {
  const fs_ = [
    { id: 'a', severity: 'medium', priority: 'P1' }, { id: 'b', severity: 'medium', priority: 'P1' },
    { id: 'c', severity: 'low', priority: 'P2' }, { id: 'd', severity: 'critical', record_type: 'Query', priority: 'P1' }
  ];
  annotateMasterFindings(fs_);
  assert.deepStrictEqual(countMasters(fs_), { P1: 0, P2: 2, P3: 1 });
});
test('a group counts once at its highest priority', () => {
  const fs_ = [{ id: 'a', severity: 'high', related_group_id: 'g' }, { id: 'b', severity: 'low', related_group_id: 'g' }];
  annotateMasterFindings(fs_);
  assert.deepStrictEqual(countMasters(fs_), { P1: 0, P2: 1, P3: 0 });
});
test('server log line uses priorityOf', () => assert.ok(/priorityOf\(f\)/.test(read('server.js'))));

console.log('Google Drive removed');
test('no Drive upload or link in the pipeline or pages', () => {
  for (const f of ['server.js', 'src/notifier.js', 'src/utils/cleanup.js', 'admin/server.js', 'public/fm-validator.html'])
    assert.ok(!/uploadBothFiles|driveWebViewLink|driveLink|sweepDriveFolder|step-drive|open-drive-btn|drive\.google\.com/.test(read(f)), f);
  assert.ok(!fs.existsSync(path.join(__dirname, 'src', 'writer.js')));
});
test('the built report is not deleted after the run', () => {
  const s = read('server.js');
  const i = s.indexOf("event: 'report_delivered'");
  assert.ok(i > 0 && !/fs\.unlink\(reportPath/.test(s.slice(i - 400, i)));
});
test('notification email renders without a link', async () => {
  const { sendNotification } = require('./src/notifier');
  delete process.env.RESEND_API_KEY;
  await sendNotification({ originalName: 'x.xlsx', outputName: 'x_PROCESSED.xlsx', totalIssues: 2, needsAttention: 1 });
});
test('retention sweep keeps reports longer than uploads and needs no folder', () => {
  const { runRetentionSweep } = require('./src/utils/cleanup');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p25-'));
  const up = path.join(dir, 'u'), pr = path.join(dir, 'p'); fs.mkdirSync(up); fs.mkdirSync(pr);
  const old = Date.now() / 1000 - 5 * 86400;
  for (const d of [up, pr]) { const f = path.join(d, 'a.xlsx'); fs.writeFileSync(f, 'x'); fs.utimesSync(f, old, old); }
  return runRetentionSweep({ uploadsDir: up, processedDir: pr }).then(r => {
    assert.strictEqual(r.uploads.deleted, 1);
    assert.strictEqual(r.processed.deleted, 0);
    assert.strictEqual(r.drive, undefined);
  });
});
test('download route has no Drive fallback', () => assert.ok(!/driveWebViewLink/.test(read('server.js'))));

console.log('Absence diagnostics and skill text');
test('limitation wording is reported as the reason', () => {
  const r = { id: 'T', status: 'uncertain', condition: 'No deferred tax line was found; this could not be confirmed from the formula-only extract' };
  assert.strictEqual(isConfirmedAbsence(r), false);
  assert.strictEqual(keptUncertainReason(r), 'reviewer limitation wording');
});
test('a convertible absence has no kept-reason; a non-absence has none either', () => {
  assert.strictEqual(keptUncertainReason({ id: 'T', status: 'uncertain', condition: 'No change log was found in any sheet' }), null);
  assert.strictEqual(keptUncertainReason({ id: 'T', status: 'uncertain', condition: 'Cell A1 looks odd' }), null);
});
test('skill text', () => {
  const k = read('config/skill.md');
  assert.ok(!/T0-DOUBLESCALE/.test(k));
  assert.ok(/### test: opening_forecast_equals_closing_actual/.test(k));
});
console.log(`\n${passed} passed`);
