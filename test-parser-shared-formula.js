const ExcelJS = require('exceljs');
const { parseWorkbook } = require('./src/parser.js');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ══════════════════════════════════════════════════════════════════
  // The real bug found via investigating a genuine forensic audit
  // review: a shared formula (Excel's own optimization for a repeated
  // formula pattern across many columns — extremely common in wide,
  // period-by-period financial statements) returns {formula, ref,
  // shareType:'shared'} on the master cell and {sharedFormula: 'X'} on
  // every dependent cell, from cell.value — with NO "result" key
  // inside cell.value at all, on either the master or a dependent
  // cell. cellPlainValue previously only ever checked cell.value's own
  // "result" field, so every shared-formula cell silently returned
  // null. On the real file this caused entire rows (a hard-coded-zero
  // Cash line, and the balance-sheet check rows depending on it) to
  // vanish entirely before Tier 2 ever saw them — not a reasoning
  // failure, a data-extraction failure at the root.
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.getCell('A1').value = 'Label';
    ws.getCell('B1').value = 'Period';
    ws.getCell('A2').value = 'Source';
    ws.getCell('B2').value = 10;
    ws.getCell('A3').value = 'Shared formula row';
    // Build a genuine shared-formula group the way Excel actually
    // produces one: B3 is the master, B4/B5 share it.
    ws.fillFormula('B3:B5', 'B2*2', [20, 20, 20]);

    await wb.xlsx.writeFile('/tmp/test_shared_formula.xlsx');
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.readFile('/tmp/test_shared_formula.xlsx');
    const ws2 = wb2.getWorksheet('Sheet1');
    const isSharedMaster = typeof ws2.getCell('B3').value === 'object' && ws2.getCell('B3').value.shareType === 'shared';
    const isSharedDependent = typeof ws2.getCell('B4').value === 'object' && 'sharedFormula' in ws2.getCell('B4').value;

    if (isSharedMaster && isSharedDependent) {
      const parsed = await parseWorkbook('/tmp/test_shared_formula.xlsx');
      const rows = parsed.sheets['Sheet1'];
      const row3 = rows.find(r => r._rowNum === 3);
      const row4 = rows.find(r => r._rowNum === 4);
      check('real bug fixed: a shared formula MASTER cell correctly extracts its cached result (20), not null',
        row3 && Object.values(row3).includes(20));
      check('real bug fixed: a shared formula DEPENDENT cell correctly extracts its cached result (20), not null',
        row4 && Object.values(row4).includes(20));
    } else {
      console.log('SKIPPED: this ExcelJS version/save path did not reproduce a genuine shared-formula shape — cannot test the exact real condition synthetically.');
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // Confirm the fix doesn't break the ordinary, ALREADY-working cases:
  // plain values, normal (non-shared) formulas, and formula errors.
  // ══════════════════════════════════════════════════════════════════
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    // A realistic header row, so findHeaderRow doesn't mistake row 2 for headers.
    ws.getCell('A1').value = 'Label';
    ws.getCell('B1').value = 'Value';
    ws.getCell('A2').value = 'Plain number row';
    ws.getCell('B2').value = 42;                                     // plain number
    ws.getCell('A3').value = 'Plain string row';
    ws.getCell('B3').value = 'hello';                                // plain string
    ws.getCell('A4').value = 'Normal formula row';
    ws.getCell('B4').value = { formula: 'B2*2', result: 84 };        // normal, non-shared formula
    ws.getCell('A5').value = 'Formula error row';
    ws.getCell('B5').value = { formula: 'B2/0', result: { error: '#DIV/0!' } }; // formula error

    await wb.xlsx.writeFile('/tmp/test_ordinary_cells.xlsx');
    const parsed = await parseWorkbook('/tmp/test_ordinary_cells.xlsx');
    const rows = parsed.sheets['Sheet1'];
    const row2 = rows.find(r => r._rowNum === 2);
    const row3 = rows.find(r => r._rowNum === 3);
    const row4 = rows.find(r => r._rowNum === 4);
    const row5 = rows.find(r => r._rowNum === 5);

    check('unaffected: a plain number still extracts correctly', row2 && Object.values(row2).includes(42));
    check('unaffected: a plain string still extracts correctly', row3 && Object.values(row3).includes('hello'));
    check('unaffected: a normal (non-shared) formula still extracts its cached result correctly', row4 && Object.values(row4).includes(84));
    check('unaffected: a formula error still extracts as an error string, not crashing or returning null incorrectly',
      row5 && Object.values(row5).includes('#DIV/0!'));
  }

  // ══════════════════════════════════════════════════════════════════
  // End-to-end confirmation against the real file that motivated this
  // fix: row 33 ("Cash", hard-coded to 0 via a shared formula) must
  // now show its genuine value across every period, not null.
  // ══════════════════════════════════════════════════════════════════
  const fs = require('fs');
  const realFile = '/mnt/user-data/uploads/The_Bend_Precinct_Model_26_7_2026_Investor_Ready_v6.xlsm';
  if (fs.existsSync(realFile)) {
    const parsed = await parseWorkbook(realFile);
    const rows = parsed.sheets['Financial Statements'];
    const row33 = rows.find(r => r._rowNum === 33);
    const values = row33 ? Object.values(row33).filter(v => typeof v === 'number') : [];
    check('end-to-end: the real file\'s "Cash" row (33) now shows genuine numeric values across periods, not all-null',
      values.length > 0 && values.every(v => v === 0));
  } else {
    console.log('SKIPPED: end-to-end real-file test (file not present in this environment)');
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
