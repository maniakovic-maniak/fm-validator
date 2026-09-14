const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

// FIX: found via a real, direct submission (Final Determinations - ESO
// Licence Model) that genuinely, completely failed to parse - not a
// corrupted file, but a real, confirmed XML-malformation pattern: a VML
// comment/note part (xl/drawings/vmlDrawingN.vml) containing an
// unclosed HTML-style <br> tag. Excel itself tolerates this when
// rendering the comment, but strict XML parsing (what ExcelJS's
// underlying sax parser requires) rejects it outright, failing the
// entire workbook parse before Tier 0 even runs.
//
// Deliberately narrow and conservative - only repairs this one,
// specific, confirmed tag-closure pattern inside VML parts specifically
// (not the whole workbook's XML), rather than attempting a broad,
// general-purpose XML repair that could silently alter content in ways
// harder to reason about. A cell's own formulas and values are never
// touched by this - VML parts govern only legacy comment/note
// rendering.
const UNCLOSED_TAG_PATTERNS = [
  { tag: 'br', re: /<br(?!\s*\/)>(?!\s*<\/br>)/gi, replacement: '<br/>' },
  { tag: 'hr', re: /<hr(?!\s*\/)>(?!\s*<\/hr>)/gi, replacement: '<hr/>' },
];

/**
 * Checks a .xlsx/.xlsm file for the known, confirmed unclosed-tag
 * pattern inside its VML parts, and if found, writes a repaired copy to
 * a temp file. Returns the original filePath unchanged if no known
 * issue is found (the common, expected case) - callers should always
 * use the returned path, not assume anything changed.
 *
 * Read-only with respect to the original file - never modifies it in
 * place, so the customer's own uploaded file is untouched either way.
 */
async function repairKnownVmlIssues(filePath) {
  const buffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(buffer);

  const vmlFiles = Object.keys(zip.files).filter(name => /^xl\/drawings\/vmlDrawing\d+\.vml$/i.test(name));
  if (vmlFiles.length === 0) return filePath;

  let anyRepaired = false;
  const repairedNames = [];

  for (const name of vmlFiles) {
    const original = await zip.file(name).async('string');
    let repaired = original;
    let thisFileRepaired = false;
    for (const { re, replacement, tag } of UNCLOSED_TAG_PATTERNS) {
      if (re.test(repaired)) {
        repaired = repaired.replace(re, replacement);
        thisFileRepaired = true;
      }
    }
    if (thisFileRepaired) {
      zip.file(name, repaired);
      anyRepaired = true;
      repairedNames.push(name);
    }
  }

  if (!anyRepaired) return filePath;

  console.log(`   \u2139\ufe0f  Repaired a known, confirmed XML issue (unclosed tag) in: ${repairedNames.join(', ')} - the file's formulas and values are untouched, only the VML comment markup was corrected.`);

  const outPath = path.join(os.tmpdir(), `repaired-${Date.now()}-${path.basename(filePath)}`);
  const outBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outPath, outBuffer);
  return outPath;
}

module.exports = { repairKnownVmlIssues };
