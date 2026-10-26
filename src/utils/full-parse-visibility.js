'use strict';
// full-parse-visibility.js - a visibility record for a run that showed the reviewer the whole workbook.
//
// Partner Review separates a genuine miss (the cell was in front of the reviewer) from a visibility gap (it was not).
// The curated route records which rows it showed. The full-parse route, when its coverage is complete_workbook, shows
// every formula, all static text and every named range, so nothing was out of sight, but it recorded nothing, and the
// Fm-00050 review therefore labelled nine findings "Missed entirely - no visibility record available" and counted no
// genuine misses at all. This builds a record in the same shape the curated route writes ({sheet: {batches, rowNumbers,
// cellAddresses}}) covering every exported cell, so a miss on a complete-workbook run is counted as a miss.

const fs = require('fs');
const path = require('path');

// order.reviewCoverage is written by server.js on runs from Patch 23 onward. Older orders have only their run log, so
// fall back to the two lines every full-parse run writes there.
function ranAsCompleteFullParse(order, logsDir) {
  if (!order) return false;
  const rc = order.reviewCoverage;
  if (rc && typeof rc === 'object') return rc.route === 'full_parse' && rc.coverage === 'complete_workbook';
  if (!order.runLogFilename || !logsDir) return false;
  try {
    const p = path.join(logsDir, path.basename(order.runLogFilename));
    if (!fs.existsSync(p)) return false;
    const t = fs.readFileSync(p, 'utf8');
    return /Funnel routing:\s*FULL-PARSE route/.test(t) && /coverage:\s*complete_workbook/.test(t);
  } catch (_) { return false; }
}

// sheets: { sheetName: ["AP127: =...", "A1: text", ...] } as built by partner-review-export.buildFullExport
function buildCompleteVisibility(sheets) {
  const record = {};
  for (const [sheetName, lines] of Object.entries(sheets || {})) {
    const rows = new Set(); const cells = [];
    for (const line of lines || []) {
      const m = /^([A-Z]{1,3})(\d+):/.exec(line);
      if (!m) continue;
      rows.add(+m[2]); cells.push(m[1] + m[2]);
    }
    record[sheetName] = { batches: ['full_parse'], rowNumbers: Array.from(rows).sort((a, b) => a - b), cellAddresses: cells.sort() };
  }
  return record;
}

module.exports = { ranAsCompleteFullParse, buildCompleteVisibility };
