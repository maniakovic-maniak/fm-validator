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

const fs = require('fs');
const path = require('path');

// FIX: found via investigating a real, confirmed false positive from
// an independent review — the reported "83 defined names" undercounted
// the workbook's true population of 99. Traced precisely: 12 genuine
// names use a range syntax ExcelJS's own defined-name parser silently
// drops entirely rather than exposing malformed — a dynamic range
// using INDEX() as its own upper bound (e.g.
// "Underwriting!$L$75:INDEX(Underwriting!$L$75:$EN$75,1,Timing_Reversion_Month+1)"),
// a whole-row reference with no column letters at all
// ("Underwriting!$80:$84"), or a named constant holding a literal text
// string rather than any cell reference ("Units_Ind" = "Units"). None
// of these are malformed — they're valid Excel constructs ExcelJS's
// parser doesn't support. Re-parses xl/workbook.xml directly (a
// lightweight, dependency-free zip+regex extraction, not a full XML
// parser) to recover exactly the names ExcelJS silently dropped.
function extractRawDefinedNames(filePath) {
  try {
    // xlsx/xlsm files are zip archives; xl/workbook.xml is stored
    // uncompressed-enough to regex-scan directly in the common case,
    // but to stay dependency-free and robust, use the same yauzl-free
    // approach: read the .xlsx as a zip via Node's zlib is non-trivial
    // without a library already in this project's dependencies, so
    // this uses a minimal, self-contained zip central-directory walk
    // limited to extracting exactly one entry (xl/workbook.xml).
    const buf = fs.readFileSync(filePath);
    const xml = extractZipEntryText(buf, 'xl/workbook.xml');
    if (!xml) return [];

    const names = [];
    const dnBlockRe = /<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g;
    let m;
    while ((m = dnBlockRe.exec(xml))) {
      const attrs = m[1];
      const nameMatch = /\bname="([^"]*)"/.exec(attrs);
      if (!nameMatch) continue;
      const name = decodeXmlEntities(nameMatch[1]);
      const text = decodeXmlEntities(m[2].trim());
      names.push({ name, text });
    }
    return names;
  } catch (_) {
    return []; // best-effort supplement — never let this break the audit itself
  }
}

function decodeXmlEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Minimal ZIP central-directory walk to extract one named entry's
// text content, without pulling in a new dependency for a single
// lightweight lookup. xlsx/xlsm defined-names XML is small (a few KB
// at most even in a large workbook), so this is cheap.
function extractZipEntryText(buf, entryName) {
  const zlib = require('zlib');
  // Find End of Central Directory record to locate the central directory.
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
  }
  if (eocdOffset === -1) return null;
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const cdEntryCount = buf.readUInt16LE(eocdOffset + 10);

  let offset = cdOffset;
  for (let i = 0; i < cdEntryCount; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) break; // not a central-directory entry
    const compMethod = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);

    if (name === entryName) {
      // Read the local file header to find where actual data starts.
      const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
      const lfhExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
      const compData = buf.subarray(dataStart, dataStart + compSize);
      const raw = compMethod === 0 ? compData : zlib.inflateRawSync(compData);
      return raw.toString('utf8');
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

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

function isNamedConstant(ranges) {
  if (!ranges || ranges.length !== 1) return false;
  const text = ranges[0];
  // A genuine range/cell reference always contains "!" (a sheet
  // qualifier) or at minimum a "$" (an absolute reference) — a bare
  // word or short string with neither is a named constant holding a
  // literal value, not a range that failed to parse.
  return typeof text === 'string' && !text.includes('!') && !text.includes('$');
}

function isBrokenRange(workbook, ranges) {
  if (!ranges || ranges.length === 0) return true;   // no target at all
  if (isNamedConstant(ranges)) return false;          // holds a literal value, not meant to resolve to a range
  for (const r of ranges) {
    const m = /^'?([^'!]+)'?!(.+)$/.exec(r);
    if (!m) return true;                              // unparseable reference
    const [, sheetName] = m;
    if (FUNCTION_CALL_SHEET_RE.test(sheetName)) continue; // a dynamic OFFSET/INDEX/COUNTA-style formula ExcelJS mis-split at a comma — not a genuine sheet reference, can't reliably validate this way, don't assert broken
    if (!workbook.getWorksheet(sheetName)) return true; // sheet no longer exists
  }
  return false;
}

function detectNamedRangeIssues(workbook, filePath) {
  let definedNames;
  try { definedNames = workbook.definedNames.model || []; }
  catch (_) { return emptyResult('Workbook has no accessible defined-names model.'); }

  // FIX: supplement with names ExcelJS's own parser silently dropped
  // (dynamic-range/whole-row/named-constant syntax it doesn't support)
  // — confirmed directly this closes a real 12-name undercount. Only
  // attempted when a file path is available; deduplicates by name so
  // one ExcelJS already exposed correctly isn't double-counted.
  if (filePath) {
    const existingNames = new Set(definedNames.map(dn => dn.name));
    const rawNames = extractRawDefinedNames(filePath);
    for (const { name, text } of rawNames) {
      if (existingNames.has(name) || !name) continue;
      existingNames.add(name);
      definedNames = definedNames.concat([{ name, ranges: [text], _rawSupplement: true }]);
    }
  }

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
