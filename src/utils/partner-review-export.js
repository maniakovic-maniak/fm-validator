const fs = require('fs');
const path = require('path');
const { parseExcel } = require('../parser');

// Matches this project's own already-confirmed formula-token ratio
// (found via real production data earlier this project's history),
// not a generic assumption.
const CHARS_PER_TOKEN = 1.15;

/**
 * Builds one "CellAddress: content" line for a single cell - a formula
 * cell (unwrapping the array-formula object shape already proven
 * throughout this codebase), OR a plain-text/string cell. This is the
 * one, real extension over fm-validator's own existing
 * buildSheetFormulaList() (validator-tier2-fullparse.js): that function
 * only ever captures formula cells, which would have completely missed
 * the real TaxTrigger!C12 case - a plain-text instruction cell
 * mentioning a stale named-range name, not a formula at all.
 */
function buildCellLine(cell) {
  const raw = cell.formula;
  if (raw) {
    const formula = typeof raw === 'object' ? raw.formula : raw;
    if (formula) return `${cell.address}: =${formula}`;
    return null;
  }
  if (typeof cell.value === 'string' && cell.value.trim()) {
    return `${cell.address}: ${cell.value}`;
  }
  return null;
}

/**
 * Builds the full, per-sheet export - every sheet name mapped to its
 * complete list of formula and plain-text-cell lines. Named ranges are
 * included separately, in full, regardless of batching - they're small
 * in volume but structurally important (this is exactly the data that
 * let Phase A catch the real, planted named-range defect in testing).
 */
async function buildFullExport(filePath) {
  const parsed = await parseExcel(filePath);
  const wb = parsed._raw;
  const sheets = {};

  wb.eachSheet((ws) => {
    const lines = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const line = buildCellLine(cell);
        if (line) lines.push(line);
      });
    });
    if (lines.length > 0) sheets[ws.name] = lines;
  });

  const namedRanges = (parsed._raw.definedNames && parsed._raw.definedNames.model) || [];

  return { originalName: path.basename(filePath), modelType: null, sheets, namedRanges };
}

/**
 * Splits a full export into token-budget-respecting batches. Sheets are
 * kept whole within a single batch wherever possible - a sheet's own
 * internal cross-references are exactly the kind of thing worth being
 * able to reason about together, so splitting a sheet mid-way is a real
 * last resort, only when a single sheet alone exceeds the whole budget.
 */
function batchExport(fullExport, maxTokensPerBatch = 180000) {
  const batches = [];
  let current = {};
  let currentChars = 0;
  const maxChars = maxTokensPerBatch * CHARS_PER_TOKEN;

  for (const [sheetName, lines] of Object.entries(fullExport.sheets)) {
    const sheetText = lines.join('\n');
    const sheetChars = sheetText.length;

    if (sheetChars > maxChars) {
      // A single sheet alone exceeds the budget (FinancialStatements and
      // NonCore both do, on the real RIIO model) - split its own lines
      // across multiple batches, since there's no smaller unit to keep
      // whole here.
      if (Object.keys(current).length > 0) { batches.push(current); current = {}; currentChars = 0; }
      let chunkLines = [];
      let chunkChars = 0;
      let chunkIndex = 1;
      for (const line of lines) {
        if (chunkChars + line.length + 1 > maxChars && chunkLines.length > 0) {
          batches.push({ [`${sheetName} (part ${chunkIndex})`]: chunkLines.join('\n') });
          chunkIndex++;
          chunkLines = [];
          chunkChars = 0;
        }
        chunkLines.push(line);
        chunkChars += line.length + 1;
      }
      if (chunkLines.length > 0) batches.push({ [`${sheetName} (part ${chunkIndex})`]: chunkLines.join('\n') });
      continue;
    }

    if (currentChars + sheetChars > maxChars && Object.keys(current).length > 0) {
      batches.push(current);
      current = {};
      currentChars = 0;
    }
    current[sheetName] = sheetText;
    currentChars += sheetChars;
  }
  if (Object.keys(current).length > 0) batches.push(current);

  return batches;
}

module.exports = { buildFullExport, batchExport, buildCellLine };
