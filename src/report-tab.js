// report-tab.js — FM Validator Report Builder
// Builds a 9-tab _VALIDATED.xlsx using the Python report builder.
// Passes all pipeline data as JSON to the Python script.

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const PYTHON_SCRIPT = path.join(__dirname, 'build_report.py');

async function buildReportFile(reportPath, allFlagged, allFixes, meta) {
  const {
    originalName, modelType, modelIndustry, modelPurpose,
    modelSummary, tier0, auditLog, overallAssessment,
    igReadiness, igCommentary, domainSkill, ruleResults, errorScan
  } = meta;

  // Enrich findings with F-score using the cell-level index built by Tier 0.
  // This indexes EVERY formula cell (not just one representative cell per
  // unique pattern), so lookups by a finding's exact sheet+cell succeed
  // even when that cell isn't the first-seen instance of its formula pattern.
  const cellScoreIndex = (tier0 && tier0.cellScoreIndex) ? tier0.cellScoreIndex : {};

  // Extracts the first single-cell reference from a cell field that may
  // contain a range (M8:M10), multiple cells (P35/O39), or a composite
  // reference (D14 / D28). Falls back to the raw value if no clean
  // single-cell pattern is found.
  function firstCellRef(cellStr) {
    if (!cellStr) return cellStr;
    // Match the first Excel-style cell reference (e.g. J45, AB123)
    const match = String(cellStr).match(/[A-Z]{1,3}\d{1,7}/);
    return match ? match[0] : cellStr;
  }

  const enrichedFindings = allFlagged.map(f => {
    const cleanCell = firstCellRef(f.cell);
    const key = `${f.sheet || ''}!${cleanCell || ''}`;
    const cs  = cellScoreIndex[key];
    return {
      ...f,
      fscore:        cs ? cs.fscore : null,
      formulaText:   cs ? cs.formulaText : null,
      formulaClass:  null,
    };
  });

  // Source file name (relative — for hyperlinks)
  const sourceFile = originalName || 'model.xlsm';

  // Build data payload
  const payload = {
    modelName:       path.parse(originalName || 'Model').name,
    modelType:       modelType || 'unknown',
    modelIndustry:   modelIndustry || '',
    currency:        modelSummary ? (modelSummary.currency || '') : '',
    periodicity:     modelSummary ? (modelSummary.periodicity || '') : '',
    domainSkill:     domainSkill || 'skill-generic.md',
    sourceFile,
    findings:        enrichedFindings,
    tier0:           tier0 || { stats: {}, uniqueFormulas: [], edgeList: [] },
    overallAssessment: overallAssessment || 'not_fit_for_purpose',
    igReadiness:     igReadiness || 0,
    igCommentary:    igCommentary || '',
    modelTier:       meta.modelTier || 'Tier 1',
    reviewMode:      meta.reviewMode || 'llm_only',
    ruleResults:     ruleResults || [],
    errorScan:       errorScan || [],
    auditLog:        auditLog || []
  };

  // Write payload to temp file
  const dataPath = reportPath.replace('.xlsx', '_data.json');
  fs.writeFileSync(dataPath, JSON.stringify(payload, null, 2));

  try {
    // Call Python report builder
    const result = execSync(
      `python3 "${PYTHON_SCRIPT}" "${dataPath}" "${reportPath}"`,
      { timeout: 120000, encoding: 'utf8' }
    );
    const parsed = JSON.parse(result.trim());
    console.log(`   ✅ Report file built: ${path.basename(reportPath)} (${parsed.tabs} tabs, ${parsed.findings} findings)`);
  } catch (err) {
    console.error('   ❌ Report build error:', err.message);
    throw err;
  } finally {
    // Clean up temp data file
    if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
  }
}

module.exports = { buildReportFile };
