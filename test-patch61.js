// Patch 61: engine version is recorded and shown; requirements pin the engine.
const fs = require('fs');
let bad = 0; const ck = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) bad++; };
const rr = fs.readFileSync('./src/utils/run-record.js', 'utf8');
ck('run record carries the engine version from the recalculation result', /engine_version: typeof r\.engine_version === 'string' \? r\.engine_version : null/.test(rr));
const br = fs.readFileSync('./src/build_report.py', 'utf8');
ck('Scope and Reliance row names the engine', /Engine: \{_rc\.get\('engine_version'\)\}/.test(br));
const rc = fs.readFileSync('./src/recalc_check.py', 'utf8');
ck('recalc_check reports the installed Formualizer version', /"engine_version": _engine_version\(\)/.test(rc) && /version\("formualizer"\)/.test(rc));
ck('float-equality mismatches are held back with a named root', /a floating-point equality test/.test(rc) && /is_float_equality_quirk/.test(rc));
const rq = fs.readFileSync('./requirements.txt', 'utf8');
ck('requirements pin formualizer and openpyxl', /^formualizer==\d+\.\d+\.\d+$/m.test(rq) && /^openpyxl==\d+\.\d+\.\d+$/m.test(rq));
console.log(bad ? bad + ' failed' : '\n5 checks passed'); process.exit(bad ? 1 : 0);
