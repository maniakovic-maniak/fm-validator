// Patch 55b: occurrence identity in the cross-run history.
const assert = require('assert');
const { currentFingerprints, computeCrossRunStats, normaliseCell, baseRuleId, normaliseEntries } = require('./src/utils/finding-history');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('PASS:', name); };

t('cell addresses: $AP$92, ap92 and quoted sheet names are one place', () => {
  assert.strictEqual(normaliseCell('$AP$92'), 'AP92');
  assert.strictEqual(normaliseCell('ap92'), 'AP92');
  assert.strictEqual(normaliseCell("'Calc 1'!$B$3"), 'Calc 1!B3');
  assert.strictEqual(normaliseCell('Calc!B3'), 'Calc!B3');
  assert.strictEqual(normaliseCell(''), null);
});
t('occurrence suffix folds back to the rule; other ids are untouched', () => {
  assert.strictEqual(baseRuleId('T2-S5-007-002'), 'T2-S5-007');
  assert.strictEqual(baseRuleId('T2-S5-007'), 'T2-S5-007');
  assert.strictEqual(baseRuleId('T1-008-002'), 'T1-008');
  assert.strictEqual(baseRuleId('T0-SUMRANGE-003'), 'T0-SUMRANGE-003');
});
const A = { id: 'T2-S5-007', affected_cells: ['Calc!$AP$92'], condition: 'Tax is calculated on the wrong base', label: 'a' };
const B = { id: 'T2-S5-007-002', base_id: 'T2-S5-007', affected_cells: ['Calc!AP92'], condition: 'Interest is not capitalised', label: 'b' };
t('two claims on one rule and cell are each tracked, in either order', () => {
  const f1 = [...currentFingerprints([A, B]).keys()].sort();
  const f2 = [...currentFingerprints([{ ...B, id: 'T2-S5-007' }, { ...A, id: 'T2-S5-007-002' }]).keys()].sort();
  assert.strictEqual(f1.length, 2); assert.deepStrictEqual(f1, f2);
});
t('swapped order next run: nothing is reported as new or not found', () => {
  const s1 = computeCrossRunStats([A, B], {});
  const s2 = computeCrossRunStats([{ ...B, id: 'T2-S5-007' }, { ...A, id: 'T2-S5-007-002' }], s1.updatedHistory);
  assert.strictEqual(s2.new.length, 0); assert.strictEqual(s2.closed.length, 0); assert.strictEqual(s2.stillOpen.length, 2);
});
t('one claim fixed: only that one is not found, the other stays open', () => {
  const s1 = computeCrossRunStats([A, B], {});
  const s2 = computeCrossRunStats([{ ...B, id: 'T2-S5-007' }], s1.updatedHistory);
  assert.strictEqual(s2.closed.length, 1); assert.strictEqual(s2.stillOpen.length, 1); assert.strictEqual(s2.new.length, 0);
});
t('a single occurrence keeps the plain fingerprint (no tag)', () => {
  assert.deepStrictEqual([...currentFingerprints([A]).keys()], ['T2-S5-007::Calc!AP92']);
});
t('an address written two ways across runs is the same finding', () => {
  const s1 = computeCrossRunStats([{ ...A, affected_cells: ['Calc!$AP$92'] }], {});
  const s2 = computeCrossRunStats([{ ...A, affected_cells: ['Calc!AP92'] }], s1.updatedHistory);
  assert.strictEqual(s2.stillOpen.length, 1); assert.strictEqual(s2.new.length, 0); assert.strictEqual(s2.closed.length, 0);
});
t('old history is migrated: suffixed id and $ address land on the new key', () => {
  const old = { 'T2-S5-007-002::Calc!$AP$92': { status: 'open', rootCauseId: 'T2-S5-007-002', cell: 'Calc!$AP$92', label: 'b' } };
  const m = normaliseEntries(old);
  assert.deepStrictEqual(Object.keys(m), ['T2-S5-007::Calc!AP92']);
  assert.ok(m['T2-S5-007::Calc!AP92'].migratedFrom);
});
t('two old entries that collapse to one: kept open, flagged, and a not-observed one is not read as a reappearance', () => {
  const old = {
    'T2-S5-007::Calc!AP92': { status: 'not_observed', rootCauseId: 'T2-S5-007', cell: 'Calc!AP92', label: 'x' },
    'T2-S5-007-002::Calc!$AP$92': { status: 'not_observed', rootCauseId: 'T2-S5-007-002', cell: 'Calc!$AP$92', label: 'y' },
  };
  const m = normaliseEntries(old); assert.strictEqual(Object.keys(m).length, 1);
  assert.strictEqual(m['T2-S5-007::Calc!AP92'].ambiguous, true);
  const s = computeCrossRunStats([A], old);
  assert.strictEqual(s.regressed.length, 0); assert.strictEqual(s.new.length, 1);
});
t('existing behaviour: a fixed cell is not found, the rest still open, a new one is new', () => {
  const s1 = computeCrossRunStats([{ root_cause_id: 'T0-X-001', affected_cells: ['S!A1', 'S!A2'] }], {});
  const s2 = computeCrossRunStats([{ root_cause_id: 'T0-X-001', affected_cells: ['S!A2', 'S!A3'] }], s1.updatedHistory);
  assert.strictEqual(s2.closed.length, 1); assert.strictEqual(s2.stillOpen.length, 1); assert.strictEqual(s2.new.length, 1);
});
console.log(`\n${n} checks passed`);
