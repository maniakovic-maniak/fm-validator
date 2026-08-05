const { resolveDeepAccountingSheets } = require('./src/validator-tier2.js');

async function main() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ══════════════════════════════════════════════════════════════════
  // The real regression found via a fresh production run: a later
  // revision of the same model added "FUNDING & CAP TABLE" and
  // "OPERATING MODEL" sheets. "Cap Table" and "Operating" (aliases
  // genuinely needed for other models) now match these via
  // word-boundary matching, and since resolveAny returns the first
  // alias that matches in array order, these generic terms were
  // winning over the far more direct "Financial Statements" match —
  // causing Batch 2 to analyze the wrong sheet entirely, missing real
  // cash/balance-sheet defect data that only "Financial Statements"
  // actually contains.
  // ══════════════════════════════════════════════════════════════════
  {
    const sheetNames = [
      'Summary', 'Underwriting', 'Annual Cash Flow', 'Financial Statements',
      'DEBT', 'FUNDING & CAP TABLE', 'OPERATING MODEL', 'PROJECT DATA',
    ];
    const result = resolveDeepAccountingSheets(sheetNames);
    check('regression fixed: "Balance Sheet" resolves to "Financial Statements", not "FUNDING & CAP TABLE"',
      result.resolvedMap['Balance Sheet'] === 'Financial Statements');
    check('regression fixed: "Income Statement" resolves to "Financial Statements", not "OPERATING MODEL"',
      result.resolvedMap['Income Statement'] === 'Financial Statements');
    check('regression fixed: "Equity" resolves to "Financial Statements", not "FUNDING & CAP TABLE"',
      result.resolvedMap['Equity'] === 'Financial Statements');
    check('unaffected: "Cash Flow" still correctly resolves to "Annual Cash Flow"',
      result.resolvedMap['Cash Flow'] === 'Annual Cash Flow');
    check('unaffected: "Debt" still correctly resolves to "DEBT"',
      result.resolvedMap['Debt'] === 'DEBT');
  }

  // ══════════════════════════════════════════════════════════════════
  // Confirm the ORIGINAL fix this alias list exists for still works:
  // a real prior model ("The Bend / David Gifford") had no "Financial
  // Statements" sheet at all, only "SOURCES & USES", "CAP TABLE",
  // "OPERATING", "DEVELOPMENT CF" — these generic terms must still
  // resolve correctly when nothing more specific exists.
  // ══════════════════════════════════════════════════════════════════
  {
    const sheetNames = ['SOURCES & USES', 'CAP TABLE', 'OPERATING', 'DEVELOPMENT CF', 'DEBT SCHEDULE'];
    const result = resolveDeepAccountingSheets(sheetNames);
    check('original fix preserved: "Balance Sheet" still resolves to "SOURCES & USES" when no "Financial Statements" sheet exists',
      result.resolvedMap['Balance Sheet'] === 'SOURCES & USES');
    check('original fix preserved: "Income Statement" still resolves to "OPERATING" when no "Financial Statements" sheet exists',
      result.resolvedMap['Income Statement'] === 'OPERATING');
    check('original fix preserved: "Equity" still resolves to "CAP TABLE" when no "Financial Statements" sheet exists',
      result.resolvedMap['Equity'] === 'CAP TABLE');
    check('original fix preserved: "Cash Flow" still resolves to "DEVELOPMENT CF"',
      result.resolvedMap['Cash Flow'] === 'DEVELOPMENT CF');
  }

  // ══════════════════════════════════════════════════════════════════
  // The real defect this fixes: confirmed directly on
  // Financial_Model_The_Bend_13_7_2026_Audited.xlsx that Depreciation
  // & Tax and Leases both genuinely have real content (P&L!C84
  // "Depreciation", Balance Sheet!D21 "Accumulated depreciation",
  // P&L!C44-C59 multiple real lease line items) but no dedicated
  // schedule sheet — both previously came back unresolved.
  // ══════════════════════════════════════════════════════════════════
  {
    const sheetNames = ['Readme', 'KEY OUTPUTS >>', 'Equity Dashboard', 'Debt Dashboard', 'Cashflow', 'P&L', 'Balance Sheet', 'Valuation', 'Inputs', 'Debt', 'GST Calculation'];
    const result = resolveDeepAccountingSheets(sheetNames);
    check('real defect fixed: "Depreciation & Tax" now resolves to "P&L" instead of coming back unresolved',
      result.resolvedMap['Depreciation & Tax'] === 'P&L');
    check('real defect fixed: "Leases" now resolves to "P&L" instead of coming back unresolved',
      result.resolvedMap['Leases'] === 'P&L');
    check('no other category regressed on this exact sheet list',
      result.resolvedMap['Balance Sheet'] === 'Balance Sheet' &&
      result.resolvedMap['Cash Flow'] === 'Cashflow' &&
      result.resolvedMap['Debt'] === 'Debt' &&
      result.resolvedMap['Equity'] === 'Equity Dashboard');
    check('zero unresolved categories remain for this exact sheet list',
      result.unresolvedCategories.length === 0);
  }

  // Confirms a genuine dedicated schedule, when one exists, still wins
  // over the new P&L/Financial Statements fallback — the fallback must
  // never override a more specific, correct match.
  {
    const sheetNames = ['P&L', 'Balance Sheet', 'Depreciation and Tax', 'Lease Schedule'];
    const result = resolveDeepAccountingSheets(sheetNames);
    check('a genuine dedicated "Depreciation and Tax" schedule still wins over the P&L fallback when both exist',
      result.resolvedMap['Depreciation & Tax'] === 'Depreciation and Tax');
    check('a genuine dedicated "Lease Schedule" still wins over the P&L fallback when both exist',
      result.resolvedMap['Leases'] === 'Lease Schedule');
  }

  // Confirms a model with neither a dedicated schedule NOR any
  // P&L/Financial-Statements-style sheet correctly stays unresolved —
  // the fallback must not over-match on unrelated sheet names.
  {
    const sheetNames = ['Revenue Model', 'Cost Model', 'Summary Dashboard'];
    const result = resolveDeepAccountingSheets(sheetNames);
    check('a model with no matching sheet at all for either category correctly stays unresolved, not falsely matched',
      result.unresolvedCategories.includes('Depreciation & Tax') && result.unresolvedCategories.includes('Leases'));
  }

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
