'use strict';
// Sheet-level facts that cell values cannot show: whether a sheet is hidden, very hidden or protected.
// Tier 2 rules about hidden sheets (T2-S2-003) and protected or locked areas (T2-S13-005) previously
// answered "no visibility information was provided" because nothing carried this to the reviewer.
// Read from the exceljs workbook the parser already holds; no extra file access.

function buildSheetFacts(parsed) {
  const raw = parsed && parsed._raw;
  if (!raw || !Array.isArray(raw.worksheets)) return null;
  return raw.worksheets.map(ws => {
    const prot = ws.sheetProtection;
    return {
      name: ws.name,
      state: ws.state || 'visible',                       // 'visible' | 'hidden' | 'veryHidden'
      sheetProtected: !!(prot && (prot.sheet === true || prot.sheet === 1 || prot.sheet === '1' || prot.sheet === 'true')),
      passwordProtected: !!(prot && (prot.password || prot.hashValue || prot.algorithmName))
    };
  });
}

module.exports = { buildSheetFacts };
