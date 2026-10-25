#!/usr/bin/env node
// test-patch14.js - the reviewer is told what the macros do, so T2-S10-788 and T2-S13-004 can conclude.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildVbaDigest, stripLine } = require('./src/utils/vba-digest');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } }
const mod = (name, code) => ({ name, moduleType: 'bas', lineCount: code.split('\n').length, sourceCode: code });
const stub = name => mod(name, 'Attribute VB_Name = "' + name + '"\nAttribute VB_Base = "0{00020820-0000-0000-C000-000000000046}"\nAttribute VB_GlobalNameSpace = False\nAttribute VB_Creatable = False\nAttribute VB_PredeclaredId = True\nAttribute VB_Exposed = True\nAttribute VB_TemplateDerived = False\nAttribute VB_Customizable = True');

console.log('Digest');
test('empty sheet stubs are counted as empty, real modules as substantive', () => {
  const d = buildVbaDigest([stub('Sheet1'), stub('ThisWorkbook'), mod('Module1', 'Sub Save()\n  Range("A1").Value = Range("B1").Value\n  Range("A2").Value = 5\nEnd Sub')]);
  assert.strictEqual(d.moduleCount, 3); assert.strictEqual(d.substantiveCount, 1); assert.strictEqual(d.emptyCount, 2);
  assert.deepStrictEqual(d.modules[0].procedures, ['Save']);
});
test('a one-line procedure body does not make a module substantive', () => {
  assert.strictEqual(buildVbaDigest([mod('M', 'Sub Click()\n  Call Other\nEnd Sub')]).substantiveCount, 0);
});
test('recordsDateOrTime is true only when a date or time is recorded', () => {
  const rec = buildVbaDigest([mod('M', 'Sub Log()\n  Range("A1").Value = Now\n  Range("A2").Value = 1\nEnd Sub')]);
  assert.strictEqual(rec.anyRecordsDateOrTime, true);
  const fmt = buildVbaDigest([mod('M', 'Sub Log()\n  s = Format(Now, "yyyy")\n  Range("A2").Value = s\nEnd Sub')]);
  assert.strictEqual(fmt.anyRecordsDateOrTime, true);
});
test('a pause using the clock is not a run log (the ESO macros: Application.Wait (Now + TimeValue(...)))', () => {
  const d = buildVbaDigest([mod('M', 'Sub Run()\n  Application.Wait (Now + TimeValue("0:00:01"))\n  Range("A1").Value = 1\nEnd Sub')]);
  assert.strictEqual(d.anyRecordsDateOrTime, false);
  assert.strictEqual(d.modules[0].usesClock, true);
});
test('words in comments and text strings are ignored', () => {
  const d = buildVbaDigest([mod('M', "Sub Run()\n  ' stamp with Now and Date, then MsgBox\n  Range(\"A1\").Value = 1\n  x = \"Value = Now\"\nEnd Sub")]);
  assert.strictEqual(d.anyRecordsDateOrTime, false); assert.strictEqual(d.anyShowsMessage, false);
  assert.strictEqual(stripLine('x = 1 \' comment Now'), 'x = 1 ');
});
test('calculation changes, value writes and messages are flagged', () => {
  const d = buildVbaDigest([mod('M', 'Sub Run()\n  Application.Calculation = xlManual\n  Range("A1").Value = 1\n  MsgBox "done"\nEnd Sub')]);
  assert.ok(d.anySetsCalculation && d.anyWritesValues && d.anyShowsMessage);
});
test('no modules gives a safe empty digest', () => {
  const d = buildVbaDigest([]); assert.strictEqual(d.moduleCount, 0); assert.strictEqual(d.substantiveCount, 0);
  assert.strictEqual(buildVbaDigest(undefined).moduleCount, 0);
});

console.log('Wiring');
const tier2 = fs.readFileSync(path.join(__dirname, 'src', 'validator-tier2.js'), 'utf8');
test('the reviewer payload carries the digest', () => {
  assert.ok(/digest: \(\(\) => \{ try \{ return vbaReview\.hasVbaProject \? buildVbaDigest\(vbaReview\.modules\)/.test(tier2));
});
const skill = fs.readFileSync(path.join(__dirname, 'config', 'skill.md'), 'utf8');
test('macros_documented is judged against substantive modules, not the raw count', () => {
  assert.ok(/Judge the documentation against the substantive modules/.test(skill));
  assert.ok(/Do not return uncertain because you\s+cannot judge whether a macro is safe to run/.test(skill));
});
test('riio_iteration_state_integrity can fail on "no macro records a date or time"', () => {
  assert.ok(/anyRecordsDateOrTime/.test(skill) && /do not return uncertain for that reason/.test(skill));
});
test('T2-S13-004 is no longer marked manual_only', () => {
  assert.strictEqual(require('./config/checklist.json').tier2.find(r => r.id === 'T2-S13-004').manual_only, false);
});

console.log('Real ESO macros (skipped if the file is not present)');
const eso = '/mnt/user-data/uploads/Final_Determinations_-_ESO_Licence_Model.xlsm';
if (fs.existsSync(eso)) {
  const { runExtraction } = require('./src/validator-vba');
  runExtraction(eso).then(x => {
    const d = buildVbaDigest(x.modules);
    test('ESO: 31 modules, 7 with real code, 24 empty stubs', () => { assert.strictEqual(d.moduleCount, 31); assert.strictEqual(d.substantiveCount, 7); assert.strictEqual(d.emptyCount, 24); });
    test('ESO: macros set calculation and write values but none records a date or time', () => {
      assert.ok(d.anySetsCalculation && d.anyWritesValues); assert.strictEqual(d.anyRecordsDateOrTime, false);
    });
    console.log(`\n${passed} check(s) passed`);
  }).catch(e => { console.error('  FAIL ESO extraction: ' + e.message); process.exitCode = 1; });
} else {
  console.log('  (skipped)');
  console.log(`\n${passed} check(s) passed`);
}
