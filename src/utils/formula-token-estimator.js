// formula-token-estimator.js
//
// Phase 1.1 of the two-route parsing funnel. Estimates, without ever
// building the actual string, how many tokens a full raw-formula-list
// representation of a model would consume — the number the funnel's
// routing decision (Phase 2.1) compares against the configured
// threshold (Phase 1.2) to decide between the full-parse route and the
// current curated route.
//
// Reuses the exact heuristic already in production use in this codebase
// (src/validator-tier2.js, ~line 292: Math.round(JSON.stringify(payload)
// .length / 3)) — no new estimation approach, no tokenizer dependency.
// Applied here to a running character-count accumulator rather than a
// materialized string, since for a model at Hidden Gem's scale (1.15M
// formula cells) the actual raw-formula-list string would itself be
// tens of millions of characters — building it just to measure it and
// then discard it (because the estimate says "too big for this route"
// anyway) would be pure waste.
//
// Uses the exact same cell-iteration pattern already proven throughout
// this codebase (wb.eachSheet -> ws.eachRow -> row.eachCell), including
// the same array-formula unwrapping already used in validator-tier0.js
// (cell.formula can be a string OR an object with a .formula property).

const CHARS_PER_TOKEN = 3; // matches validator-tier2.js's existing heuristic exactly

/**
 * Estimates the token size of a full raw-formula-list representation
 * of the workbook, in the form "SheetName!CellAddress: =formula\n" per
 * formula cell — without ever materializing that full string.
 *
 * @param {ExcelJS.Workbook} workbook
 * @returns {{
 *   formulaCellCount: number,
 *   estimatedCharacters: number,
 *   estimatedTokens: number,
 * }}
 */
function estimateRawFormulaListTokens(workbook) {
  let formulaCellCount = 0;
  let estimatedCharacters = 0;

  workbook.eachSheet((ws) => {
    const sheetName = ws.name;
    let sheetHasFormulas = false;

    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const raw = cell.formula;
        if (!raw) return;
        const formula = typeof raw === 'object' ? raw.formula : raw;
        if (!formula) return;

        formulaCellCount++;
        sheetHasFormulas = true;
        // FIX: the actual full-parse payload (validator-tier2-
        // fullparse.js) groups formulas by sheet — the sheet name is
        // encoded once as an object key, not repeated per formula
        // line. Each line within a sheet's list is genuinely just
        // "CellAddress: =formula\n" — cell.address.length + 3 (': =')
        // + formula.length + 1 ('\n'). The sheet name's own overhead
        // is added once per sheet, below, not here.
        estimatedCharacters += cell.address.length + 3 + formula.length + 1;
      });
    });

    // Sheet-name overhead, once per sheet with any formula content —
    // matches JSON.stringify encoding the sheet name once as the
    // object key (quotes + colon + the name itself), not the flat
    // per-line prefix the original version of this function assumed.
    if (sheetHasFormulas) {
      estimatedCharacters += sheetName.length + 4; // '"' + name + '":' roughly
    }
  });

  return {
    formulaCellCount,
    estimatedCharacters,
    estimatedTokens: Math.round(estimatedCharacters / CHARS_PER_TOKEN),
  };
}

module.exports = { estimateRawFormulaListTokens, CHARS_PER_TOKEN, getMaxFullParseTokens, shouldUseFullParseRoute };

// ══════════════════════════════════════════════════════════════════
// Phase 1.2 — configurable threshold, following the exact precedent
// already established in src/recalc_check.py's
// RECALC_CHECK_MAX_FORMULA_CELLS: an environment variable with a
// sensible hardcoded default, so a provider raising its context window
// in future only requires changing this one number — no code redeploy
// needed for a pure threshold adjustment.
//
// Default derivation: Sonnet 5's ~1M token context window, minus
// system prompt (~15,000-25,000 tokens based on real console output
// this project has produced), minus reserved output space (Bend's real
// batches alone used 52,872-84,678 output tokens each on a far smaller
// model, so a larger model needs real headroom to actually write
// findings, not just read input), minus a safety margin (~10-15%
// unused, consistent with how every batch this project has run has
// stayed comfortably under its nominal ceiling rather than running
// flush against it). Net usable budget: ~780,000 tokens.
//
// An unset or malformed value falls back to the default below, same
// convention as the Python-side precedent.
// ══════════════════════════════════════════════════════════════════
const DEFAULT_MAX_FULL_PARSE_TOKENS = 780000;

function getMaxFullParseTokens() {
  const raw = process.env.FULL_FORMULA_PARSE_MAX_TOKENS;
  if (raw === undefined) return DEFAULT_MAX_FULL_PARSE_TOKENS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_FULL_PARSE_TOKENS;
}

/**
 * The funnel's actual routing decision (used by Phase 2.1). Returns
 * true if the model's raw formula list fits comfortably within the
 * configured token budget and should take the full-parse route; false
 * if it should fall back to the current curated route.
 *
 * @param {ExcelJS.Workbook} workbook
 * @returns {{ useFullParse: boolean, estimate: object, threshold: number }}
 */
function shouldUseFullParseRoute(workbook) {
  const estimate = estimateRawFormulaListTokens(workbook);
  const threshold = getMaxFullParseTokens();
  return {
    useFullParse: estimate.estimatedTokens <= threshold,
    estimate,
    threshold,
  };
}
