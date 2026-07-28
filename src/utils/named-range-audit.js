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

// FIX: found via investigating a real, confirmed false positive from a
// forensic audit review — 8 defined names on a real file (Range_Debt,
// Range_Equity, Range_NOI, Range_Building_Type, etc.), each a genuine,
// valid OFFSET/COUNTA-based dynamic range (a common pattern for
// auto-sizing a named range to a variable-length list), were all
// flagged "Broken". Root cause: ExcelJS's own defined-name parser
// splits a formula like OFFSET(Data!$B$25,0,0,COUNTA(Data!$B$25:$B$46),1)
// at its commas and returns malformed fragments such as
// "'OFFSET(Data'!$B$25" and "'COUNTA(Data'!$B$25:$B$46" — the function
// name gets folded into what looks like a quoted sheet name.
// isBrokenRange then naively extracted "OFFSET(Data" as a sheet name,
// correctly found no sheet is literally named that, and flagged the
// range as broken — a false positive on this project's own part, not
// a genuine model defect. Detected here by checking whether the
// "sheet name" extracted by the existing regex itself looks like a
// function call (an uppercase word immediately followed by an open
// parenthesis — OFFSET(, COUNTA(, INDEX(, etc.) — a real sheet name
// can never take this shape. When detected, this range is skipped
// rather than asserted broken: fm-validator cannot reliably validate
// a dynamic OFFSET-based reference this way, and staying silent on
// what it can't verify is safer than a confident false accusation.
const FUNCTION_CALL_SHEET_RE = /^[A-Z][A-Z0-9._]*\(/i;

function rangeToSheets(ranges) {
  const sheets = new Set();
  for (const r of ranges || []) {
    const m = /^'?([^'!]+)'?!/.exec(r);
    if (m && !FUNCTION_CALL_SHEET_RE.test(m[1])) sheets.add(m[1]);
  }
  return [...sheets];
}

function isBrokenRange(workbook, ranges) {
  if (!ranges || ranges.length === 0) return true;   // no target at all
  for (const r of ranges) {
    const m = /^'?([^'!]+)'?!(.+)$/.exec(r);
    if (!m) return true;                              // unparseable reference
    const [, sheetName] = m;
    if (FUNCTION_CALL_SHEET_RE.test(sheetName)) continue; // a dynamic OFFSET/INDEX/COUNTA-style formula ExcelJS mis-split at a comma — not a genuine sheet reference, can't reliably validate this way, don't assert broken
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
