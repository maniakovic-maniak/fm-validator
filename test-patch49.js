'use strict';
// Patch 49: findings merged into one group because they share a cell are numbered as distinct issues.
const fs = require('fs');
const { annotateMasterFindings, countMasters } = require('./src/utils/master-findings');
let fails = 0;
const check = (n, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'}: ${n}`); if (!ok) fails++; };
const mk = (id, sev, extra) => Object.assign({ id, severity: sev, label: `Title of ${id}`, record_type: 'Confirmed Finding', related_group_id: 'RC-1', affected_cells: ['Sheet1!A1'] }, extra);

// two different checks on the same cell
const two = [mk('T0-ERRLITERAL-001', 'high'), mk('T2-S4-006', 'critical', { affected_cells: ['Sheet1!A1', 'Sheet1!A2'] })];
annotateMasterFindings(two);
check('two different checks in one group are Issue 1 of 2 and Issue 2 of 2, the higher priority first', two[1].issue_label === 'Issue 1 of 2' && two[0].issue_label === 'Issue 2 of 2');
check('each member can see what both issues are', two[0].issue_summaries.length === 2 && two[0].issue_summaries[0].priority === 'P1' && two[0].issue_summaries[1].priority === 'P2');
check('the group still counts once, at its highest priority (counts unchanged)', JSON.stringify(countMasters(two)) === JSON.stringify({ P1: 1, P2: 0, P3: 0 }));
check('no row is dropped or merged', two.length === 2 && two.every(f => f.master_finding_id === 'RC-1' && f.linked_findings === 2));

// one check repeated across cells is one issue with occurrences
const rep = [mk('T0-ERRLITERAL-001', 'high'), mk('T0-ERRLITERAL-002', 'high', { affected_cells: ['Sheet1!B1'] }), mk('T0-ERRLITERAL-003', 'high', { affected_cells: ['Sheet1!C1'] })];
annotateMasterFindings(rep);
check('the same check repeated is one issue, so no issue label', rep.every(f => f.issue_label === null && f.issue_count === 1));

// a mixed group: two from one check, one from another
const mix = [mk('T0-ERRLITERAL-001', 'high'), mk('T0-ERRLITERAL-002', 'high'), mk('T2-S4-006', 'medium')];
annotateMasterFindings(mix);
check('occurrences of one check share an issue number', mix[0].issue_no === mix[1].issue_no && mix[0].issue_no !== mix[2].issue_no && mix[0].issue_count === 2);

// a standalone finding is untouched
const solo = [{ id: 'T1-001', severity: 'low', record_type: 'Confirmed Finding' }];
annotateMasterFindings(solo);
check('a finding on its own has no issue label', solo[0].issue_label === null && solo[0].linked_findings === 1);

const py = fs.readFileSync('src/build_report.py', 'utf8');
check('the Issue Log Master Finding column shows the issue label', /Master Finding.*issue_label/.test(py));
console.log(fails ? `${fails} FAILED` : 'All Patch 49 checks passed');
process.exit(fails ? 1 : 0);
