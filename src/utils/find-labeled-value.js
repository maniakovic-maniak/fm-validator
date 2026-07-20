// Find cells by nearby label text, returning their computed value.
//
// Financial models have no universal convention for where a named metric
// (WACC, Terminal Value, EBITDA Margin) lives. This searches every
// text-containing cell in the workbook for a label match, then reads the
// value from the SAME row, a bounded distance to the right — the
// dominant convention (matches the ICAEW Code's own "read left to right"
// guidance) but not the only one real models use.
//
// Returns ALL candidates found, not just the first — several checks
// built on this deliberately treat "found in one place" as higher
// confidence than "found in several conflicting places", rather than
// silently picking one and risking being wrong about which is real.

function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'object') return v.richText ? v.richText.map(t => t.text).join('') : (v.text || '');
  return String(v);
}

/**
 * @param {object} workbook  exceljs workbook (parsed._raw)
 * @param {string[]} labelTerms  terms to match against cell text (case-insensitive substring)
 * @param {object} opts  { maxDistance: how many cells right of the label to check for a value (default 6),
 *                          excludeSheets: sheet names to skip (e.g. a Legend or Read Me tab that might
 *                          mention "WACC" in an explanatory sentence, not as an actual labelled value) }
 */
const BACKUP_LIKE_RE = /\b(backup|copy|duplicate|old|archive)\b/i;

function findLabeledValues(workbook, labelTerms, opts = {}) {
  const maxDistance = opts.maxDistance || 6;
  const skipBackups = opts.skipBackups !== false; // default true — backup sheets just add noise to a value search
  const exclude = new Set((opts.excludeSheets || []).map(s => s.toLowerCase()));
  const terms = labelTerms.map(t => t.toLowerCase());
  const candidates = [];

  workbook.eachSheet(ws => {
    if (exclude.has(ws.name.toLowerCase())) return;
    if (skipBackups && BACKUP_LIKE_RE.test(ws.name)) return;
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const text = cellText(cell.value).toLowerCase();
        if (!text) return;
        const matchedTerm = terms.find(t => text.includes(t));
        if (!matchedTerm) return;
        // A label cell itself is text, not a number — its own .value is
        // the label text, not a metric. Look rightward for the value.
        for (let c = colNum + 1; c <= colNum + maxDistance; c++) {
          const valCell = row.getCell(c);
          const raw = valCell.formula ? valCell.result : valCell.value;
          if (typeof raw === 'number') {
            candidates.push({
              sheet: ws.name, labelCell: cell.address, valueCell: valCell.address,
              matchedTerm, labelText: cellText(cell.value).slice(0, 80),
              value: raw, isFormula: !!valCell.formula
            });
            break; // first numeric cell right of the label — don't also grab a second coincidental number further along
          }
          if (cellText(valCell.value)) break; // hit another label before finding a number — stop, wrong direction
        }
      });
    });
  });

  return candidates;
}

// FIX/EXTENSION (found necessary via real testing during this session's
// Phase D work): findLabeledValues (above) deliberately stops at the
// first numeric cell right of a label — the right choice for a single
// "headline" metric (WACC, EBITDA margin), but wrong for a check that
// needs to examine EVERY period of a time-series row (e.g. "cash balance
// should never be negative", which must check all periods, not just the
// nearest one). Confirmed directly: on a real file, a "cash balance"
// label's nearest column was a genuine zero opening balance, silently
// hiding a much longer real series to its right. This function scans
// the FULL row instead, returning every numeric value found, not just
// the first — for checks where that completeness matters more than
// avoiding a coincidental second number.
function findLabeledRowSeries(workbook, labelTerms, opts = {}) {
  const maxDistance = opts.maxDistance || 60; // wider default — a real time series can span many periods
  const skipBackups = opts.skipBackups !== false;
  const exclude = new Set((opts.excludeSheets || []).map(s => s.toLowerCase()));
  const terms = labelTerms.map(t => t.toLowerCase());
  const results = [];

  workbook.eachSheet(ws => {
    if (exclude.has(ws.name.toLowerCase())) return;
    if (skipBackups && BACKUP_LIKE_RE.test(ws.name)) return;
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const text = cellText(cell.value).toLowerCase();
        if (!text) return;
        const matchedTerm = terms.find(t => text.includes(t));
        if (!matchedTerm) return;
        const series = [];
        let consecutiveGaps = 0;
        for (let c = colNum + 1; c <= colNum + maxDistance; c++) {
          const valCell = row.getCell(c);
          const raw = valCell.formula ? valCell.result : valCell.value;
          if (typeof raw === 'number') {
            series.push({ cell: valCell.address, value: raw });
            consecutiveGaps = 0;
          } else if (cellText(valCell.value)) {
            break; // hit another label — stop, this is the end of the series
          } else {
            // A genuinely blank cell — tolerate a short gap (a single
            // skipped column is plausible in a real layout), but stop
            // after several in a row rather than scanning arbitrarily
            // far past the end of the real data.
            consecutiveGaps++;
            if (consecutiveGaps >= 3) break;
          }
        }
        if (series.length > 0) {
          results.push({
            sheet: ws.name, labelCell: cell.address, matchedTerm,
            labelText: cellText(cell.value).slice(0, 80), series,
          });
        }
      });
    });
  });

  return results;
}

module.exports = { findLabeledValues, findLabeledRowSeries };
