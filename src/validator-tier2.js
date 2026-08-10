const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const checklist = require('../config/checklist.json');
const { resolveAny } = require('./utils/sheet-resolver');
const { extractJson } = require('./utils/json-extract');
const { dumpFailedResponse } = require('./utils/dump-failed-response');
const { normalizeFormula: normalizeFormulaShape, colToNum } = require('./utils/formula-pattern-consistency-check');

const client = new Anthropic();

// Load soul and universal skill — always loaded once at startup, never change
const soulPath  = path.join(__dirname, '../config/soul.md');
const skillPath = path.join(__dirname, '../config/skill.md');
// Read per-call, not at module load — a long-running dev server otherwise
// silently keeps stale prompts after config/soul.md or skill.md change on disk.
function SOUL()  { return fs.existsSync(soulPath)  ? fs.readFileSync(soulPath, 'utf8')  : ''; }
function SKILL() { return fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : ''; }

// No module-level mutable state — domain and modelContext passed per request
// Returns static (cacheable) and dynamic (per-model) prompt parts separately.
// Static: soul + skill + domain — same across calls for the same model type.
// Dynamic: model context — changes per uploaded file.
function buildSystemPrompt(domain, modelContext) {
  const staticParts = [SOUL(), SKILL(), domain].filter(Boolean);
  const staticPrompt = staticParts.join('\n\n---\n\n');
  return { staticPrompt, dynamicPrompt: modelContext || '' };
}

// FIX: found via investigating a real forensic audit review that
// identified a severe, confirmed defect (cash hard-coded to zero on a
// balance sheet) that Tier 2 completely missed. Traced the root cause
// directly: the old "first maxRows numeric rows from the top" logic
// silently dropped the exact rows needed to catch it — row 33 ("Cash",
// hard-coded to 0), row 51 (an intermediate cash-reconciliation
// check), and row 81 (the real closing cash balance) never survived
// the cap, while row 52 ("TOTAL CHECK" ≈ 0, which looks completely
// fine in isolation with no visibility into what feeds it) did. This
// was not a reasoning failure — Tier 2 genuinely never saw the data
// needed. Fixed by always prioritizing rows whose own label matches
// key balance-integrity terms (cash, check, balance, total, equity,
// reconcil-) before falling back to positional selection for the
// remaining slots, so a label match can never be silently dropped
// purely due to where it happens to sit in the sheet.
// FIX: found via systematically checking all 13 confirmed-defect
// claims from a forensic audit review against a fresh production run.
// Several genuine anomalies the model has (a $437m gap between two
// valuation methods, a sign-flipped NPV vs XNPV, a negative DSCR
// period, a negative debt yield period) were still not surfacing as
// Tier 2 findings even after the earlier row-selection fix — traced
// precisely: on VALUATIONS (134 total rows), "Completed property
// value" (row 8) was dropped by the cap while "Property DCF value"
// (row 12) survived, and "Project NPV" (row 44) was dropped while
// "Project XNPV" (row 45) survived — meaning Tier 2 could only ever
// see HALF of a comparison it needed both numbers for, on both counts.
// Same pattern confirmed on DEBT (176 rows: periodic "Debt yield" row
// dropped) and INVESTOR ANALYTICS (95 rows: DSCR summary and periodic
// rows both dropped). The existing priority mechanism only covered
// balance-sheet-integrity terms (cash/check/balance/total/equity) —
// extended to cover the key return, covenant, and valuation-comparison
// metrics an audit review specifically needs to see both sides of.
const PRIORITY_LABEL_RE_HIGH = /\b(dscr|llcr|covenant|yield|npv|irr|xnpv|property value|dcf value)\b/i;
const PRIORITY_LABEL_RE_LOW = /\b(cash|check|balance|total|equity|reconcil\w*)\b/i;

function rowMatchesPriority(row, re) {
  // Checks every string value in the row, not just the first — a row
  // can carry multiple, entirely unrelated label/value pairs packed
  // side-by-side (e.g. "Line fee" in columns A-B, "Debt yield" in
  // columns J-K, both on the same physical row), and checking only
  // the first string silently misses every other label sharing that row.
  for (const v of Object.values(row)) {
    if (typeof v === 'string' && v.trim() !== '' && isNaN(parseFloat(v)) && re.test(v)) return true;
  }
  return false;
}

function extractMeaningfulRows(rows, maxRows = 20) {
  if (!rows || rows.length === 0) return [];

  const meaningful = rows.filter(row => {
    const vals = Object.values(row);
    return vals.some(v => v !== null && v !== '' && v !== undefined);
  });

  const numeric = meaningful.filter(row =>
    Object.values(row).some(v => v !== null && !isNaN(parseFloat(v)))
  );

  const nonNumeric = meaningful.filter(row =>
    !Object.values(row).some(v => v !== null && !isNaN(parseFloat(v)))
  );

  // FIX: found via checking a real 176-row sheet (DEBT) directly — a
  // single-tier priority cap still failed to surface a genuinely
  // important row. 75 rows on that sheet matched the combined priority
  // terms, but only 12 matched the rare, specific return/covenant
  // terms (dscr/yield/npv/irr/etc) — the other 63 matched only common
  // balance-sheet-integrity terms (cash/total/balance/equity), whose
  // sheer volume crowded out the rarer, more diagnostically important
  // rows under one shared cap. The periodic "Debt yield" row (a real,
  // confirmed negative value in one period) was the 48th match among
  // 75 combined candidates — nowhere close to surviving any single cap
  // sized for a 20-40 row budget. Splitting into two tiers — a
  // generous reservation for the rare HIGH-value terms first, then a
  // smaller reservation for the more common LOW-value terms with
  // whatever room remains — is what actually fixes this, since 12
  // rows fit easily in a generous reservation where 75 combined did not.
  const highCap = Math.max(1, maxRows - 2);
  const highPriority = [];
  const highKeys = new Set();
  for (const row of numeric) {
    if (highPriority.length >= highCap) break;
    if (rowMatchesPriority(row, PRIORITY_LABEL_RE_HIGH)) {
      highPriority.push(row);
      highKeys.add(row);
    }
  }

  const remainingAfterHigh = numeric.filter(row => !highKeys.has(row));
  const lowCap = Math.max(1, Math.floor((maxRows - highPriority.length) / 2));
  const priority = [...highPriority];
  const priorityKeys = new Set(highKeys);
  for (const row of remainingAfterHigh) {
    if (priority.length >= highPriority.length + lowCap) break;
    if (rowMatchesPriority(row, PRIORITY_LABEL_RE_LOW)) {
      priority.push(row);
      priorityKeys.add(row);
    }
  }
  const remainingNumeric = numeric.filter(row => !priorityKeys.has(row));

  // FIX: found via verifying a real claim in a forensic audit review —
  // a model's own "MODEL STATUS: REVIEW REQUIRED" self-flag lives in a
  // non-numeric row (a row of pure text/status labels, no parseable
  // number anywhere in it). The old composition put numeric rows
  // first, then non-numeric rows, then applied a flat .slice(0,
  // maxRows) at the end — so if numeric rows alone reached maxRows
  // (routine on any sheet with 20+ rows of figures), non-numeric rows
  // got ZERO room, no matter how important their content. Confirmed
  // directly: all 20 survivors on a real sheet were numeric: none was
  // the status row, even though it sat early in the sheet. Reserves
  // guaranteed space for non-numeric rows up front, so a genuine
  // status/label row can never be silently crowded out entirely by
  // however many numeric rows a sheet happens to have.
  const nonNumericReserved = nonNumeric.slice(0, 5);
  const numericSlots = Math.max(0, maxRows - nonNumericReserved.length);
  const numericSelected = [...priority, ...remainingNumeric.slice(0, Math.max(0, numericSlots - priority.length))];

  const selected = [...numericSelected, ...nonNumericReserved].slice(0, maxRows);

  // R-8 fix: formula text is only attached to rows ALREADY judged
  // most likely to matter — the priority covenant/return rows and the
  // reserved non-numeric status rows — not every selected row. This
  // targets the token cost at exactly the class of row where a
  // values-only review has been confirmed to miss real defects (a
  // degenerate covenant branch, a backward-solved equity plug), while
  // ordinary numeric fill rows stay value-only.
  const formulaEligible = new Set([...priority, ...nonNumericReserved]);

  return selected.map(row => {
    const keys = Object.keys(row);
    // Capture cell address info before trimming — _cellRefs and _rowNum
    // are non-enumerable so they survive Object.keys() exclusion naturally,
    // but we read them explicitly here since the trimmed object below is
    // a fresh literal and won't inherit them.
    const cellRefs = row._cellRefs || {};
    const rowNum   = row._rowNum;
    // Use the cell ref of the first column with a value as a row anchor —
    // gives Claude a concrete starting cell reference for this row even
    // when only a subset of columns are shown.
    // Prefer a numeric-value column as the anchor — period calculation cells
    // (columns J onwards) are more meaningful than row label cells (column C).
    // Falling back to any cell with a ref if no numeric column exists.
    const firstNumericKeyWithRef = keys.find(k => {
      const v = row[k];
      return cellRefs[k] && v !== null && v !== undefined && v !== '' && !isNaN(parseFloat(v));
    });
    const firstKeyWithRef = firstNumericKeyWithRef || keys.find(k => cellRefs[k]);
    const rowAnchorCell   = firstKeyWithRef ? cellRefs[firstKeyWithRef] : null;

    let resultRow;
    if (keys.length <= 12) {
      resultRow = { ...row };
    } else {
      const firstSix = keys.slice(0, 6);
      const lastSix  = keys.slice(-6);
      const combined = [...new Set([...firstSix, ...lastSix])];
      resultRow = {};
      combined.forEach(k => { resultRow[k] = row[k]; });
    }

    // Attach cell reference metadata as a visible field so Claude can cite
    // real cell addresses. Kept compact — only the row anchor cell and row
    // number, not a full per-column map, to control token cost.
    if (rowAnchorCell) {
      resultRow._cellRef = rowAnchorCell;
    }
    if (rowNum) {
      resultRow._excelRow = rowNum;
    }

    // R-8 fix: attach up to 2 distinct formula-SHAPE samples (not one per
    // column) for formula-eligible rows, so Tier 2 can reason about
    // actual formula logic, not just displayed values — the gap
    // confirmed to structurally block it from catching defects like a
    // degenerate covenant branch or a backward-solved equity plug.
    // Groups by normalized (relative-offset) template so period
    // columns sharing the same underlying formula shape collapse to
    // one sample rather than repeating near-identical text per column;
    // a genuine mid-row shape difference still surfaces a second,
    // distinct sample.
    if (formulaEligible.has(row) && row._formulas) {
      const shapesSeen = new Map(); // template -> {cellRef, formula}
      for (const k of Object.keys(resultRow)) {
        if (k.startsWith('_')) continue;
        const formula = row._formulas[k];
        if (!formula) continue;
        const cellRef = cellRefs[k];
        const colMatch = cellRef && /^([A-Z]+)(\d+)$/.exec(cellRef);
        const colNum = colMatch ? colToNum(colMatch[1]) : 0;
        const template = normalizeFormulaShape(formula, rowNum || 0, colNum);
        if (!shapesSeen.has(template)) shapesSeen.set(template, { cellRef, formula });
        if (shapesSeen.size >= 2) break;
      }
      if (shapesSeen.size > 0) {
        resultRow._formulaSamples = [...shapesSeen.values()].map(s =>
          `${s.cellRef}: ${s.formula.length > 300 ? s.formula.slice(0, 300) + '…' : s.formula}`
        );
      }
    }

    return resultRow;
  });
}

// Parse Claude response — handles object {results:[...]} or raw array
function parseResponse(raw) {
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return { results: parsed, meta: {} };
    if (parsed && Array.isArray(parsed.results)) {
      const { results, ...meta } = parsed;
      return { results, meta };
    }
  } catch (e1) {
    // Try extracting results array directly
    const arrStart = cleaned.indexOf('"results"');
    if (arrStart !== -1) {
      const bracketStart = cleaned.indexOf('[', arrStart);
      const bracketEnd   = cleaned.lastIndexOf(']');
      if (bracketStart !== -1 && bracketEnd !== -1) {
        try {
          return { results: JSON.parse(cleaned.substring(bracketStart, bracketEnd + 1)), meta: {} };
        } catch (e2) {}
      }
    }
    // Try raw array
    const arrS = cleaned.indexOf('[');
    const arrE = cleaned.lastIndexOf(']');
    if (arrS !== -1 && arrE !== -1) {
      try {
        return { results: JSON.parse(cleaned.substring(arrS, arrE + 1)), meta: {} };
      } catch (e3) {}
    }
  }
  throw new Error(`Could not parse Tier 2 response (length: ${cleaned.length}, tail: ${cleaned.slice(-80)})`);
}

// Run a single batch of rules via streaming
async function runBatch(batchRules, dataSubset, sheetNames, systemPrompt, batchLabel, tier0Context = {}) {
  const payload = {
    sheetNames,
    rules: batchRules,
    data: dataSubset,
    workbookStats: tier0Context.stats || {},
    riskSummary: tier0Context.risks || {},
    // Wave 1 (named-range audit) and Wave 2 (VBA/macro review) both run
    // deterministically before Tier 2 and already answer several test
    // questions skill.md's own test instructions previously described as
    // permanently unanswerable from Mode A data (no_circular_references,
    // calculation_settings, macros_documented, named_ranges_current,
    // no_hardcodes) — this data existed but was never threaded into the
    // Tier 2 payload. Kept deliberately compact (counts and names, not
    // full finding objects) to stay within the conciseness budget the
    // rest of this payload already follows.
    namedRangeSummary: tier0Context.namedRangeSummary || null,
    vbaSummary: tier0Context.vbaSummary || null
  };

  const estimatedTokens = Math.round(JSON.stringify(payload).length / 3);
  console.log(`   ${batchLabel}: ~${estimatedTokens} tokens input, ${batchRules.length} rules`);

  let rawText = '';
  const stream = await client.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 128000,   // Sonnet 5 ceiling on the synchronous Messages API.
                           // Was 64000, sized for the pre-Sonnet-5 tokenizer;
                           // the new tokenizer produces ~30% more tokens for
                           // the same output, which was silently truncating
                           // dense/numeric batches like Accounting & Debt.
    system: [
      {
        type: 'text',
        text: systemPrompt.staticPrompt,
        cache_control: { type: 'ephemeral' }
      },
      ...(systemPrompt.dynamicPrompt ? [{
        type: 'text',
        text: systemPrompt.dynamicPrompt
      }] : []),
    ],
    messages: [{ role: 'user', content: JSON.stringify(payload) }]
  });

  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta && chunk.delta.type === 'text_delta') {
      rawText += chunk.delta.text;
    }
  }

  const finalMessage = await stream.finalMessage();
  const stopReason = finalMessage.stop_reason;
  const outputTokens = finalMessage.usage ? finalMessage.usage.output_tokens : null;

  console.log(`   ${batchLabel}: ${rawText.length} chars received` +
    (outputTokens ? ` (${outputTokens} output tokens, stop: ${stopReason})` : ''));

  if (stopReason === 'max_tokens') {
    console.log(`   \u26a0\ufe0f  ${batchLabel} hit the max_tokens ceiling \u2014 response was truncated, not malformed. Split the batch or raise max_tokens further.`);
  }

  try {
    return parseResponse(rawText);
  } catch (err) {
    dumpFailedResponse(batchLabel.replace(/[^a-zA-Z0-9]+/g, '_'), rawText, err);
    if (stopReason === 'max_tokens') {
      throw new Error(`${batchLabel} response truncated at ${outputTokens} output tokens (max_tokens ceiling reached) \u2014 not a parse error. Reduce batch size or raise max_tokens.`);
    }
    throw err;
  }
}

// Split tier2 rules into batches by section
function splitIntoBatches(rules) {
  // Batch 1 — Structure, inputs, formula mechanics
  const batch1Sections = ['S1', 'S2', 'S3', 'S4'];
  // Batch 2 — Accounting, debt, revenue, tax — the deep financial review batch
  // Gets full untrimmed financial statement data (see runTier2)
  const batch2Sections = ['S5', 'S6', 'S7', 'S10'];
  // Batch 3 — Scenarios, audit/governance, actuals, commercial completeness, governance
  const batch3Sections = ['S8', 'S9', 'S11', 'S12', 'S13'];

  const batch1 = rules.filter(r => batch1Sections.some(s => r.id.includes(`-${s}-`)));
  const batch2 = rules.filter(r => batch2Sections.some(s => r.id.includes(`-${s}-`)));
  const batch3 = rules.filter(r => batch3Sections.some(s => r.id.includes(`-${s}-`)));

  // Any rules not matched go to batch1
  const matched = new Set([...batch1.map(r => r.id), ...batch2.map(r => r.id), ...batch3.map(r => r.id)]);
  const unmatched = rules.filter(r => !matched.has(r.id));
  batch1.push(...unmatched);

  return { batch1, batch2, batch3 };
}

// Category/alias definitions for the deep-accounting data subset, plus a
// standalone resolver function — kept at module level (not inside
// runTier2) so index.js/server.js can call this same resolution
// independently (cheap, no LLM calls involved) to get the REAL resolved
// sheet names for the report's "Evidence Reviewed" text, without needing
// runTier2 itself to change its existing return shape (a plain array of
// findings, not an object — changing that would be a breaking change for
// every existing caller).
//
// Each category is a list of aliases, tried in order via resolveAny() —
// safer, fuller-word aliases first, short accounting abbreviations last.
// A short abbreviation like 'Cons' is unsafe as a sole target: confirmed
// on a real production file, 'Cons' silently matched an unrelated sheet
// named 'Construction Timeline', feeding a construction schedule into
// the accounting batch in place of a real cash flow statement, while the
// genuine Balance Sheet/P&L/Cashflow sheets were never matched at all.
const DEEP_ACCOUNTING_CATEGORIES = {
  // FIX (found via a real run on a property/development equity model —
  // "The Bend / David Gifford"): all 6 categories below failed to
  // resolve against real sheets named SOURCES & USES, CAP TABLE,
  // OPERATING, DEVELOPMENT CF — none of which matched any existing
  // alias. Consequence, confirmed directly: roughly a quarter of that
  // run's 139 findings were Tier 2 reporting "no [X] rows visible for
  // this test" rather than genuine findings, because Batch 2/3 had
  // almost no real sheet data to work with. The additions below are
  // durable, archetype-level aliases (a property/development model's
  // own common naming conventions), not overfit to this one file's
  // literal sheet names — though this file's exact names are included
  // too, since they cost nothing and directly fix the observed gap.
  // FIX: "Cons" removed — found via investigating a real run to be a
  // genuinely still-active false-positive risk, not a previously-fixed
  // one. resolveSheetName's word-boundary-aware matching (see
  // sheet-resolver.js) now protects against this class of bug in
  // general, but this specific alias is also too short and generic to
  // keep regardless — it would match "Consolidation", "Considerations",
  // or any other sheet merely starting with those four letters.
  //
  // FIX: "Financial Statements" added as an alias for all three
  // statement types below — found via the same real run, a genuine gap
  // rather than a matching bug. A model with a single combined
  // "Financial Statements" sheet (rather than separate Balance Sheet /
  // Income Statement / Equity tabs) is common, legitimate structure,
  // and had no alias anywhere in this list before.
  // FIX: found via a fresh production run — "Cap Table" and
  // "Operating" (both genuinely needed for other real models) now
  // match newly-added sheets in a later revision of this same model
  // ("FUNDING & CAP TABLE", "OPERATING MODEL") via the word-boundary
  // matching fix in sheet-resolver.js, and since resolveAny returns
  // whichever alias matches first in array order, these more generic,
  // ambiguous terms were winning over the far more direct and reliable
  // "Financial Statements" match. Confirmed directly: this caused
  // Batch 2 to analyze the wrong sheet entirely for Balance Sheet,
  // Income Statement, and Equity — missing the real cash/balance-sheet
  // defect data that "Financial Statements" actually contains.
  // Reordered so the most direct, unambiguous term is always tried
  // first; generic fallback terms are moved to the end, where they
  // only apply when nothing more specific exists at all.
  'Balance Sheet':      ['Financial Statements', 'Balance Sheet', 'Statement of Financial Position', 'SOFP', 'AFS', 'BS', 'Sources & Uses', 'Sources and Uses', 'Cap Table'],
  'Income Statement':   ['Financial Statements', 'Profit and Loss', 'Profit & Loss', 'P&L', 'Income Statement', 'IFS', 'PnL', 'Operating'],
  'Cash Flow':          ['Cash Flow Statement', 'Cash Flow', 'Cashflow', 'CFS', 'Development CF', 'Development Cash Flow'],
  'Debt':               ['Debt Schedule', 'Debt Dashboard', 'Debt'],
  'Equity':             ['Financial Statements', 'Equity Schedule', 'Equity Dashboard', 'Equity', 'Cap Table', 'Investors'],
  // FIX: found via investigating a real, confirmed gap on
  // Financial_Model_The_Bend_13_7_2026_Audited.xlsx — this model has no
  // dedicated Depreciation/Tax or Lease schedule sheet, but genuinely
  // contains both: confirmed directly, P&L!C84 has "Depreciation",
  // Balance Sheet!D21 has "Accumulated depreciation", and P&L!C44-C59
  // has multiple real lease line items ("Annual Venue Lease", "Lease
  // deposit", "Leased equipment"). Same archetype-level pattern as the
  // "Financial Statements" fix above — a model consolidating a
  // category's data into the P&L/income-statement sheet rather than a
  // separate schedule. Added as fallback aliases, after the dedicated-
  // schedule terms, so a genuine dedicated schedule (when one exists)
  // still wins the match — matching the established ordering
  // discipline documented above for exactly this reason.
  'Depreciation & Tax': ['Depreciation and Tax', 'Depreciation & Tax', 'Tax Schedule', 'D&T', 'Financial Statements', 'P&L', 'Profit and Loss'],
  'Leases':             ['Lease Schedule', 'Leases', 'Lease', 'Financial Statements', 'P&L', 'Profit and Loss'],
};

/**
 * Resolve the deep-accounting categories against a workbook's real sheet
 * names. Returns which real sheet name was matched for each category (or
 * absent if none), plus the list of categories that didn't resolve at
 * all — this is the real data the "Evidence Reviewed" column should
 * describe, replacing a static string in build_report.py that always
 * said "AFS/IFS/Cons/Debt/Equity/D&T/Leases" regardless of what sheets
 * were actually used for a given run.
 */
function resolveDeepAccountingSheets(sheetNames) {
  const resolvedMap = {};
  const unresolvedCategories = [];
  for (const [category, aliases] of Object.entries(DEEP_ACCOUNTING_CATEGORIES)) {
    const resolved = resolveAny(aliases, sheetNames);
    if (resolved) {
      resolvedMap[category] = resolved;
    } else {
      unresolvedCategories.push(category);
    }
  }
  return { resolvedMap, unresolvedCategories };
}

async function runTier2(parsed, { domain = '', modelContext = '', keySheets = null, tier0Stats = null, tier0Risks = null, namedRangeAudit = null, vbaReview = null } = {}) {
  // Fallback key-sheet categories used when the caller doesn't supply
  // keySheets (normally Familiarisation-derived) — e.g. when Familiarisation
  // itself failed to complete for this run. A flat, mining-style
  // abbreviation list matched via raw exact-key lookup (parsed.sheets[name])
  // with NO fuzzy resolution at all silently matches almost nothing on a
  // non-mining model — confirmed on a real production file where only
  // 'Inputs' and 'Debt' resolved out of seven targets.
  const KEY_SHEET_CATEGORIES = {
    // FIX: "Cons" removed here too — this is a second, separate alias
    // list that had drifted out of sync with the same fix applied to
    // DEEP_ACCOUNTING_CATEGORIES above, found via investigating a real
    // run. "Financial Statements" added to the two statement
    // categories below for the same reason as above — a real model
    // with one combined sheet, not split by statement type.
    //
    // FIX: found via a fresh production run on a later revision of the
    // same model — "Cap Table" and "Operating" now match newly-added
    // sheets ("FUNDING & CAP TABLE", "OPERATING MODEL") via the
    // word-boundary matching fix, winning over the far more direct
    // "Financial Statements" match purely by array order. Reordered so
    // the most direct term is tried first — see DEEP_ACCOUNTING_CATEGORIES
    // above for the full explanation.
    'Cash Flow':        ['Cash Flow Statement', 'Cash Flow', 'Cashflow', 'CFS', 'Development CF', 'Development Cash Flow'],
    'Income Statement': ['Financial Statements', 'Profit and Loss', 'Profit & Loss', 'P&L', 'Income Statement', 'IFS', 'PnL', 'Operating'],
    'Balance Sheet':    ['Financial Statements', 'Balance Sheet', 'Statement of Financial Position', 'AFS', 'SOFP', 'BS', 'Sources & Uses', 'Sources and Uses', 'Cap Table'],
    'Inputs':           ['Inputs', 'Assumptions', 'Key Inputs'],
    'Debt':             ['Debt Schedule', 'Debt Dashboard', 'Debt'],
    'Operations':       ['Operations', 'Ops', 'Operating Assumptions'],
    'Equity':           ['Financial Statements', 'Equity Schedule', 'Equity Dashboard', 'Equity', 'Cap Table', 'Investors'],
  };

  let sheetsToCheck;
  if (keySheets && keySheets.length > 0) {
    sheetsToCheck = keySheets;
  } else {
    sheetsToCheck = [];
    const unresolvedKeyCategories = [];
    for (const [category, aliases] of Object.entries(KEY_SHEET_CATEGORIES)) {
      const resolved = resolveAny(aliases, parsed.sheetNames);
      if (resolved) sheetsToCheck.push(resolved);
      else unresolvedKeyCategories.push(category);
    }
    if (unresolvedKeyCategories.length > 0) {
      console.log(`   ⚠️  Key-sheet fallback (Batches 1 & 3): no matching sheet for ${unresolvedKeyCategories.length} categor${unresolvedKeyCategories.length === 1 ? 'y' : 'ies'} — ${unresolvedKeyCategories.join(', ')}. This normally means Familiarisation did not supply keySheets for this run — check for an earlier Familiarisation error above.`);
    }
  }

  const dataSubset = {};
  for (const name of sheetsToCheck) {
    if (parsed.sheets[name]) {
      dataSubset[name] = extractMeaningfulRows(parsed.sheets[name]);
    }
  }

  // Trim if too large
  const totalTokens = Math.round(JSON.stringify(dataSubset).length / 3);
  if (totalTokens > 40000) {
    console.log('   Trimming sheet data to 10 rows per sheet...');
    for (const name of Object.keys(dataSubset)) {
      dataSubset[name] = dataSubset[name].slice(0, 10);
    }
  }

  // ── Deep accounting data subset for Batch 2 (B5) ──────────────────────────
  // The accounting/debt/tax batch needs full, untrimmed financial statement
  // data — not the generic key_sheets sample. This gives Claude enough
  // evidence to actually test balance sheet roll-forwards, debt schedules,
  // and tax reconciliation rather than returning uncertain due to thin data.
  // Uses the module-level resolveDeepAccountingSheets() (defined above,
  // before this function) so index.js/server.js can call the exact same
  // resolution independently to get real sheet names for the report.
  const { resolvedMap, unresolvedCategories } = resolveDeepAccountingSheets(parsed.sheetNames);
  const deepDataSubset = {};
  for (const [category, sheetName] of Object.entries(resolvedMap)) {
    if (parsed.sheets[sheetName]) {
      // Use a higher row cap (40) and wider extraction for the deep batch
      deepDataSubset[sheetName] = extractMeaningfulRows(parsed.sheets[sheetName], 40);
    }
  }
  if (unresolvedCategories.length > 0) {
    console.log(`   ⚠️  Deep accounting subset: no matching sheet found for ${unresolvedCategories.length} categor${unresolvedCategories.length === 1 ? 'y' : 'ies'} — ${unresolvedCategories.join(', ')}. Batch 2 will run without this data; expect "uncertain" results on checks that depend on it. If this workbook has an equivalent sheet under a different name, add it as an alias to DEEP_ACCOUNTING_CATEGORIES in validator-tier2.js.`);
  }
  const deepTokens = Math.round(JSON.stringify(deepDataSubset).length / 3);
  console.log(`   Deep accounting data subset: ~${deepTokens} tokens across ${Object.keys(deepDataSubset).length} sheets`);
  if (deepTokens > 70000) {
    console.log('   Trimming deep accounting data to 25 rows per sheet...');
    for (const name of Object.keys(deepDataSubset)) {
      deepDataSubset[name] = deepDataSubset[name].slice(0, 25);
    }
  }

  const systemPrompt = buildSystemPrompt(domain, modelContext);
  const { batch1, batch2, batch3 } = splitIntoBatches(checklist.tier2);
  const allResults = [];
  let topLevelMeta = {};

  // Compact Wave 1 (named-range audit) and Wave 2 (VBA review) summaries —
  // built once here, from data Wave 1/2 already computed deterministically
  // before Tier 2 runs, and threaded into every batch via tier0Context
  // below. See the payload comment in runBatch() for why this exists.
  const namedRangeSummaryForPrompt = (namedRangeAudit && namedRangeAudit.applicable) ? {
    totalNamedRanges: namedRangeAudit.totalNamedRanges,
    brokenCount: (namedRangeAudit.broken || []).length,
    brokenNames: (namedRangeAudit.broken || []).map(b => b.name),
    unusedCount: (namedRangeAudit.unused || []).length,
  } : { note: 'Named range audit did not complete for this run — treat named_ranges_current as manual_only.' };

  const vbaSummaryForPrompt = (vbaReview && vbaReview.applicable) ? {
    hasVbaProject: vbaReview.hasVbaProject,
    moduleCount: vbaReview.moduleCount || 0,
    findingSummary: (vbaReview.findings || []).map(f => `${f.id}: ${f.label}`),
  } : { note: 'VBA review did not complete for this run — treat macros_documented and any VBA-dependent test as manual_only.' };

  // Reusable batch runner with consistent error handling
  async function runOneBatch(rules, data, label, errorIdPrefix) {
    if (rules.length === 0) return;
    try {
      const { results, meta } = await runBatch(
        rules, data, parsed.sheetNames, systemPrompt, label,
        { stats: tier0Stats, risks: tier0Risks, namedRangeSummary: namedRangeSummaryForPrompt, vbaSummary: vbaSummaryForPrompt }
      );
      allResults.push(...results);
      if (meta && (meta.audit_completion_percent !== undefined || meta.open_p1_count !== undefined) &&
          topLevelMeta.audit_completion_percent === undefined) {
        topLevelMeta = meta;
      }
    } catch (e) {
      console.error(`   ❌ ${label} error:`, e.message);
      allResults.push({
        id: `${errorIdPrefix}-ERROR`, status: 'uncertain', confidence: 0,
        priority: 'P2',
        category: 'Governance', method: 'automated',
        reason: `${label} could not complete: ${e.message}`,
        sheet: 'N/A', cell: 'A1', fixable: false,
        fix_instruction: 'Re-run the validation. If the error persists, reduce the model file size.',
        escalation_flag: false, needs_retest: false,
        condition: '', criteria: '', cause: '', consequence: '', corrective_action: '',
        periods_affected: [], dollar_impact: 'unquantified', root_cause: 'Validation error'
      });
    }
  }

  try {
    // FIX (Phase 0.1): confirmed no genuine cross-batch dependency — each
    // batch reads only from data computed once, before any batch runs
    // (dataSubset, deepDataSubset), and nothing in Batch 2 or 3 depends on
    // Batch 1's output. Converted from 3 sequential awaits to Promise.all
    // so wall-clock time drops to roughly the slowest single batch rather
    // than the sum of all three — this has consistently been the
    // dominant portion of total run time (1800-2200s range observed).
    await Promise.all([
      // ── Batch 1: Structure, Inputs, Formula mechanics (S1-S4) ──────────
      runOneBatch(batch1, dataSubset, 'Batch 1 — Structure (S1-S4)', 'T2-BATCH1'),

      // ── Batch 2: Accounting, Debt, Revenue, Tax (S5-S7,S10) — DEEP DATA ─
      // This is the B5 deep financial review batch. It receives full,
      // untrimmed AFS/IFS/Cons/Debt/Equity data so Claude has enough evidence
      // to test balance sheet roll-forwards, debt schedules, retained earnings,
      // and tax reconciliation with confidence rather than returning uncertain.
      runOneBatch(batch2, deepDataSubset, 'Batch 2 — Accounting & Debt (S5-S7,S10)', 'T2-BATCH2'),

      // ── Batch 3: Scenarios, Audit, Actuals, Commercial, Governance ──────
      runOneBatch(batch3, dataSubset, 'Batch 3 — Scenarios & Governance (S8-S9,S11-S13)', 'T2-BATCH3'),
    ]);

    // Normalise all results — ensure required fields exist
    const normalised = allResults.map(r => ({
      id:                       r.id || 'UNKNOWN',
      status:                   r.status || 'uncertain',
      confidence:               r.confidence ?? 0,
      priority:                 r.priority || 'P3',
      severity:                 r.severity || 'Medium',
      issue_type:               r.issue_type || '',
      workstream:               r.workstream || '',
      model_risk:               r.model_risk || '',
      key_output_impact:        r.key_output_impact || 'Unknown',
      category:                 r.category || 'Governance',
      method:                   r.method || 'automated',
      reason:                   r.reason || '',
      sheet:                    r.sheet || '',
      cell:                     r.cell && r.cell !== 'Unknown' ? r.cell : 'A1',
      periods_affected:         r.periods_affected || [],
      dollar_impact:            r.dollar_impact || 'unquantified',
      root_cause:               r.root_cause || '',
      condition:                r.condition || '',
      criteria:                 r.criteria || '',
      cause:                    r.cause || '',
      consequence:              r.consequence || '',
      corrective_action:        r.corrective_action || '',
      fixable:                  r.fixable ?? false,
      fix_instruction:          r.fix_instruction || r.corrective_action || '',
      escalation_flag:          r.escalation_flag ?? false,
      needs_retest:             r.needs_retest ?? false,
      // FIX: found via trying to directly confirm whether Tier 2
      // genuinely uses the R-8 formula-sample capability on a real
      // run — this field was being silently dropped here despite
      // skill.md instructing Claude to set it on every finding
      // (llm_only / llm_with_partial_formulas / etc.), since this
      // mapping lists fixed fields explicitly rather than spreading
      // r's own fields through. Without it, there was no way to
      // objectively verify R-8's usage — only indirect inference from
      // prose wording, which turned out to be unreliable (LLM prose
      // varies run to run regardless of what data it saw).
      review_mode:              r.review_mode || 'llm_only',
      // Top-level meta fields (from overall assessment)
      _meta: topLevelMeta
    }));

    // R-8 verification: log a direct, objective count of how many
    // findings this run actually used the new formula-sample
    // capability for, rather than leaving this to be inferred
    // indirectly from finding-text wording (confirmed unreliable).
    const reviewModeCounts = {};
    normalised.forEach(r => { reviewModeCounts[r.review_mode] = (reviewModeCounts[r.review_mode] || 0) + 1; });
    const modeSummary = Object.entries(reviewModeCounts).map(([mode, count]) => `${mode}: ${count}`).join(', ');
    console.log(`   Tier 2 review modes — ${modeSummary}`);

    // FIX (I-3): found via an independent review confirming 88 of 226
    // findings (39%) fell back to the "A1" cell placeholder, and 59
    // had a blank or invalid sheet name — far exceeding the "rare"
    // case the A1 escape hatch (soul.md) was written for, and making
    // over a third of the report unusable for navigating directly to
    // the evidence. Cannot auto-correct an invalid sheet (there's no
    // way to know the genuinely correct one after the fact), but logs
    // the frequency directly and objectively on every run — the same
    // "make it monitorable, not just inferable from prose" pattern
    // that made R-8's usage directly verifiable via review_mode above.
    const validSheetSet = new Set((parsed.sheetNames || []).map(s => s.toLowerCase()));
    const badLocationCount = normalised.filter(r =>
      r.cell === 'A1' || !r.sheet || !validSheetSet.has(String(r.sheet).toLowerCase())
    ).length;
    if (badLocationCount > 0) {
      const pct = Math.round(100 * badLocationCount / normalised.length);
      console.log(`   \u26a0\ufe0f  ${badLocationCount} of ${normalised.length} Tier 2 finding(s) (${pct}%) have an unusable location — cell defaulted to "A1", or sheet is blank/not a real sheet name in this workbook.`);
    }

    return normalised;

  } catch (e) {
    console.error('   ❌ Tier 2 fatal error:', e.message);
    return [{
      id: 'T2-ERROR', status: 'uncertain', confidence: 0,
      priority: 'P2',
      category: 'Governance', method: 'automated',
      reason: `Tier 2 validation could not complete: ${e.message}. Manual review required.`,
      sheet: 'N/A', cell: 'A1', fixable: false,
      fix_instruction: 'Tier 2 (Claude AI checks) did not complete. Re-run the validation or review the model manually.',
      escalation_flag: false, needs_retest: false,
      condition: '', criteria: '', cause: '', consequence: '', corrective_action: '',
      periods_affected: [], dollar_impact: 'unquantified', root_cause: 'Validation system error',
      _meta: {}
    }];
  }
}

module.exports = { runTier2, parseResponse, resolveDeepAccountingSheets, extractMeaningfulRows };
