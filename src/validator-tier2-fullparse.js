// validator-tier2-fullparse.js
//
// Phase 2.2 of the two-route parsing funnel. Builds the full raw-
// formula-list payload for models routed here by Phase 2.1's decision
// (confirmed by Phase 1's token estimate to fit comfortably within the
// configured budget) — the genuinely new capability this whole funnel
// exists to add: Tier 2 reasoning directly over formula LOGIC, not just
// extracted/curated values, closing the specific documented gap this
// project has always had (Mode A) — e.g. "equity NPV wired to equity
// value instead of discounted cash flows," a defect invisible to
// value-only inspection.
//
// Deliberately kept as its own module, separate from the existing
// curated-payload logic in validator-tier2.js, rather than tangled
// into it — the existing, proven batch structure and rule-matching
// logic is completely untouched by this file; only the payload content
// differs between the two routes.

/**
 * Builds the full raw-formula-list payload for a single sheet, grouped
 * for readability — "CellAddress: =formula" per line. Uses the exact
 * same array-formula unwrapping already proven throughout this
 * codebase (cell.formula can be a string OR an object with a .formula
 * property).
 *
 * @param {ExcelJS.Worksheet} ws
 * @returns {string|null} null if the sheet has no formula cells at all
 */
function buildSheetFormulaList(ws) {
  const lines = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const raw = cell.formula;
      if (!raw) return;
      const formula = typeof raw === 'object' ? raw.formula : raw;
      if (!formula) return;
      lines.push(`${cell.address}: =${formula}`);
    });
  });
  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Builds the complete full-parse payload across every sheet in the
 * workbook — the direct full-parse-route counterpart to the curated
 * dataSubset object built in the main runTier2 flow.
 *
 * @param {ExcelJS.Workbook} workbook
 * @returns {Object} { [sheetName]: rawFormulaListString }
 */
function buildFullParseFormulaPayload(workbook) {
  const payload = {};
  workbook.eachSheet((ws) => {
    const sheetList = buildSheetFormulaList(ws);
    if (sheetList) payload[ws.name] = sheetList;
  });
  return payload;
}

// ══════════════════════════════════════════════════════════════════
// Additional system-prompt guidance specific to full-parse mode —
// appended to the existing static prompt (SOUL + SKILL + domain),
// never replacing it. Tells Claude explicitly what kind of data it is
// now receiving, since reasoning over raw formula text is a genuinely
// different task from reasoning over curated, pre-extracted values,
// and the existing skill.md guidance was written assuming the latter.
// ══════════════════════════════════════════════════════════════════
const FULL_PARSE_PROMPT_ADDENDUM = `
FULL-PARSE MODE — IMPORTANT DIFFERENCE FROM YOUR USUAL DATA:

This run is small enough to fit complete, unabridged formula text for every
formula cell in the workbook — not curated, pre-extracted values. Each sheet's
data below is a full list of "CellAddress: =formula" lines, exactly as the
formula reads in the workbook.

This means you can now directly verify formula LOGIC, not just plausibility of
displayed values — trace whether a labelled output genuinely computes what its
label claims (e.g. confirm an "NPV" cell's formula actually discounts a cash
flow series, rather than referencing an unrelated value), follow a chain of
references across cells and sheets, and catch a defect that would be
completely invisible from a value alone.

Do not assume any curation or pre-filtering has already happened — every
formula for every populated cell in a given sheet is present. Absence of a
cell in a sheet's list means that cell is genuinely empty or contains a
constant, not that it was filtered out.
`.trim();

module.exports = { buildSheetFormulaList, buildFullParseFormulaPayload, FULL_PARSE_PROMPT_ADDENDUM };
