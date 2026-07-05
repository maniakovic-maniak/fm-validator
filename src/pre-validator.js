// Pre-validation gate v2 — industry-agnostic, content-based.
//
// v1 hard-stopped any workbook without >=2 sheet names matching a hardcoded
// keyword list. That rejected legitimate models with unconventional tab
// names (single-sheet analyses, non-English names, abbreviations) and made
// the product mining/convention-specific. Sheet-name recognition is already
// covered by checklist rule T1-002 as a *flagged finding*, so the gate
// duplicating it as a hard stop added no coverage — only false rejections.
//
// v2 philosophy: the gate's only job is protecting the pipeline (and the
// ~$5/run API spend) from files that are genuinely not reviewable —
// unreadable, empty, or containing no financial content at all. Everything
// else proceeds, and structural concerns become findings in the report,
// which is what an audit tool should do: report weaknesses, not refuse
// service over them.

function preValidate(parsed, context = {}) {
  const results = [];
  const warnings = [];
  const tier0 = context.tier0Stats || {};
  const model = context.modelSummary || {};

  // ── Hard stop 1: file unreadable / no sheets ──────────────────────────────
  if (!parsed.sheetNames || parsed.sheetNames.length === 0) {
    return {
      passed: false, warnings,
      results: [{ check: 'File readable', status: 'fail',
        reason: 'No sheets found in file. If this is a .xlsb or .xls file, it may not have converted cleanly — try saving as .xlsx and re-uploading.' }]
    };
  }
  results.push({ check: 'File readable', status: 'pass', reason: null });

  // ── Hard stop 2: workbook is empty ────────────────────────────────────────
  let totalCells = 0, numericCells = 0;
  for (const name of parsed.sheetNames) {
    const rows = parsed.sheets[name] || [];
    for (const row of rows) {
      // parseWorkbook rows are objects keyed by header label; tolerate arrays too
      const values = Array.isArray(row) ? row : (row && typeof row === 'object' ? Object.values(row) : []);
      for (const cell of values) {
        if (cell === null || cell === undefined || cell === '') continue;
        totalCells++;
        const v = (cell && typeof cell === 'object' && 'v' in cell) ? cell.v : cell;
        if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))) numericCells++;
      }
    }
  }
  if (totalCells === 0) {
    results.push({ check: 'Workbook has content', status: 'fail', reason: 'Every sheet is empty' });
    return { passed: false, results, warnings };
  }
  results.push({ check: 'Workbook has content', status: 'pass', reason: `${totalCells} populated cells` });

  // ── Hard stop 3: no financial signal at all ───────────────────────────────
  // A reviewable financial file has formulas, or meaningful numeric content,
  // or the familiariser recognised it as a model. Only when ALL of those are
  // absent is this a junk upload (e.g. a text document saved as xlsx).
  const formulaCells = tier0.formulaCells ?? null; // null = tier0 not supplied
  const familiarKnows = !!(model.model_type || model.type || model.industry);
  const noFormulas = formulaCells !== null ? formulaCells === 0 : false;
  if (noFormulas && numericCells < 10 && !familiarKnows) {
    results.push({ check: 'Financial content present', status: 'fail',
      reason: `No formulas, only ${numericCells} numeric cells, and the model type could not be identified — this does not appear to be a financial model` });
    return { passed: false, results, warnings };
  }
  results.push({ check: 'Financial content present', status: 'pass',
    reason: formulaCells !== null ? `${formulaCells} formula cells, ${numericCells} numeric cells` : `${numericCells} numeric cells` });

  // ── Everything below is advisory — warnings, never stops ─────────────────
  const KNOWN = ['dashboard','inputs','cons','ops','ifs','afs','debt','equity','p&l','income statement',
    'balance sheet','cash flow','assumptions','revenue','costs','summary','model','forecast','budget',
    'capex','working capital','tax','sensitivity','scenarios','checks','audit','cover','waterfall'];
  const matched = parsed.sheetNames.filter(n =>
    KNOWN.some(k => n.trim().toLowerCase().includes(k)));
  if (matched.length < 2) {
    warnings.push(`Only ${matched.length} conventionally-named sheet(s) recognised (${parsed.sheetNames.slice(0,8).join(', ')}${parsed.sheetNames.length>8?'…':''}) — structure checks in the report (T1-002) will flag this`);
  }
  if (parsed.sheetNames.length === 1) {
    warnings.push('Single-sheet workbook — review depth will be limited to what one sheet can evidence');
  }

  return { passed: true, results, warnings };
}

module.exports = { preValidate };
