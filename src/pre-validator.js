const XLSX = require('xlsx');

const REQUIRED_SHEETS = [
  'Dashboard',
  'Inputs',
  'Cons',
  'Ops',
  'IFS',
  'AFS',
  'Debt',
  'Equity'
];

const EXCEL_ERRORS = ['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NULL!', '#NUM!'];

function checkForErrors(sheet) {
  const errors = [];
  for (const cell of Object.values(sheet)) {
    if (cell && cell.w && EXCEL_ERRORS.some(e => String(cell.w).includes(e))) {
      errors.push(cell.w);
    }
  }
  return errors;
}

function preValidate(parsed) {
  const results = [];
  let passed = true;

  // Check 1 — file has sheets at all
  if (!parsed.sheetNames || parsed.sheetNames.length === 0) {
    return {
      passed: false,
      results: [{ check: 'File readable', status: 'fail', reason: 'No sheets found in file' }]
    };
  }
  results.push({ check: 'File readable', status: 'pass', reason: null });

  // Check 2 — required sheets present
  const missing = REQUIRED_SHEETS.filter(
    s => !parsed.sheetNames.map(n => n.trim()).includes(s)
  );
  if (missing.length > 0) {
    results.push({
      check: 'Required sheets present',
      status: 'fail',
      reason: `Missing sheets: ${missing.join(', ')}`
    });
    passed = false;
  } else {
    results.push({ check: 'Required sheets present', status: 'pass', reason: null });
  }

  // Check 3 — no completely empty required sheets
  for (const name of REQUIRED_SHEETS) {
    const sheet = parsed.sheets[name];
    if (sheet && sheet.length === 0) {
      results.push({
        check: `Sheet not empty: ${name}`,
        status: 'fail',
        reason: `Sheet "${name}" has no data`
      });
      passed = false;
    } else if (sheet) {
      results.push({ check: `Sheet not empty: ${name}`, status: 'pass', reason: null });
    }
  }

  // Check 4 — no Excel formula errors in key sheets
  const WORKBOOK_RAW = parsed._raw;
  if (WORKBOOK_RAW) {
    for (const name of REQUIRED_SHEETS) {
      const rawSheet = WORKBOOK_RAW.Sheets[name];
      if (rawSheet) {
        const errors = checkForErrors(rawSheet);
        if (errors.length > 0) {
          results.push({
            check: `No formula errors: ${name}`,
            status: 'fail',
            reason: `Found errors in "${name}": ${[...new Set(errors)].join(', ')}`
          });
          passed = false;
        } else {
          results.push({ check: `No formula errors: ${name}`, status: 'pass', reason: null });
        }
      }
    }
  }

  return { passed, results };
}

module.exports = { preValidate };
