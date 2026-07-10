// Named range audit — deterministic, zero API cost.
//
// Three checks, per the ICAEW Financial Modelling Code's "Use clear range
// names where appropriate" guidance and the general principle that every
// named range should earn its place in the model:
//
//   1. Unused — a name defined but never referenced by any formula. Same
//      spirit as redundant-inputs.js, applied to named ranges as
//      first-class objects rather than raw cell values.
//   2. Poorly named — generic auto-numbered names (Range1, Var2, Temp3,
//      single/double letters) that fail the Code's own example: name a
//      senior debt rate SnrIntRate1, not SNR1.
//   3. Broken — the name's own reference no longer resolves (points at a
//      deleted range), independent of whether anything tries to use it.
//      Catches the problem before a formula ever hits #REF!/#NAME?.

const POOR_NAME_RE = /^(range|var|data|temp|tmp|x|y|z|val|value|name|item|list|table)\d*$/i;
const SYSTEM_NAME_RE = /^_xlnm\./i;   // Excel-managed (Print_Area etc.) — not a user choice

function rangeToSheets(ranges) {
  const sheets = new Set();
  for (const r of ranges || []) {
    const m = /^'?([^'!]+)'?!/.exec(r);
    if (m) sheets.add(m[1]);
  }
  return [...sheets];
}

function isBrokenRange(workbook, ranges) {
  if (!ranges || ranges.length === 0) return true;   // no target at all
  for (const r of ranges) {
    const m = /^'?([^'!]+)'?!(.+)$/.exec(r);
    if (!m) return true;                              // unparseable reference
    const [, sheetName] = m;
    if (!workbook.getWorksheet(sheetName)) return true; // sheet no longer exists
  }
  return false;
}

function detectNamedRangeIssues(workbook) {
  let definedNames;
  try { definedNames = workbook.definedNames.model || []; }
  catch (_) { return emptyResult('Workbook has no accessible defined-names model.'); }

  if (definedNames.length === 0) {
    return emptyResult('No named ranges are defined in this model.');
  }

  // Collect every formula's text once, so usage-checking each name is a
  // single pass rather than N re-scans of the whole workbook.
  const allFormulas = [];
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (cell.formula) allFormulas.push(cell.formula);
      });
    });
  });
  const combinedFormulaText = allFormulas.join('\n');

  const unused = [], poorlyNamed = [], broken = [];
  for (const dn of definedNames) {
    const name = dn.name;
    if (!name || SYSTEM_NAME_RE.test(name)) continue;

    const sheets = rangeToSheets(dn.ranges);
    const target = dn.ranges && dn.ranges[0] ? dn.ranges[0] : '(no target)';

    if (isBrokenRange(workbook, dn.ranges)) {
      broken.push({ name, target, issue: 'Reference does not resolve — points at a deleted sheet or invalid range.' });
      continue; // a broken name can't meaningfully be "used" — don't double-flag
    }

    const usedRe = new RegExp('(?<![A-Za-z0-9_.])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9_(])');
    const isUsed = usedRe.test(combinedFormulaText);
    if (!isUsed) unused.push({ name, target, sheets: sheets.join(', ') });

    if (POOR_NAME_RE.test(name)) poorlyNamed.push({ name, target, sheets: sheets.join(', ') });
  }

  return {
    applicable: true,
    totalNamedRanges: definedNames.filter(dn => dn.name && !SYSTEM_NAME_RE.test(dn.name)).length,
    unused, poorlyNamed, broken,
    note: 'Static analysis — "unused" means no formula text anywhere references the name; a name used only via a UDF, VBA macro, or chart data range would not be detected as used. Treat as review candidates.'
  };
}

function emptyResult(note) {
  return { applicable: false, totalNamedRanges: 0, unused: [], poorlyNamed: [], broken: [], note };
}

module.exports = { detectNamedRangeIssues };
