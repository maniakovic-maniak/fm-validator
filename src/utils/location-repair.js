'use strict';
// Patch 16: give every Tier 2 finding an honest location.
// The reviewer sometimes returns a blank sheet, a cell reference in the sheet field, or "A1" with no sheet at all.
// Before this repair those rows were counted as "unusable" and showed a sheet called "A1" or nothing.
// Order: (1) "Sheet!Cell" written in the finding text, (2) exactly one real sheet named in the text,
// (3) otherwise the finding is workbook-level and says so ("Workbook"), which the report shows without a link.
// A location is never invented: with two or more sheets named, or none, the row stays workbook-level.

const WORKBOOK = 'Workbook';
const CELL_RE = /^\$?[A-Z]{1,3}\$?\d{1,7}$/;

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function sheetsMentioned(text, sheetNames) {
  const found = new Set();
  for (const name of sheetNames) {
    if (!name || name.length < 3) continue;
    // case-sensitive, whole-name match so a sheet called "Tables" is not found inside "stable" or "tables" in prose
    const re = new RegExp('(^|[^A-Za-z0-9_])' + escapeRe(name) + '(?![A-Za-z0-9_])');
    if (re.test(text)) found.add(name);
  }
  // "Cover" inside "FinancialStatements" cannot match (letters either side), but "RoRE" inside "FinRatios RoRE decomposition" can:
  // drop any name that only occurs inside a longer mentioned sheet name
  const arr = [...found];
  return arr.filter(n => !arr.some(m => m !== n && m.includes(n)));
}

// The one cell the text names on the given sheet, or null. Accepts "Sheet!V5", "'Sheet'!V5" and "Sheet V5"; a range counts
// as its first cell. Two different cells on the sheet is ambiguous, so it returns null.
function cellOnSheet(text, sheet) {
  const sh = escapeRe(sheet);
  const re = new RegExp("(?:^|[^A-Za-z0-9_])'?" + sh + "'?(?:\\s*!\\s*|\\s+)\\$?([A-Z]{1,3})\\$?(\\d{1,7})(?![A-Za-z0-9_(])", 'g');
  const cells = new Set(); let m;
  while ((m = re.exec(text))) cells.add(m[1] + m[2]);
  return cells.size === 1 ? [...cells][0] : null;
}

function repairLocations(rows, sheetNames) {
  const names = (sheetNames || []).filter(Boolean);
  const byLower = new Map(names.map(n => [n.toLowerCase(), n]));
  const out = { fromRef: 0, fromText: 0, workbookLevel: 0, unchanged: 0 };
  for (const r of rows) {
    const cur = String(r.sheet == null ? '' : r.sheet).trim();
    const real = byLower.get(cur.toLowerCase());
    if (real) {
      r.sheet = real;
      // Patch 60: a real sheet with the cell left at "A1" (Fm-00066: 76 of 228). Read the cell from the text only when the
      // text names exactly one cell ON THIS SHEET ("DASHBOARD V5" or "DASHBOARD!V5"); two cells or none leaves it as returned.
      const cur2 = String(r.cell == null ? '' : r.cell).trim().toUpperCase();
      if (cur2 === '' || cur2 === 'A1') {
        const cell = cellOnSheet([r.condition, r.reason, r.what_wrong, r.detail].filter(Boolean).join(' '), real);
        if (cell && cell !== 'A1') { r.cell = cell; r.location_basis = 'cell_from_text'; out.fromRef++; continue; }
        // Patch 62: a real sheet, no cell named anywhere in the text (and A1 not named on purpose) is a sheet-level finding.
        // The cell value is left as it was (history fingerprints use it); only the basis is recorded.
        if (!cell) { r.location_basis = 'sheet_level'; out.sheetLevel = (out.sheetLevel || 0) + 1; }
      }
      out.unchanged++; continue;
    }
    const text = [r.condition, r.reason, r.what_wrong, r.detail].filter(Boolean).join(' ');
    // (1) an explicit Sheet!Cell reference
    // a reference counts only when the text points at ONE sheet; a finding quoting several sheets ("X!AQ76 ... the same
    // pattern recurs in Y!AP84") has no single honest location, and picking the first valid one would be a guess
    const refRe = /'([^']+)'!\$?([A-Z]{1,3})\$?(\d{1,7})|\b([A-Za-z0-9_]+)!\$?([A-Z]{1,3})\$?(\d{1,7})/g;
    const refs = []; let m;
    while ((m = refRe.exec(text))) {
      const sh = byLower.get(String(m[1] || m[4]).toLowerCase());
      if (sh) refs.push({ sh, cell: (m[2] || m[5]) + (m[3] || m[6]) });
    }
    if (refs.length && new Set(refs.map(x => x.sh)).size === 1) {
      r.sheet = refs[0].sh; r.cell = refs[0].cell; r.location_basis = 'sheet_cell_from_text'; out.fromRef++; continue;
    }
    if (refs.length) { r.sheet = WORKBOOK; r.location_basis = 'workbook_level'; out.workbookLevel++; continue; }
    // (2) exactly one real sheet named in the finding
    const one = sheetsMentioned(text, names);
    if (one.length === 1) { r.sheet = one[0]; r.location_basis = 'sheet_from_text'; out.fromText++; continue; }
    // (3) workbook-level
    r.sheet = WORKBOOK; r.location_basis = 'workbook_level'; out.workbookLevel++;
  }
  return out;
}

module.exports = { cellOnSheet, repairLocations, sheetsMentioned, WORKBOOK, CELL_RE };
