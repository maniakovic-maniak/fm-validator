require('dotenv').config();
const { fetchAndParse }                            = require('./src/parser');
const { familiariseModel, formatSummaryAsContext } = require('./src/familiariser');
const { loadDomainSkill }                          = require('./src/classifier');
const { preValidate }                              = require('./src/pre-validator');
const { runTier1 }                                 = require('./src/validator-tier1');
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
    const key = `${f.id}-${f.sheet}-${f.cell}`;
    if (!seenKeys.has(key)) { seenKeys.add(key); allFlagged.push(f); }
  }
  console.log(`   ℹ️  ${allFlagged.length} items flagged`);

  // ── Step 6: Build report ───────────────────────────────────────────────────
  console.log('\n[5/6] Building validation report...');
  const baseName   = originalName.replace(/\.[^/.]+$/, '');
  const reportName = `${baseName}_REPORT.xlsx`;
  const reportPath = path.join(process.cwd(), 'processed', reportName);

  if (!fs.existsSync(path.join(process.cwd(), 'processed'))) {
    fs.mkdirSync(path.join(process.cwd(), 'processed'), { recursive: true });
  }

  await buildReportFile(reportPath, allFlagged, allFixes, {
    originalName,
    modelType,
    modelIndustry: modelSummary.industry,
    modelPurpose:  modelSummary.model_purpose,
    modelSummary
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
