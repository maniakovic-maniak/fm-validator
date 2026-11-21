const assert = require('assert');
const { computeCrossRunStats, baseRuleId } = require('./src/utils/finding-history');
const { repairLocations } = require('./src/utils/location-repair');
let n = 0; const ok = (c, m) => { assert(c, m); n++; console.log('  ok -', m); };

const mk = (rule, cell, claim) => ({ id: `${rule}-001`, root_cause_id: rule, sheet: 'S', cell, condition: claim || 'x' });
const first = computeCrossRunStats([mk('T2-S5-001', 'B2'), mk('T2-S6-002', 'C3'), mk('T0-X-1', 'D4')], {});
const hist = first.updatedHistory;
// run 2: nothing found; S5-001 not tested, S6-002 tested
const s2 = computeCrossRunStats([], hist, { notTestedRuleIds: ['T2-S5-001'] });
ok(s2.notTestedLlmCount === 1, 'not-run rule counted as not tested');
ok(s2.closedLlmCount === 1, 'tested rule still counted as not found');
ok(s2.closedDeterministicCount === 1, 'deterministic still not found');
const e = Object.values(s2.updatedHistory).find(x => x.rootCauseId === 'T2-S5-001');
ok(e.status === 'open', 'not-tested entry stays open, unchanged');
// run 3: finding returns -> still open, not regressed
const s3 = computeCrossRunStats([mk('T2-S5-001', 'B2')], s2.updatedHistory);
ok(s3.regressedLlmCount === 0 && s3.stillOpen.length === 1, 'returning after not-tested is not a regression');
// no opts: old behaviour
const s4 = computeCrossRunStats([], hist);
ok(s4.notTested.length === 0 && s4.closedFindingCount === 3, 'no option keeps old behaviour');

// locations
const rows = [
  { sheet: 'Dash', cell: 'A1', condition: 'Totals are not reconciled on this sheet' },
  { sheet: 'Dash', cell: 'A1', condition: 'Dash!A1 holds the title only' },
  { sheet: 'Dash', cell: 'A1', condition: 'Dash!V5 is hardcoded' },
  { sheet: 'Dash', cell: 'B7', condition: 'no cell in text' },
];
const out = repairLocations(rows, ['Dash', 'Other']);
ok(rows[0].location_basis === 'sheet_level' && rows[0].cell === 'A1', 'no cell named: sheet-level, cell value untouched');
ok(rows[1].location_basis !== 'sheet_level', 'A1 named on purpose is not sheet-level');
ok(rows[2].cell === 'V5', 'cell read from text still works');
ok(rows[3].location_basis !== 'sheet_level', 'a real cell is not sheet-level');
ok(out.sheetLevel === 1, 'sheet-level count');
console.log(`test-patch62: ${n} checks passed`);
