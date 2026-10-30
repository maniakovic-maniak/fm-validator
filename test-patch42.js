'use strict';
// Patch 42: the priority-output list follows the model across uploads (the upload step adds a timestamp to the name).
const fs = require('fs'), os = require('os'), path = require('path');
const reg = require('./src/utils/output-registry');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };
check('two uploads of one model give one registry key', reg.slug('Final Determinations - ESO Licence Model-1793358051904.xlsm') === reg.slug('Final_Determinations_-_ESO_Licence_Model-1790584805084.xlsm'));
check('different models give different keys', reg.slug('Model A.xlsx') !== reg.slug('Model B.xlsx'));
check('a name that normalises to nothing still gives a key', reg.slug('.xlsx').length > 0 && reg.slug('').length > 0);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p42-'));
fs.writeFileSync(path.join(dir, reg.slug('Acme Model.xlsx') + '.json'), JSON.stringify({ status: 'approved', approved_by: 'X', approved_on: '2026-10-30', outputs: [{ sheet: 'S', row: 2, label: 'IRR' }] }));
check('an approval is found for a later, timestamped upload of the same model', reg.loadRegistryState('Acme Model-1793358051904.xlsx', dir).status === 'approved');
check('it is not found for another model', reg.loadRegistryState('Other-1793358051904.xlsx', dir).status === 'none');
const eso = reg.loadRegistryState('Final Determinations - ESO Licence Model-1793358051904.xlsm');
check('the ESO list is approved with its outputs and no bare "Check" rows', eso.status === 'approved' && eso.outputs > 40 && !eso.definitions.some(d => /^check$/i.test(d.label)));
console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 42 checks passed');
process.exit(fails ? 1 : 0);
