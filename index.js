require('dotenv').config();
const { fetchAndParse }                    = require('./src/parser');
const { familiariseModel, formatSummaryAsContext } = require('./src/familiariser');
const { classifyModel, loadDomainSkill }   = require('./src/classifier');
const { preValidate }                      = require('./src/pre-validator');
const { runTier1 }                         = require('./src/validator-tier1');
const { runTier2 } = require('./src/validator-tier2');
const { applyFixes }                       = require('./src/fixer');
const { buildReportFile }                  = require('./src/report-tab');
const { uploadBothFiles }                  = require('./src/writer');
const { sendNotification }                 = require('./src/notifier');
const path = require('path');
const fs   = require('fs');

const FILE_ID       = process.argv[2];
const FOLDER_ID     = process.env.GOOGLE_DRIVE_FOLDER_ID;
const MAX_FIX_LOOPS = 3;
const ORIGINAL_NAME = 'Hidden Gem Base Case Financial Model (1.9Mtpa)4-03-2026 v 2 VBA FIX.xlsm';

if (!FILE_ID) {
  console.error('Usage: node index.js <google-drive-file-id>');
  process.exit(1);
}

async function run() {
  console.log('\n─────────────────────────────────────');
  console.log('FM VALIDATOR — starting');
  console.log('─────────────────────────────────────\n');

  // ── Step 1: Parse ──────────────────────────────────────────────────────────
  const parsed   = await fetchAndParse(FILE_ID);
  const workbook = parsed._raw;

  // ── Step 2: Familiarise ────────────────────────────────────────────────────
  console.log('\n[1/6] Familiarising with the model...');
  const modelSummary = await familiariseModel(parsed);
  const modelContext = formatSummaryAsContext(modelSummary);

  // ── Step 3: Classify + load domain skill ──────────────────────────────────
  console.log('\n[2/6] Classifying model type...');

  // Classifier uses the summary — much faster and more accurate
  const classification = {
    type: modelSummary.model_type || 'generic',
    confidence: 90,
    reason: modelSummary.model_purpose
  };
  console.log(`   Model type: ${classification.type}`);
  console.log(`   Industry: ${modelSummary.industry}`);

  const domain = loadDomainSkill(classification.type);
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

  // ── Step 5: Validation loop ────────────────────────────────────────────────
  console.log('\n[4/6] Running validation...');
  let allFixes   = [];
  let allFlagged = [];
  let loopCount  = 0;

  while (loopCount < MAX_FIX_LOOPS) {
    loopCount++;
    console.log(`\n   Loop ${loopCount}/${MAX_FIX_LOOPS}`);

    const t1Results  = runTier1(parsed);
    const t1Pass     = t1Results.filter(r => r.status === 'pass').length;
    const t1Failures = t1Results.filter(r => r.status === 'fail');

    const t2Results  = await runTier2(parsed, { domain: domain.content, modelContext, keySheets: modelSummary.key_sheets });
    const t2Pass     = t2Results.filter(r => r.status === 'pass').length;
    const t2Failures = t2Results.filter(r => r.status !== 'pass');

    console.log(`   Tier 1: ${t1Pass} pass, ${t1Failures.length} fail`);
    console.log(`   Tier 2: ${t2Pass} pass, ${t2Failures.length} issues`);

    const allFailures = [...t1Failures, ...t2Failures];
    if (allFailures.length === 0) {
      console.log('   ✅ No issues found');
      break;
    }

    const fixable = allFailures.filter(r => r.fixable);
    const flagged = allFailures.filter(r => !r.fixable);

    const existingKeys = new Set(allFlagged.map(f => `${f.id}-${f.sheet}-${f.cell}`));
    const newFlagged   = flagged.filter(f => !existingKeys.has(`${f.id}-${f.sheet}-${f.cell}`));
    allFlagged = [...allFlagged, ...newFlagged];

    console.log(`   ℹ️  ${newFlagged.length} new items flagged`);
    break;
  }

  // ── Step 6: Build report ───────────────────────────────────────────────────
  console.log('\n[5/6] Building validation report...');
  const baseName   = ORIGINAL_NAME.replace(/\.[^/.]+$/, '');
  const reportName = `${baseName}_REPORT.xlsx`;
  const reportPath = path.join(process.cwd(), 'processed', reportName);

  if (!fs.existsSync(path.join(process.cwd(), 'processed'))) {
    fs.mkdirSync(path.join(process.cwd(), 'processed'), { recursive: true });
  }

  await buildReportFile(reportPath, allFlagged, allFixes, {
    originalName:   ORIGINAL_NAME,
    modelType:      classification.type,
    modelIndustry:  modelSummary.industry,
    modelPurpose:   modelSummary.model_purpose,
    modelSummary
  });

  // ── Step 7: Upload + notify ────────────────────────────────────────────────
  console.log('\n[6/6] Uploading report and notifying...');
  const { reportResult } = await uploadBothFiles(reportPath, reportName, FOLDER_ID);

  await sendNotification({
    originalName:   ORIGINAL_NAME,
    outputName:     reportName,
    webViewLink:    reportResult.webViewLink,
    totalIssues:    allFixes.length + allFlagged.length,
    autoFixed:      allFixes.length,
    needsAttention: allFlagged.length,
    modelType:      classification.type,
    modelIndustry:  modelSummary.industry
  });

  console.log('\n─────────────────────────────────────');
  console.log('FM VALIDATOR — complete');
  console.log(`Model type:       ${classification.type} — ${modelSummary.industry}`);
  console.log(`Needs attention:  ${allFlagged.length}`);
  console.log(`Report file:      ${reportName}`);
  console.log('Note: Original file unchanged');
  console.log('─────────────────────────────────────\n');
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error('STACK:', err.stack);
  process.exit(1);
});
