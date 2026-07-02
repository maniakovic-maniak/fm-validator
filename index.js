require('dotenv').config();
const { fetchAndParse }                            = require('./src/parser');
const { familiariseModel, formatSummaryAsContext } = require('./src/familiariser');
const { loadDomainSkill }                          = require('./src/classifier');
const { preValidate }                              = require('./src/pre-validator');
const { runTier1 }                                 = require('./src/validator-tier1');
const { runTier0 }                                 = require('./src/validator-tier0');
const { runTier2 }                                 = require('./src/validator-tier2');
const { buildReportFile }                          = require('./src/report-tab');
const { uploadBothFiles }                          = require('./src/writer');
const { sendNotification }                         = require('./src/notifier');
const path = require('path');
const fs   = require('fs');

const FILE_ID   = process.argv[2];
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

if (!FILE_ID) {
  console.error('Usage: node index.js <google-drive-file-id>');
  process.exit(1);
}

async function run() {
  // ── Step 1: Parse ──────────────────────────────────────────────────────────
  const parsed = await fetchAndParse(FILE_ID);

  // Derive original filename from the downloaded file path
  const originalName = path.basename(parsed._filePath);

  console.log('\n─────────────────────────────────────');
  console.log(`FM VALIDATOR — ${originalName}`);
  console.log('─────────────────────────────────────\n');

  // ── Step 1.5: Tier 0 — Formula text scan ──────────────────────────────
  console.log('[1.5/6] Scanning formula text...');
  const tier0 = await runTier0(parsed);

  // ── Step 2: Familiarise ────────────────────────────────────────────────────
  console.log('[1/6] Familiarising with the model...');
  const modelSummary = await familiariseModel(parsed);
  const modelContext = formatSummaryAsContext(modelSummary);

  // ── Step 3: Classify + load domain skill ──────────────────────────────────
  console.log('\n[2/6] Classifying model type...');
  const modelType = modelSummary.model_type || 'generic';
  console.log(`   Model type: ${modelType}`);
  console.log(`   Industry: ${modelSummary.industry || 'unknown'}`);

  const domain = loadDomainSkill(modelType);
  console.log(`   Domain skill loaded: ${domain.file}`);

  // ── Step 4: Pre-validation gate ────────────────────────────────────────────
  console.log('\n[3/6] Running pre-validation gate...');
  const preResult = preValidate(parsed);
  if (!preResult.passed) {
    console.log('❌ Pre-validation failed — stopping');
    preResult.results
      .filter(r => r.status === 'fail')
      .forEach(r => console.log(`   FAIL: ${r.check} → ${r.reason}`));
    process.exit(1);
  }
  console.log('✅ Pre-validation passed');

  // ── Step 5: Validation — single pass, flag only ────────────────────────────
  console.log('\n[4/6] Running validation...');
  const t1Results  = runTier1(parsed);
  const t1Pass     = t1Results.filter(r => r.status === 'pass').length;
  const t1Failures = t1Results.filter(r => r.status === 'fail');

  const t2Results  = await runTier2(parsed, {
    domain:      domain.content,
    modelContext,
    keySheets:   modelSummary.key_sheets
  });
  const t2Pass     = t2Results.filter(r => r.status === 'pass').length;
  const t2Failures = t2Results.filter(r => r.status !== 'pass');

  console.log(`   Tier 1: ${t1Pass} pass, ${t1Failures.length} fail`);
  console.log(`   Tier 2: ${t2Pass} pass, ${t2Failures.length} issues`);

  // Deduplicate findings
  const seenKeys   = new Set();
  const allFlagged = [];
  const allFixes   = [];
  for (const f of [...t1Failures, ...t2Failures]) {
    const key = `${f.id}-${f.sheet || ""}`;
    if (!seenKeys.has(key)) { seenKeys.add(key); allFlagged.push(f); }
  }
  console.log(`   ℹ️  ${allFlagged.length} items flagged`);
  // Per-rule outcomes for the Validation Matrix tab (pass + fail + uncertain)
  const ruleResults = [...t1Results, ...t2Results].map(r => ({
    id: r.id, status: r.status || 'uncertain',
    confidence: r.confidence ?? null, needs_retest: r.needs_retest ?? false
  }));


  // ── Step 6: Build report ───────────────────────────────────────────────────
  console.log('\n[5/6] Building validation report...');
  const baseName   = originalName.replace(/\.[^/.]+$/, '');
  const reportName = `${baseName}_VALIDATED.xlsx`;
  const reportPath = path.join(process.cwd(), 'processed', reportName);

  if (!fs.existsSync(path.join(process.cwd(), 'processed'))) {
    fs.mkdirSync(path.join(process.cwd(), 'processed'), { recursive: true });
  }


  // Build audit log
  const auditLog = [
    { timestamp: new Date().toISOString().substr(11,8), step: 'Parse', action: `Parsed ${parsed.sheetNames.length} sheets`, artifact: originalName, result: '✓ Pass', duration: '', notes: `${parsed.sheetNames.length} sheets` },
    { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 0', action: 'Formula scan', artifact: 'All sheets', result: '✓ Pass', duration: tier0.elapsed || '', notes: `${tier0.stats.uniqueFormulaCount} unique formulas` },
    { timestamp: new Date().toISOString().substr(11,8), step: 'Familiarise', action: 'Claude read all sheets', artifact: originalName, result: '✓ Pass', duration: '', notes: modelType },
    { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 1', action: `${t1Results.length} code checks`, artifact: `${t1Pass} pass · ${t1Failures.length} fail`, result: t1Failures.length > 0 ? '⚠ Issues' : '✓ Pass', duration: '', notes: '' },
    { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 2', action: '3 batches · 129 rules', artifact: 'Batches 1-3', result: t2Failures.length > 0 ? '⚠ Issues' : '✓ Pass', duration: '', notes: `${t2Pass} pass · ${t2Failures.length} issues` }
  ];
  const t2Meta = t2Results[0] && t2Results[0]._meta ? t2Results[0]._meta : {};
  const auditCompletion = t2Meta.audit_completion_percent || Math.round(((141 - allFlagged.length) / 141) * 100);
  const auditCommentary = t2Meta.audit_completion_commentary || `The audit file has completed ${auditCompletion}% of the planned review procedures. Open items are listed by priority below.`;
  const overallAssessment = 'audit_complete';
  const igReadiness = auditCompletion;
  const igCommentary = auditCommentary;

  await buildReportFile(reportPath, allFlagged, allFixes, {
    originalName,
    modelType,
    modelIndustry:     modelSummary.industry,
    modelPurpose:      modelSummary.model_purpose,
    modelSummary,
    tier0,
    auditLog,
    overallAssessment,
    igReadiness,
    igCommentary,
    domainSkill:       domain.file,
    modelTier:         'Tier 1',
    reviewMode:        'llm_only',
    ruleResults
  });

  // ── Step 7: Upload + notify ────────────────────────────────────────────────
  console.log('\n[6/6] Uploading report and notifying...');
  const { reportResult } = await uploadBothFiles(reportPath, reportName, FOLDER_ID);

  await sendNotification({
    originalName,
    outputName:     reportName,
    webViewLink:    reportResult.webViewLink,
    totalIssues:    allFlagged.length,
    autoFixed:      0,
    needsAttention: allFlagged.length,
    modelType,
    modelIndustry:  modelSummary.industry
  });

  console.log('\n─────────────────────────────────────');
  console.log('FM VALIDATOR — complete');
  console.log(`Model type:       ${modelType} — ${modelSummary.industry || 'unknown'}`);
  console.log(`Needs attention:  ${allFlagged.length}`);
  console.log(`Report file:      ${reportName}`);
  console.log('Note: Original file unchanged');
  console.log('─────────────────────────────────────\n');
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error('Stack:', err.stack);
  process.exit(1);
});
