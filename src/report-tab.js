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
    igReadiness, igCommentary, domainSkill
  } = meta;

  // Enrich findings with priority and fscore from tier0
  const ufiMap = {};
  if (tier0 && tier0.uniqueFormulas) {
    tier0.uniqueFormulas.forEach(uf => {
      if (uf.sheet && uf.cell) ufiMap[`${uf.sheet}!${uf.cell}`] = uf;
    });
  }

  const enrichedFindings = allFlagged.map(f => {
    const key = `${f.sheet || ''}!${f.cell || ''}`;
    const uf  = ufiMap[key];
    return {
      ...f,
      fscore:        uf ? uf.fscore : null,
      formulaText:   uf ? uf.formulaText : null,
      formulaClass:  uf ? uf.formulaClass : null,
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
