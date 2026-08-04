// nonexistent-sheet-reference-check.js
//
// Found via an independent review (MR-001): MODEL GUIDE repeatedly
// contains plain-text strings like "PROJECT INPUTS!H36" and "MODEL
// AUDIT!M271" — written as documentation/instructional text (not live
// formulas), following exact SheetName!CellRef syntax, that reference
// sheets ("PROJECT INPUTS", "MODEL AUDIT", "INPUT GOVERNANCE") which
// do not exist anywhere in the actual 14-sheet workbook. Confirmed
// directly: "MODEL AUDIT" appears 33 times, "INPUT GOVERNANCE" 11
// times, both across the whole workbook, mostly on the guide sheet.
//
// This detects the pattern mechanically and precisely: text matching
// SheetName!CellRef syntax (the same syntax a real Excel reference
// uses) where the extracted sheet-name prefix doesn't match any real
// sheet in the workbook. Deliberately scoped to this exact syntax
// (not any capitalized phrase) to keep false-positive risk low —
// ordinary prose that happens to mention a proper noun in passing
// will not match, since it won't be followed by "!" and a valid cell
// address.

// Matches when the ENTIRE (trimmed) cell value is just a sheet!cell
// reference — nothing else. Confirmed directly this is how the real
// cases actually appear (e.g. MODEL GUIDE!C6's whole value is exactly
// "PROJECT INPUTS!H36") — an earlier substring-search design matched
// across sentence boundaries in ordinary prose (capturing preceding
// words like "and" or "Formula link to" as part of the "sheet name"),
// causing serious over-matching; anchoring to the full cell content
// eliminates that whole class of false positive.
const WHOLE_CELL_SHEET_REF_RE = /^([A-Za-z][A-Za-z0-9 &\-]{1,40})!\$?[A-Z]{1,3}\$?\d{1,7}$/;
const WHOLE_CELL_QUOTED_SHEET_REF_RE = /^'([^']{1,60})'!\$?[A-Z]{1,3}\$?\d{1,7}$/;

const GUIDE_SHEET_NAME_RE = /guide|readme|read[\s-]?me|instructions|index|navigation|contents|how[\s-]?to/i;

function checkNonexistentSheetReferences(workbook) {
  const realSheetNames = new Set(workbook.worksheets.map(ws => ws.name.toLowerCase()));
  const groups = new Map(); // referenced sheet name (as written) -> { cells: [{sheet, address}] }

  workbook.eachSheet(ws => {
    // FIX: scoped to guide/navigational sheets only. A whole-cell
    // "SheetName!Cell" reference elsewhere in the workbook (confirmed
    // directly on data/input sheets like URWLD COMPANY INPUTS) is very
    // likely a legitimate source-file-tracking annotation — recording
    // which external file a value was migrated from — not a claim
    // that sheet should exist within this same workbook. The genuine
    // defect this targets is specifically the model's own guide/
    // navigational documentation misdirecting a reader about this
    // workbook's actual structure.
    if (!GUIDE_SHEET_NAME_RE.test(ws.name)) return;

    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        // Only plain text values — a genuine formula referencing a
        // real-but-differently-cased sheet is Excel's own concern, not
        // this check's; this is specifically about DOCUMENTATION TEXT
        // naming a sheet that was never real to begin with.
        if (cell.formula || typeof v !== 'string') return;

        const trimmed = v.trim();
        const m = WHOLE_CELL_SHEET_REF_RE.exec(trimmed) || WHOLE_CELL_QUOTED_SHEET_REF_RE.exec(trimmed);
        if (!m) return;
        const referencedSheet = m[1].trim();
        if (referencedSheet.length < 3) return; // too short to be a confident sheet-name match
        if (realSheetNames.has(referencedSheet.toLowerCase())) return; // genuinely exists — fine

        const key = referencedSheet.toLowerCase();
        if (!groups.has(key)) groups.set(key, { referencedSheet, cells: [] });
        groups.get(key).cells.push({ sheet: ws.name, address: cell.address });
      });
    });
  });

  const findings = [];
  for (const [, g] of groups) {
    // Require at least 2 occurrences — a single stray match is more
    // likely incidental prose than a genuine, repeated reference to a
    // sheet the documentation believes exists.
    if (g.cells.length < 2) continue;
    const sample = g.cells[0];
    findings.push({
      sheet: sample.sheet, cell: sample.address,
      referencedSheet: g.referencedSheet,
      instanceCount: g.cells.length,
      allSheets: [...new Set(g.cells.map(c => c.sheet))],
      note: `${sample.sheet}!${sample.address} and ${g.cells.length - 1} other cell(s) across ${[...new Set(g.cells.map(c => c.sheet))].join(', ')} contain plain-text references in the form "${g.referencedSheet}!<cell>" — but no sheet named "${g.referencedSheet}" exists anywhere in this ${workbook.worksheets.length}-sheet workbook. This suggests the documentation is out of date relative to the actual workbook structure, referencing a sheet that was renamed, removed, or never actually created.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} distinct non-existent sheet name(s) are referenced in plain text across the workbook.`
      : 'No plain-text reference to a non-existent sheet name was found.',
  };
}

module.exports = { checkNonexistentSheetReferences };
