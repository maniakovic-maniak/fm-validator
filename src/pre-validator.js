const KNOWN_FINANCIAL_SHEETS = [
  'Dashboard', 'Inputs', 'Cons', 'Ops', 'IFS', 'AFS', 'Debt', 'Equity',
  'P&L', 'Income Statement', 'Profit and Loss', 'Balance Sheet', 'Cash Flow',
  'Assumptions', 'Revenue', 'Costs', 'Expenses', 'Summary', 'Overview',
  'Financial Statements', 'Model', 'Forecast', 'Budget', 'Actuals',
  'Capex', 'Working Capital', 'Tax', 'Depreciation', 'Headcount',
  'Sensitivity', 'Scenarios', 'Checks', 'Audit', 'Cover', 'README',
  'Unit Economics', 'Reserves', 'Timing', 'D&T', 'Leases'
];

function preValidate(parsed) {
  const results = [];
  let passed = true;

  // Check 1 — file readable
  if (!parsed.sheetNames || parsed.sheetNames.length === 0) {
    return {
      passed: false,
      results: [{ check: 'File readable', status: 'fail', reason: 'No sheets found in file' }]
    };
  }
  results.push({ check: 'File readable', status: 'pass', reason: null });

  // Check 2 — minimum sheet structure
  const sheetNamesClean = parsed.sheetNames.map(n => n.trim());
  const matchedSheets = sheetNamesClean.filter(name =>
    KNOWN_FINANCIAL_SHEETS.some(known =>
      name.toLowerCase().includes(known.toLowerCase()) ||
      known.toLowerCase().includes(name.toLowerCase())
    )
  );

  if (matchedSheets.length < 2) {
    results.push({
      check: 'Minimum sheet structure present',
      status: 'fail',
      reason: `Only ${matchedSheets.length} recognisable financial sheet(s) found. Found: ${sheetNamesClean.join(', ')}`
    });
    passed = false;
  } else {
    results.push({
      check: 'Minimum sheet structure present',
      status: 'pass',
      reason: `Found ${matchedSheets.length} recognisable financial model sheets`
    });
  }

  // Check 3 — no completely empty matched sheets
  for (const name of matchedSheets.slice(0, 8)) {
    const sheet = parsed.sheets[name];
    if (sheet !== undefined && sheet.length === 0) {
      results.push({
        check: `Sheet not empty: ${name}`,
        status: 'fail',
        reason: `Sheet "${name}" has no data`
      });
      passed = false;
    } else if (sheet !== undefined) {
      results.push({ check: `Sheet not empty: ${name}`, status: 'pass', reason: null });
    }
  }

  // Formula errors are detected and flagged in Tier 1 — not a pre-validation stop

  return { passed, results };
}

module.exports = { preValidate };
