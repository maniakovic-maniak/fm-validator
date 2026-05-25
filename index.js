require('dotenv').config();
const { fetchAndParse } = require('./src/parser');
const { preValidate } = require('./src/pre-validator');
const { runTier1 } = require('./src/validator-tier1');
const { runTier2 } = require('./src/validator-tier2');
const { applyFixes } = require('./src/fixer');
const { buildReportAndHighlight } = require('./src/report-tab');
const { uploadToDrive } = require('./src/writer');
const { sendNotification } = require('./src/notifier');
const XLSX = require('xlsx');
const path = require('path');

const FILE_ID = process.argv[2];
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
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

  // ── Step 1: Parse ──────────────────────────────
  const parsed = await fetchAndParse(FILE_ID);
  const workbook = parsed._raw;

  // ── Step 2: Pre-validation gate ────────────────
  console.log('\n[1/5] Running pre-validation gate...');
  const preResult = preValidate(parsed);
  if (!preResult.passed) {
    console.log('❌ Pre-validation failed — stopping');
    preResult.results
      .filter(r => r.status === 'fail')
      .forEach(r => console.log(`   FAIL: ${r.check} → ${r.reason}`));
    process.exit(1);
  }
  console.log('✅ Pre-validation passed');

  // ── Step 3: Fix loop ───────────────────────────
  console.log('\n[2/5] Running validation and fix loop...');
  let allFixes = [];
  let allFlagged = [];
  let loopCount = 0;

  while (loopCount < MAX_FIX_LOOPS) {
    loopCount++;
    console.log(`\n   Loop ${loopCount}/${MAX_FIX_LOOPS}`);

    const t1Results = runTier1(parsed);
    const t1Failures = t1Results.filter(r => r.status === 'fail');
    console.log(`   Tier 1: ${t1Results.length - t1Failures.length} pass, ${t1Failures.length} fail`);

    const t2Results = await runTier2(parsed);
    const t2Failures = t2Results.filter(r => r.status !== 'pass');
    console.log(`   Tier 2: ${t2Results.filter(r => r.status === 'pass').length} pass, ${t2Failures.length} issues`);

    const allFailures = [...t1Failures, ...t2Failures];
    if (allFailures.length === 0) {
      console.log('   ✅ No issues found — loop complete');
      break;
    }

    const fixable = allFailures.filter(r => r.fixable);
    const flagged = allFailures.filter(r => !r.fixable);
    allFlagged = [...allFlagged, ...flagged];

    if (fixable.length === 0) {
      console.log(`   ℹ️  No auto-fixable issues remain — ${flagged.length} items flagged`);
      break;
    }

    const { fixes } = applyFixes(workbook, fixable);
    allFixes = [...allFixes, ...fixes];
    console.log(`   🔧 Applied ${fixes.length} fixes`);
  }

  // ── Step 4: Build report + highlight via exceljs ─
  console.log('\n[3/5] Highlighting fixes and building report tab...');
  const baseName = ORIGINAL_NAME.replace(/\.[^/.]+$/, '');
  const outputName = `${baseName}_VALIDATED.xlsx`;
  const inputPath  = path.join(process.cwd(), 'processed', `${FILE_ID}.xlsm`);
  const outputPath = path.join(process.cwd(), 'processed', outputName);

  await buildReportAndHighlight(
    inputPath,
    outputPath,
    allFlagged,
    allFixes,
    { originalName: ORIGINAL_NAME }
  );

  // ── Step 5: Upload to Drive ────────────────────
  console.log('\n[4/5] Saving validated file to Drive...');
  const driveResult = await uploadToDrive(outputPath, outputName, FOLDER_ID);

  // ── Step 6: Notify ─────────────────────────────
  console.log('\n[5/5] Sending notification...');
  await sendNotification({
    originalName: ORIGINAL_NAME,
    outputName: driveResult.fileName,
    webViewLink: driveResult.webViewLink,
    totalIssues: allFixes.length + allFlagged.length,
    autoFixed: allFixes.length,
    needsAttention: allFlagged.length
  });

  console.log('\n─────────────────────────────────────');
  console.log('FM VALIDATOR — complete');
  console.log(`Auto-fixed:       ${allFixes.length}`);
  console.log(`Needs attention:  ${allFlagged.length}`);
  console.log(`Output file:      ${driveResult.fileName}`);
  console.log('─────────────────────────────────────\n');
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
