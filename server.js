require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const cors    = require('cors');

// Core pipeline modules
const { parseExcel }                             = require('./src/parser');
const { familiariseModel, formatSummaryAsContext } = require('./src/familiariser');
const { loadDomainSkill }                        = require('./src/classifier');
const { preValidate }                            = require('./src/pre-validator');
const { runTier1 }                               = require('./src/validator-tier1');
const { runTier2, setDomainSkill, setModelContext } = require('./src/validator-tier2');
const { buildReportFile }                        = require('./src/report-tab');
const { uploadBothFiles }                        = require('./src/writer');
const { sendNotification }                       = require('./src/notifier');

const app       = express();
const PORT      = process.env.PORT || 3000;
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// Ensure required directories exist on startup
['uploads', 'processed'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log('Created directory:', dirPath);
  }
});

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
    const ext  = path.extname(file.originalname);
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
app.get('/',              (req, res) => res.sendFile(path.join(__dirname, 'public', 'fm-validator.html')));
app.get('/fm-validator',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'fm-validator.html')));
app.get('/api/health',    (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

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

  const filePath     = req.file.path;
  const originalName = req.file.originalname;
  const startTime    = Date.now();

  console.log(`\n─────────────────────────────────────`);
  console.log(`FM VALIDATOR — ${originalName}`);
  console.log(`─────────────────────────────────────`);

  try {
    // ── Step 1: Parse ──────────────────────────────────────────────────
    console.log('[1/6] Parsing file...');
    const parsed = await parseExcel(filePath);
    console.log(`   Found ${parsed.sheetNames.length} sheets`);

    // ── Step 2: Familiarise ────────────────────────────────────────────
    console.log('[2/6] Familiarising with the model...');
    const modelSummary = await familiariseModel(parsed);
    const modelContext = formatSummaryAsContext(modelSummary);

    // ── Step 3: Classify + load domain skill ──────────────────────────
    console.log('[3/6] Classifying model type...');
    const modelType = modelSummary.model_type || 'generic';
    console.log(`   Model type: ${modelType} — ${modelSummary.industry || 'unknown'}`);

    const domain = loadDomainSkill(modelType);
    setDomainSkill(domain.content);
    setModelContext(modelContext);
    console.log(`   Domain skill loaded: ${domain.file}`);

    // ── Step 4: Pre-validation gate ────────────────────────────────────
    console.log('[4/6] Pre-validation gate...');
    const preResult = preValidate(parsed);
    if (!preResult.passed) {
      const failures = preResult.results.filter(r => r.status === 'fail');
      console.log(`   ❌ Pre-validation failed — ${failures.length} issues`);
      return res.json({
        status: 'pre-validation-failed',
        message: 'File failed pre-validation checks',
        modelType,
        modelIndustry: modelSummary.industry,
        failures: failures.map(f => ({ check: f.check, reason: f.reason })),
        stats: { total: failures.length, autoFixed: 0, needsAttention: failures.length, score: 0 }
      });
    }
    console.log('   ✅ Pre-validation passed');

    // ── Step 5: Validation ─────────────────────────────────────────────
    console.log('[5/6] Running validation...');
    let allFlagged = [];

    const t1Results  = runTier1(parsed);
    const t1Failures = t1Results.filter(r => r.status === 'fail');

    const t2Results  = await runTier2(parsed);
    const t2Failures = t2Results.filter(r => r.status !== 'pass');

    console.log(`   Tier 1: ${t1Results.length - t1Failures.length} pass, ${t1Failures.length} fail`);
    console.log(`   Tier 2: ${t2Results.filter(r => r.status === 'pass').length} pass, ${t2Failures.length} issues`);

    // Deduplicate and collect all flagged items
    const allFailures  = [...t1Failures, ...t2Failures];
    const existingKeys = new Set();
    for (const f of allFailures) {
      const key = `${f.id}-${f.sheet}-${f.cell}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        allFlagged.push(f);
      }
    }
    console.log(`   ℹ️  ${allFlagged.length} items flagged`);

    // ── Step 6: Build report + upload + notify ─────────────────────────
    console.log('[6/6] Building report, uploading, notifying...');
    const baseName   = path.parse(originalName).name;
    const reportName = `${baseName}_REPORT.xlsx`;
    const reportPath = path.join(__dirname, 'processed', reportName);

    if (!fs.existsSync(path.join(__dirname, 'processed'))) {
      fs.mkdirSync(path.join(__dirname, 'processed'), { recursive: true });
    }

    await buildReportFile(reportPath, allFlagged, [], {
      originalName,
      modelType,
      modelIndustry: modelSummary.industry,
      modelPurpose:  modelSummary.model_purpose,
      modelSummary
    });

    let driveResult = null;
    try {
      const { reportResult } = await uploadBothFiles(reportPath, reportName, FOLDER_ID);
      driveResult = reportResult;
      await sendNotification({
        originalName,
        outputName:     driveResult.fileName,
        webViewLink:    driveResult.webViewLink,
        totalIssues:    allFlagged.length,
        autoFixed:      0,
        needsAttention: allFlagged.length,
        modelType,
        modelIndustry:  modelSummary.industry
      });
    } catch (driveErr) {
      console.error('   ❌ Drive/notify error:', driveErr.message);
    }

    const duration     = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalChecked = t1Results.length + t2Results.length;
    const score        = totalChecked === 0
      ? 100
      : Math.round(((totalChecked - allFlagged.length) / totalChecked) * 100);

    console.log(`\n✅ Complete in ${duration}s — flagged: ${allFlagged.length}`);

    res.json({
      status:       allFlagged.length === 0 ? 'passed' : 'flagged',
      message:      allFlagged.length === 0
        ? 'All checks passed — no issues found'
        : `Validation complete — ${allFlagged.length} item(s) need your attention`,
      modelType,
      modelIndustry: modelSummary.industry,
      modelPurpose:  modelSummary.model_purpose,
      immediateObservations: modelSummary.immediate_observations || [],
      stats: {
        total:          totalChecked,
        autoFixed:      0,
        needsAttention: allFlagged.length,
        score,
        duration
      },
      driveLink:  driveResult ? driveResult.webViewLink : null,
      reportName,
      flagged: allFlagged.map(f => ({
        sheet:    f.sheet,
        cell:     f.cell || 'A1',
        issue:    f.issue || f.reason || f.label,
        severity: f.severity || 'medium',
        type:     f.type || 'finding',
        action:   f.fix_instruction || 'Review and fix manually'
      }))
    });

    fs.unlink(filePath, () => {});

  } catch (error) {
    console.error('Fatal validation error:', error.message);
    console.error('Stack:', error.stack);
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
