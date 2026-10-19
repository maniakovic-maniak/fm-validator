const assert = require('assert');
const { applyFindingClasses, groupSameRemediation } = require('./src/utils/finding-class');
const { classifyRecordType, assignRecordTypes } = require('./src/utils/record-type-classifier');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const mk = (id, sev) => ({ id, severity: sev, confidence: 80, condition: 'x', cell: 'AP4' });

// regulated profile: governance capped, design preference observed, other rules untouched
let fs1 = [mk('T2-S9-001', 'critical'), mk('T2-S13-002', 'high'), mk('T2-S8-010', 'high'), mk('T2-S4-006', 'high')];
const r = applyFindingClasses(fs1, { profileId: 'regulated_network_utility' });
assignRecordTypes(fs1);
ok(fs1[0].severity === 'low' && fs1[0].severity_before_class === 'critical', 'critical capped to low, original kept');
ok(fs1[1].severity === 'low', 'high capped to low');
ok(fs1[2].record_type === 'Observation', 'design preference is an observation');
ok(fs1[3].severity === 'high' && fs1[3].record_type === 'Confirmed Finding', 'unrelated rule untouched');
ok(/regulated-network model/.test(fs1[0].condition), 'visible note says why');
ok(r.capped.length === 2 && r.observations.length === 1, 'counts reported');

// another profile or none: nothing changes
let fs2 = [mk('T2-S9-001', 'critical'), mk('T2-S8-010', 'high')];
applyFindingClasses(fs2, { profileId: null });
applyFindingClasses(fs2, { profileId: 'some_other_profile' });
assignRecordTypes(fs2);
ok(fs2[0].severity === 'critical' && fs2[1].record_type === 'Confirmed Finding', 'no profile: unchanged');

// a finding that already set its own record_type is respected
let fs3 = [Object.assign(mk('T2-S8-010', 'high'), { record_type: 'Query' })];
applyFindingClasses(fs3, { profileId: 'regulated_network_utility' });
ok(fs3[0].record_type === 'Query', 'explicit record_type respected');

// same-remedy grouping: all models, needs two members
let fs4 = [mk('T2-S9-002', 'high'), mk('T2-S13-001', 'high'), mk('T2-S13-002', 'high'), mk('T2-S4-001', 'high')];
const g = groupSameRemediation(fs4);
ok(g.length === 1 && fs4[0].related_group_id === 'RC-VERSION-CONTROL' && fs4[2].related_group_id === 'RC-VERSION-CONTROL', 'three version-control rules grouped');
ok(!fs4[3].related_group_id, 'other rule not grouped');
ok(groupSameRemediation([mk('T2-S9-002', 'high')]).length === 0, 'a single member makes no group');
// a cell-based group id wins
let fs5 = [Object.assign(mk('T2-S9-002', 'high'), { related_group_id: 'RC-X' }), mk('T2-S13-001', 'high')];
groupSameRemediation(fs5);
ok(fs5[0].related_group_id === 'RC-X' && fs5[1].related_group_id === 'RC-VERSION-CONTROL', 'existing group id kept');
console.log(n + ' check(s) passed');
