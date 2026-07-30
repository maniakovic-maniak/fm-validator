// zero-base-rate-check.js
//
// Found via an independent review: DEBT!B12 (Construction base rate),
// B25 (Working-capital base rate), and B39 (Term-debt base rate) are
// all confirmed, genuinely zero — B39 is a literal "0" formula; B12
// and B25 resolve (through PROJECTS!AP87/AP92, then PROJECTS!E188/
// E193) to 0 as well. All three are labelled "Illustrative split;
// source model provides all-in rate only". With every base rate at
// zero, debt pricing is effectively margin-only, and rate-sensitivity
// or rate-shock stress testing cannot be meaningfully performed —
// there is nothing for a rate shock to act on.
//
// Handles a real resolution gap found while building this: some of
// these cells have no cached value at all (not even via ExcelJS's own
// cell.result accessor) when their formula is a bare, single-cell
// reference to another cell — resolves through a bounded number of
// hops manually rather than giving up when a cached value is absent.
//
// PREVALENCE TESTED before finalizing: zero matches on three other
// real test files for the "base rate" label pattern at all — this is
// specific to debt-heavy real estate/infrastructure models, not a
// broadly-triggered pattern.

const BASE_RATE_TERMS = ['base rate', 'reference rate', 'floating rate index'];
const MAX_RESOLUTION_HOPS = 5;

function resolveNumericValue(workbook, sheetName, address, hopsRemaining) {
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) return null;
  const cell = ws.getCell(address);
  const raw = cell.formula ? cell.result : cell.value;
  if (typeof raw === 'number') return raw;
  if (raw !== undefined && raw !== null) return null; // a genuine non-numeric value (text, error, object) — not resolvable as a rate

  if (hopsRemaining <= 0 || !cell.formula) return null;
  // Only follow a BARE, single-cell reference — anything more complex
  // (an actual calculation) is not something this check tries to
  // evaluate itself; that's what recalculation checks are for.
  const m = /^(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+)$/.exec(cell.formula.trim());
  if (!m) return null;
  const [, refSheet, refCol, refRow] = m;
  return resolveNumericValue(workbook, refSheet || sheetName, refCol + refRow, hopsRemaining - 1);
}

function checkZeroBaseRates(workbook) {
  const candidates = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const text = String(cell.value || '').toLowerCase();
        const matchedTerm = BASE_RATE_TERMS.find(t => text.includes(t));
        if (!matchedTerm) return;
        // Look rightward a short distance for the actual rate value.
        for (let c = colNum + 1; c <= colNum + 4; c++) {
          const valCell = row.getCell(c);
          const value = resolveNumericValue(workbook, ws.name, valCell.address, MAX_RESOLUTION_HOPS);
          if (value === null) continue;
          candidates.push({ sheet: ws.name, labelCell: cell.address, valueCell: valCell.address, label: String(cell.value).slice(0, 60), value });
          break;
        }
      });
    });
  });

  if (candidates.length === 0) {
    return { applicable: true, found: false,
      note: 'No labelled base/reference rate inputs were found in this workbook.' };
  }

  const allZero = candidates.every(c => c.value === 0);
  if (!allZero) {
    return { applicable: true, found: false,
      note: `${candidates.length} labelled base/reference rate input(s) found; at least one is genuinely nonzero, so rate-sensitivity testing is not obviously precluded.` };
  }

  return {
    applicable: true, found: true, candidates,
    note: `All ${candidates.length} labelled base/reference rate input(s) in this workbook are genuinely zero (${candidates.map(c => `${c.label} = 0 at ${c.sheet}!${c.valueCell}`).join('; ')}). Debt pricing is effectively margin-only — there is no base rate for a rate shock or rate-sensitivity stress test to act on, so interest-rate risk cannot be meaningfully tested as currently built.`,
  };
}

module.exports = { checkZeroBaseRates };
