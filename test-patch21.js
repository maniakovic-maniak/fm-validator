const { annotateMasterFindings, countMasters } = require('./src/utils/master-findings');
let fail=0; const ok=(c,m)=>{ if(!c){fail++;console.log('FAIL:',m);} else console.log('PASS:',m); };
const fs=[
 {id:'a',priority:'P1',record_type:'Query'},
 {id:'b',priority:'P1',record_type:'Critical Query'},
 {id:'c',priority:'P2',record_type:'Confirmed Finding'},
 {id:'d',priority:'P3',record_type:'Confirmed Finding',related_group_id:'g'},
 {id:'e',priority:'P1',record_type:'Observation',related_group_id:'g'},
 {id:'f',priority:'P2'}
];
annotateMasterFindings(fs);
const m=countMasters(fs);
ok(m.P1===0,'queries and observations never count as P1');
ok(m.P2===2,'confirmed P2 counted (record_type absent = confirmed)');
ok(m.P3===1&&fs[3].master_priority==='P3','a non-confirmed member does not raise its group to P1');
ok(fs[0].master_priority===null,'a Query has no master priority');
process.exit(fail?1:0);
