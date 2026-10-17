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
// Static text index and named-range map.
//
// The formula list above holds only cells that contain a formula. Everything a human reads to understand the model
// - row labels, headings, the cover note, a change log, instructions, source references - is a plain text cell, and
// was never sent. A reviewer that cannot see labels cannot say a label, a schedule or a register is missing, nor
// confirm one exists (Fm-00036: ~20 procedures came back Uncertain for exactly this reason). Named ranges had the
// same gap: a formula reading =ClosingRAV_real showed a name with no definition.
//
// Both are objective, model-independent inputs, sent for every full-parse run. They are capped; if a cap bites, the
// run is told it saw a partial view, so "not present" is never claimed from a workbook it could not fully read.
// ══════════════════════════════════════════════════════════════════
const TEXT_INDEX_MAX_CHARS = 160000;     // ~40-50k real tokens (about $0.4 across the three batches): text tokenizes ~3-4 chars/token, unlike formulas
const TEXT_CELL_MAX_CHARS = 90;
const NARROW_MAX_COL = 5;                // fallback mode: label columns A-E only
const NAMED_RANGE_MAX = 600;
const NAMED_RANGE_REF_MAX = 120;

function cellText(cell) {
  const raw = cell.formula; if (raw) return null;                         // formula cells are in the formula list
  const v = cell.value;
  if (v === null || v === undefined) return null;
  let t = null;
  if (typeof v === 'string') t = v;
  else if (typeof v === 'object' && Array.isArray(v.richText)) t = v.richText.map(r => r.text || '').join('');
  if (t === null) return null;
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > TEXT_CELL_MAX_CHARS ? t.slice(0, TEXT_CELL_MAX_CHARS - 1) + '…' : t;
}

function colLetters(address) { return String(address).replace(/\d+/g, ''); }

// One line per row: "R12: A=Receivables | D=Notes". maxCol 0 = no column limit.
function sheetTextLines(ws, maxCol) {
  const lines = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const parts = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      if (maxCol && colNumber > maxCol) return;
      const t = cellText(cell);
      if (t) parts.push(`${colLetters(cell.address)}=${t}`);
    });
    if (parts.length) lines.push(`R${rowNumber}: ${parts.join(' | ')}`);
  });
  return lines;
}

// Drop rows whose text is identical to an earlier row of the same sheet (archive and scenario sheets repeat the same
// headings thousands of times). Every distinct row is kept, so nothing a reviewer could look for is lost.
function dedupeLines(lines) {
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    const key = l.replace(/^R\d+: /, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

// Share a character budget across sheets so a few huge sheets cannot starve the rest: small sheets keep everything,
// large ones split what is left evenly. Cuts fall on row boundaries and keep the top of each sheet (headings first).
function fairShare(built, maxChars) {
  const sizeOf = b => b.lines.reduce((n, l) => n + l.length + 1, 0);
  const order = built.map((b, i) => ({ i, size: sizeOf(b) })).sort((x, y) => x.size - y.size);
  let remaining = maxChars;
  const allow = new Array(built.length).fill(0);
  order.forEach((o, k) => {
    const share = Math.floor(remaining / (order.length - k));
    allow[o.i] = Math.min(o.size, share);
    remaining -= allow[o.i];
  });
  const truncatedSheets = [];
  const out = built.map((b, i) => {
    const kept = []; let used = 0;
    for (const l of b.lines) { if (used + l.length + 1 > allow[i]) break; kept.push(l); used += l.length + 1; }
    if (kept.length < b.lines.length) truncatedSheets.push(b.name);
    return { name: b.name, lines: kept };
  });
  return { built: out, truncatedSheets };
}

/**
 * @returns {{ bySheet: Object<string,string>, mode: 'full'|'deduped'|'narrowed'|'truncated', chars: number, truncatedSheets: string[] }}
 * mode 'full'      - every static text cell of every sheet is included.
 * mode 'deduped'   - over budget; repeated identical rows were dropped. Every distinct row is still there, so a
 *                    "not present" claim remains sound.
 * mode 'narrowed'  - still over budget; only label columns A-E of sheets that have formulas (sheets with no formulas
 *                    stay whole). Partial view.
 * mode 'truncated' - still over budget; the budget is shared fairly across sheets and the rest is cut. Partial view.
 */
function buildTextIndex(workbook, { maxChars = TEXT_INDEX_MAX_CHARS } = {}) {
  const sheets = [];
  workbook.eachSheet(ws => sheets.push(ws));
  const hasFormula = ws => { let f = false; ws.eachRow({ includeEmpty: false }, r => { if (f) return; r.eachCell({ includeEmpty: false }, c => { if (c.formula) f = true; }); }); return f; };
  const size = built => built.reduce((n, b) => n + b.lines.reduce((m, l) => m + l.length + 1, 0), 0);
  const build = (narrow, dedupe) => sheets.map(ws => {
    const lines = sheetTextLines(ws, narrow && hasFormula(ws) ? NARROW_MAX_COL : 0);
    return { name: ws.name, lines: dedupe ? dedupeLines(lines) : lines };
  });

  let mode = 'full';
  let built = build(false, false);
  let truncatedSheets = [];
  if (size(built) > maxChars) { mode = 'deduped'; built = build(false, true); }
  if (size(built) > maxChars) { mode = 'narrowed'; built = build(true, true); }
  if (size(built) > maxChars) {
    mode = 'truncated';
    const fs_ = fairShare(built, maxChars);
    built = fs_.built; truncatedSheets = fs_.truncatedSheets;
  }
  const bySheet = {};
  for (const b of built) if (b.lines.length) bySheet[b.name] = b.lines.join('\n');
  return { bySheet, mode, chars: size(built), truncatedSheets };
}

function buildNamedRangeMap(workbook) {
  let model = [];
  try { model = (workbook.definedNames && workbook.definedNames.model) || []; } catch (_) { model = []; }
  const names = [];
  for (const d of model) {
    if (!d || !d.name || /^_xlnm\./.test(d.name)) continue;                // print areas etc. are not model names
    const ref = (Array.isArray(d.ranges) ? d.ranges.join(',') : String(d.ranges || '')).slice(0, NAMED_RANGE_REF_MAX);
    names.push({ name: d.name, refersTo: ref });
  }
  return { names: names.slice(0, NAMED_RANGE_MAX), total: names.length, truncated: names.length > NAMED_RANGE_MAX };
}

/**
 * The full-parse payload (formula list per sheet) plus the static text of each sheet, and the facts needed to say
 * honestly how much of the workbook the reviewer was given.
 * @returns {{ payload: Object, textIndex: Object, namedRanges: Object, coverage: 'complete_workbook'|'partial_view' }}
 */
function buildFullParsePayloadWithText(workbook, opts = {}) {
  const formulas = buildFullParseFormulaPayload(workbook);
  const textIndex = buildTextIndex(workbook, opts);
  const namedRanges = buildNamedRangeMap(workbook);
  const payload = {};
  const names = new Set([...Object.keys(formulas), ...Object.keys(textIndex.bySheet)]);
  workbook.eachSheet(ws => {                                              // keep workbook sheet order
    if (!names.has(ws.name)) return;
    const parts = [];
    if (formulas[ws.name]) parts.push(formulas[ws.name]);
    if (textIndex.bySheet[ws.name]) parts.push('# STATIC TEXT CELLS (labels, headings, notes; not formulas):\n' + textIndex.bySheet[ws.name]);
    payload[ws.name] = parts.join('\n\n');
  });
  return { payload, textIndex, namedRanges, coverage: fullParseCoverage(textIndex, namedRanges) };
}

// "complete_workbook" means: every formula, every static text cell and every named range reached the reviewer.
// Numeric constants and computed values are not part of it; absence rules never depend on them.
function fullParseCoverage(textIndex, namedRanges) {
  return textIndex && (textIndex.mode === 'full' || textIndex.mode === 'deduped') && !(namedRanges && namedRanges.truncated) ? 'complete_workbook' : 'partial_view';
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

This run is small enough to fit the whole workbook's logic and wording. For every sheet you get:
  1. "CellAddress: =formula" lines for every formula cell, exactly as the formula reads in the workbook; and
  2. a "# STATIC TEXT CELLS" section, one line per row ("R12: A=Receivables | D=Notes"), holding every plain
     text cell: row labels, headings, the cover note, change log, instructions and source references.
The payload also carries namedRangeMap (each name and what it refers to). Numeric constants and calculated values
are not included, except where a number is written inside a formula.

State review_mode as "llm_full_parse" for every finding in this run — not
llm_only or llm_with_partial_formulas, since both of those describe curated-
data modes this run is not using.

This means you can directly verify formula LOGIC, not just plausibility of
displayed values — trace whether a labelled output genuinely computes what its
label claims (e.g. confirm an "NPV" cell's formula actually discounts a cash
flow series, rather than referencing an unrelated value), follow a chain of
references across cells and sheets, and catch a defect that would be
completely invisible from a value alone. Use the static text to read row labels, find where a
schedule, register or documentation sits, and check that a label matches what its formula does.
Resolve a named range through namedRangeMap before saying its definition is not visible.

Do not assume any curation or pre-filtering has already happened. If dataCoverage is "complete_workbook",
a formula or text cell that is absent from a sheet's list is genuinely not there. If it is "partial_view", the
text section or the name list was cut to fit; say what you could not see rather than treating it as absent.
`.trim();

module.exports = { buildSheetFormulaList, buildFullParseFormulaPayload, buildFullParsePayloadWithText, buildTextIndex, buildNamedRangeMap, fullParseCoverage, FULL_PARSE_PROMPT_ADDENDUM, TEXT_INDEX_MAX_CHARS };
