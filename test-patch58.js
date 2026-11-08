// Patch 58: explicit duplicate link and remedy notes.
const assert = require('assert');
const { linkRelatedFindings } = require('./src/utils/related-findings');
const { applyRemedyNotes } = require('./src/utils/remedy-notes');
const { annotateMasterFindings, countMasters } = require('./src/utils/master-findings');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS:', name); };

const mk = (id, condition, extra) => Object.assign({ id, sheet: 'SystemOperator', cell: 'A1', severity: 'medium', record_type: 'Confirmed Finding', condition }, extra);
t('"As reported under X" links the repeat to X without shared cells', () => {
  const a = mk('T2-S3-005', 'Corporation tax rate 0.190 recurs with no link.');
  const b = mk('T2-S3-011', 'As reported under T2-S3-005: the rate recurs with no link.');
  const c = mk('T2-S9-001', 'Something else entirely.');
  const out = linkRelatedFindings([a, b, c]);
  assert.strictEqual(out.length, 1); assert.deepStrictEqual(out[0].ids.sort(), ['T2-S3-005', 'T2-S3-011']);
  assert.ok(b.condition.includes('repeats or restates T2-S3-005'));
  assert.ok(a.condition.includes('repeats or restates T2-S3-011'));
  assert.strictEqual(b.related_group_id, a.related_group_id); assert.ok(!c.related_group_id);
});
t('the repeat is counted once as a master finding, and nothing is dropped', () => {
  const a = mk('T2-S3-005', 'Rate recurs.', { priority: 'P2', record_type: 'Confirmed Finding' });
  const b = mk('T2-S3-011', 'Same as T2-S3-005: rate recurs.', { priority: 'P2', record_type: 'Confirmed Finding' });
  const all = [a, b]; linkRelatedFindings(all); annotateMasterFindings(all);
  assert.strictEqual(all.length, 2); assert.strictEqual(a.master_finding_id, b.master_finding_id);
});
t('a reference to a finding that is not in the list links nothing', () => {
  const b = mk('T2-S3-011', 'As reported under T2-S3-999: rate recurs.');
  assert.strictEqual(linkRelatedFindings([b, mk('T2-S9-001', 'x')]).length, 0);
  assert.ok(!String(b.condition).includes('repeats or restates'));
});
t('a finding that mentions its own id does not link to itself', () => {
  const a = mk('T2-S3-005', 'As reported under T2-S3-005 in the last run.');
  assert.strictEqual(linkRelatedFindings([a]).length, 0);
});
t('cell-linked findings keep the existing "Same cell(s)" wording', () => {
  const a = mk('T0-X-001', 'Bad ref at SystemOperator!AP10:AT10', { affected_cells: ['SystemOperator!AP10:AT10'] });
  const b = mk('T2-S4-006', 'Broken ref at SystemOperator!AP10:AT10', { affected_cells: ['SystemOperator!AP10:AT10'] });
  linkRelatedFindings([a, b]);
  assert.ok(a.condition.includes('Same cell(s) are also reported by T2-S4-006'));
});
t('re-running the link step adds the note once', () => {
  const a = mk('T2-S3-005', 'Rate.'), b = mk('T2-S3-011', 'As reported under T2-S3-005: rate.');
  linkRelatedFindings([a, b]); linkRelatedFindings([a, b]);
  assert.strictEqual((b.condition.match(/repeats or restates/g) || []).length, 1);
});
t('remedy notes: added once to the three fixes, with severity untouched', () => {
  const f = [
    { id: 'T2-S10-014', severity: 'critical', corrective_action: 'Add a deferred tax bridge.' },
    { id: 'T2-S13-011', severity: 'low', fix_instruction: 'Add local call-up cells.' },
    { id: 'T0-DOUBLESCALE-001', severity: 'medium', corrective_action: 'Remove the second factor.' },
    { id: 'T2-S1-001', severity: 'low', corrective_action: 'unchanged' },
  ];
  assert.deepStrictEqual(applyRemedyNotes(f), ['T2-S10-014', 'T2-S13-011', 'T0-DOUBLESCALE-001']);
  assert.ok(f[0].corrective_action.startsWith('Add a deferred tax bridge. [Remedy note]') && /notional or cash tax/.test(f[0].corrective_action));
  assert.ok(/key lines only/.test(f[1].fix_instruction));
  assert.ok(/unit convention is authoritative/.test(f[2].corrective_action));
  assert.strictEqual(f[3].corrective_action, 'unchanged'); assert.strictEqual(f[0].severity, 'critical');
  assert.deepStrictEqual(applyRemedyNotes(f), []);
});
t('remedy notes: an occurrence-suffixed id still matches; a finding with no fix text is left alone', () => {
  const f = [{ id: 'T2-S10-014-002', corrective_action: 'Fix.' }, { id: 'T2-S13-011', corrective_action: '', fix_instruction: '' }];
  assert.deepStrictEqual(applyRemedyNotes(f), ['T2-S10-014-002']);
});
console.log(`\n${n} checks passed`);
