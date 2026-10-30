'use strict';
// Patch 43: the Partner Review export must be clean JSON on stdout even when the parser logs progress lines.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ExcelJS = require('exceljs');
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'PASS: ' : 'FAIL: ') + n); if (!ok) fails++; };
(async () => {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S');
  ws.getCell('A1').value = 'Date'; ws.getCell('B1').value = 'Amount';
  ws.getCell('A2').value = 'n/a'; ws.getCell('A2').numFmt = 'dd/mm/yyyy';   // text in a date-formatted cell: makes the parser log
  ws.getCell('B2').value = { formula: '"FY26"', result: 'FY26' }; ws.getCell('B2').numFmt = 'dd/mm/yyyy';  // a formula returning text in a date-formatted cell
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p43-')), 'm.xlsx'); await wb.xlsx.writeFile(f);
  const r = spawnSync('node', ['scripts/export-for-partner-review.js', f], { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 });
  let parsed = null; try { parsed = JSON.parse(r.stdout); } catch (_) {}
  check('the export exits cleanly', r.status === 0);
  check('stdout is valid JSON with the exported sheet', !!parsed && !!parsed.fullExport && !!parsed.fullExport.sheets.S);
  check('stdout holds nothing but the JSON', r.stdout.trim().startsWith('{') && r.stdout.trim().endsWith('}'));
  check('the parser log line was produced and went to stderr', /Text results in date-formatted cells/.test(r.stderr));
  console.log(fails ? `\n${fails} FAILED` : '\nAll Patch 43 checks passed');
  process.exit(fails ? 1 : 0);
})();
