require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

// Core pipeline modules
const { parseExcel, parseExcelJS } = require('./src/parser');
const { preValidate } = require('./src/pre-validator');
const { runTier1 } = require('./src/validator-tier1');
const { runTier2 } = require('./src/validator-tier2');
const { applyFixes } = require('./src/fixer');
const { buildReportAndHighlight } = require('./src/report-tab');
const { uploadToDrive } = require('./src/writer');
const { sendNotification } = require('./src/notifier');

const app = express();

// Ensure required directories exist on startup
['uploads', 'processed'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log('Created directory:', dirPath);
  }
});
const PORT = process.env.PORT || 3000;
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
const MAX_FIX_LOOPS = 3;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ── File upload config ────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const base = path.parse(file.originalname).name;
    cb(null, `${base}-${timestamp}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.includes('spreadsheet') ||
                file.mimetype.includes('excel') ||
                file.originalname.match(/\.(xlsx|xlsm)$/i);
    ok ? cb(null, true) : cb(new Error('Only .xlsx and .xlsm files are allowed'), false);
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'fm-validator.html')));
app.get('/fm-validator', (req, res) => res.sendFile(path.join(__dirname, 'public', 'fm-validator.html')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/api/checklists', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'checklists', 'config.json'), 'utf-8'));
    res.json({ status: 'success', data: config.availableChecklists || [] });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Failed to load checklists' });
  }
});

// ── Main validation endpoint ───────────────────────────────────────────────────
app.post('/api/validate', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;
  const startTime = Date.now();

  console.log(`\n─────────────────────────────────────`);
  console.log(`FM VALIDATOR — ${originalName}`);
  console.log(`─────────────────────────────────────`);

  try {
    // ── Step 1: Parse ──────────────────────────────────────────────────
    console.log('[1/5] Parsing file...');
    const parsed = await parseExcelJS(filePath);
    const workbook = parsed._raw;
    console.log(`   Found ${parsed.sheetNames.length} sheets`);

    // ── Step 2: Pre-validation gate ────────────────────────────────────
    console.log('[2/5] Pre-validation gate...');
    const preResult = preValidate(parsed);
    if (!preResult.passed) {
      const failures = preResult.results.filter(r => r.status === 'fail');
      console.log(`   ❌ Pre-validation failed — ${failures.length} issues`);
      return res.json({
        status: 'pre-validation-failed',
        message: 'File failed pre-validation checks',
        failures: failures.map(f => ({ check: f.check, reason: f.reason })),
        stats: { total: failures.length, autoFixed: 0, needsAttention: failures.length, score: 0 }
      });
    }
    console.log('   ✅ Pre-validation passed');

    // ── Step 3: Fix loop ───────────────────────────────────────────────
    console.log('[3/5] Running validation and fix loop...');
    let allFixes = [];
    let allFlagged = [];
    let loopCount = 0;

    while (loopCount < MAX_FIX_LOOPS) {
      loopCount++;
      console.log(`   Loop ${loopCount}/${MAX_FIX_LOOPS}`);

      const t1Results = runTier1(parsed);
      const t1Failures = t1Results.filter(r => r.status === 'fail');

      const t2Results = await runTier2(parsed);
      const t2Failures = t2Results.filter(r => r.status !== 'pass');

      console.log(`   Tier 1: ${t1Results.length - t1Failures.length} pass, ${t1Failures.length} fail`);
      console.log(`   Tier 2: ${t2Results.filter(r => r.status === 'pass').length} pass, ${t2Failures.length} issues`);

      const allFailures = [...t1Failures, ...t2Failures];
      if (allFailures.length === 0) {
        console.log('   ✅ No issues found');
        break;
      }

      const fixable = allFailures.filter(r => r.fixable);
      const flagged = allFailures.filter(r => !r.fixable);
      allFlagged = [...allFlagged, ...flagged];

      if (fixable.length === 0) {
        console.log(`   ℹ️  No auto-fixable issues remain — ${flagged.length} flagged`);
        break;
      }

      const { fixes } = applyFixes(workbook, fixable);
      allFixes = [...allFixes, ...fixes];
      console.log(`   🔧 Applied ${fixes.length} fixes`);
    }

    // ── Step 4: Build report + highlight ──────────────────────────────
    console.log('[4/5] Building report and highlights...');
    const baseName = path.parse(originalName).name;
    const outputName = `${baseName}_VALIDATED.xlsx`;
    const outputPath = path.join(__dirname, 'processed', outputName);

    if (!fs.existsSync(path.join(__dirname, 'processed'))) {
      fs.mkdirSync(path.join(__dirname, 'processed'), { recursive: true });
    }

    await buildReportAndHighlight(filePath, outputPath, allFlagged, allFixes, { originalName });

    // ── Step 5: Upload to Drive + notify ──────────────────────────────
    console.log('[5/5] Uploading to Drive and notifying...');
    let driveResult = null;
    try {
      driveResult = await uploadToDrive(outputPath, outputName, FOLDER_ID);
      await sendNotification({
        originalName,
        outputName: driveResult.fileName,
        webViewLink: driveResult.webViewLink,
        totalIssues: allFixes.length + allFlagged.length,
        autoFixed: allFixes.length,
        needsAttention: allFlagged.length
      });
    } catch (driveErr) {
      console.error('   ❌ Drive/notify error:', driveErr.message);
      console.error('   Full error:', driveErr);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalChecked = allFixes.length + allFlagged.length;
    const score = totalChecked === 0
      ? 100
      : Math.round(((totalChecked - allFlagged.length) / totalChecked) * 100);

    console.log(`\n✅ Complete in ${duration}s — fixed: ${allFixes.length}, flagged: ${allFlagged.length}`);

    // Return full result to UI
    res.json({
      status: allFlagged.length === 0 ? 'passed' : 'flagged',
      message: allFlagged.length === 0
        ? 'All checks passed — no issues found'
        : `Validation complete — ${allFlagged.length} item(s) need your attention`,
      stats: {
        total: totalChecked,
        autoFixed: allFixes.length,
        needsAttention: allFlagged.length,
        score,
        duration
      },
      driveLink: driveResult ? driveResult.webViewLink : null,
      outputName,
      fixes: allFixes.map(f => ({
        sheet: f.sheet, cell: f.cell, issue: f.issue, fix: f.fix
      })),
      flagged: allFlagged.map(f => ({
        sheet: f.sheet, cell: f.cell || 'A1',
        issue: f.issue || f.reason || f.label,
        action: f.fix_instruction || 'Review and fix manually'
      }))
    });

    // Clean up uploaded file
    fs.unlink(filePath, () => {});

  } catch (error) {
    console.error('Fatal validation error:', error);
    fs.unlink(filePath, () => {});
    res.status(500).json({ status: 'error', message: error.message || 'Validation failed' });
  }
});

// ── Error handlers ────────────────────────────────────────────────────────────
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ status: 'error', message: 'File exceeds 20 MB limit' });
  }
  res.status(error.status || 500).json({ status: 'error', message: error.message });
});

app.use((req, res) => res.status(404).json({ status: 'error', message: 'Not found' }));

app.listen(PORT, () => console.log(`FM Validator running on http://localhost:${PORT}`));
module.exports = app;
