require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const cron        = require('node-cron');
const { sanitizeFilename }           = require('./src/utils/sanitize-filename');
const { logAuditEvent, getClientIp } = require('./src/utils/audit-log');
const { runRetentionSweep }          = require('./src/utils/cleanup');
const { startRunLog }                = require('./src/utils/run-logger');

// Core pipeline modules
const { parseExcel }                             = require('./src/parser');
const { familiariseModel, formatSummaryAsContext } = require('./src/familiariser');
const { loadDomainSkill }                        = require('./src/classifier');
const { preValidate }                            = require('./src/pre-validator');
const { runTier1 }                               = require('./src/validator-tier1');
const { runTier0 }                               = require('./src/validator-tier0');
const { runTier2 } = require('./src/validator-tier2');
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

// ALLOWED_ORIGIN supports a comma-separated list. Each entry is also
// expanded to cover its www./bare twin automatically — browsers treat
// https://wonderlabkids.net and https://www.wonderlabkids.net as entirely
// different origins, and users arrive via both.
function expandOrigin(o) {
  try {
    const u = new URL(o);
    const twin = u.hostname.startsWith('www.')
      ? `${u.protocol}//${u.hostname.slice(4)}${u.port ? ':' + u.port : ''}`
      : `${u.protocol}//www.${u.hostname}${u.port ? ':' + u.port : ''}`;
    return [o, twin];
  } catch (_) {
    return [o]; // not a parseable URL — keep as-is
  }
}

const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)
    .flatMap(expandOrigin)
].filter(Boolean);

// ── Rate limiting — 20 requests per 15 minutes per IP ────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many requests — please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/validate', limiter);

// ── API key auth middleware ────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const API_KEY = process.env.VALIDATOR_API_KEY;
  // If no API key configured, allow all (dev mode)
  if (!API_KEY) return next();
  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (provided === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorised — valid API key required in x-api-key header' });
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, Postman, direct server calls)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed: ' + origin));
  },
  credentials: true
}));
app.use(express.json());

// ── Passenger sub-URI normalisation ──────────────────────────────────────────
// When mounted at wonderlabkids.net/fm-validator, Passenger passes Node apps
// the FULL path including the '/fm-validator' prefix (unlike its behaviour
// for some other app types). Strip it here once so every route below works
// identically whether the app is accessed with or without the prefix
// (localhost dev = no prefix, production = prefixed).
const BASE_PATH = process.env.APP_BASE_PATH || '/fm-validator';
app.use((req, res, next) => {
  if (req.url === BASE_PATH || req.url.startsWith(BASE_PATH + '/') || req.url.startsWith(BASE_PATH + '?')) {
    req.url = req.url.slice(BASE_PATH.length) || '/';
    if (req.url.startsWith('?')) req.url = '/' + req.url;
  }
  next();
});

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
    const { name, ext } = sanitizeFilename(file.originalname);
    cb(null, `${name}-${timestamp}${ext}`);
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
app.post('/api/validate', requireApiKey, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ status: 'error', message: 'No file uploaded' });
  }

  const filePath     = req.file.path;
  const originalName = req.file.originalname;
  const startTime    = Date.now();
  const clientIp      = getClientIp(req);
  const runLog        = startRunLog(originalName);

  logAuditEvent({
    event: 'upload_received', originalName, storedAs: path.basename(filePath),
    ip: clientIp, sizeBytes: req.file.size, runLog: runLog.filename
  });

  console.log(`\n─────────────────────────────────────`);
  console.log(`FM VALIDATOR — ${originalName}`);
  console.log(`─────────────────────────────────────`);

  try {
    // ── Step 1: Parse ──────────────────────────────────────────────────
    console.log('[1/6] Parsing file...');
    const parsed = await parseExcel(filePath);
    console.log(`   Found ${parsed.sheetNames.length} sheets`);

    // ── Step 1.5: Tier 0 — Formula text scan ──────────────────────────
    console.log('[1.5/6] Scanning formula text...');
    const tier0 = await runTier0(parsed);

    // Check for potential formula caching issue — if many formulas but few errors
    // detected, warn that cached values may be missing
    if (tier0.stats.totalFormulaCells > 10000 && tier0.stats.totalRefInFormula === 0) {
      console.log('   ℹ️  Note: No #REF! detected in formula text. If the model has known errors,');
      console.log('   ℹ️  ensure the file was saved in Excel with calculation enabled (F9 before save).');
    }
    // ── Step 2: Familiarise ────────────────────────────────────────────
    console.log('[2/6] Familiarising with the model...');
    const modelSummary = await familiariseModel(parsed);
    const modelContext = formatSummaryAsContext(modelSummary);

    // ── Step 3: Classify + load domain skill ──────────────────────────
    console.log('[3/6] Classifying model type...');
    const modelType = modelSummary.model_type || 'generic';
    console.log(`   Model type: ${modelType} — ${modelSummary.industry || 'unknown'}`);

    const domain = loadDomainSkill(modelType);
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

    const t2Results  = await runTier2(parsed, { domain: domain.content, modelContext, keySheets: modelSummary.key_sheets, tier0Stats: tier0.stats, tier0Risks: tier0.riskIndicators });
    const t2Failures = t2Results.filter(r => r.status !== 'pass');

    console.log(`   Tier 1: ${t1Results.length - t1Failures.length} pass, ${t1Failures.length} fail`);
    console.log(`   Tier 2: ${t2Results.filter(r => r.status === 'pass').length} pass, ${t2Failures.length} issues`);

    // Deduplicate and collect all flagged items
    const allFailures  = [...t1Failures, ...t2Failures];
    const existingKeys = new Set();
    for (const f of allFailures) {
      const key = `${f.id}-${f.sheet || ""}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        allFlagged.push(f);
      }
    }
    console.log(`   ℹ️  ${allFlagged.length} items flagged`);
    // Per-rule outcomes for the Validation Matrix tab (pass + fail + uncertain)
    const ruleResults = [...t1Results, ...t2Results].map(r => ({
      id: r.id, status: r.status || 'uncertain',
      confidence: r.confidence ?? null, needs_retest: r.needs_retest ?? false
    }));


    // ── Step 6: Build report + upload + notify ─────────────────────────
    console.log('[6/6] Building report, uploading, notifying...');
    const baseName   = path.parse(originalName).name;
    const reportName = `${baseName}_VALIDATED.xlsx`;
    const reportPath = path.join(__dirname, 'processed', reportName);

    if (!fs.existsSync(path.join(__dirname, 'processed'))) {
      fs.mkdirSync(path.join(__dirname, 'processed'), { recursive: true });
    }


    // Build audit log for report
    const auditLog = [
      { timestamp: new Date().toISOString().substr(11,8), step: 'Parse', action: `Parsed ${parsed.sheetNames.length} sheets via exceljs`, artifact: originalName, result: '✓ Pass', duration: '', notes: `${parsed.sheetNames.length} sheets found` },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 0', action: `Formula text scan — ${tier0.stats.totalFormulaCells.toLocaleString()} formula cells`, artifact: 'All sheets scanned', result: '✓ Pass', duration: tier0.elapsed || '', notes: `${tier0.stats.uniqueFormulaCount} unique formulas · ${tier0.stats.totalIferrorCount.toLocaleString()} IFERROR · ${tier0.stats.totalExternalLinks} external links` },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Familiarise', action: 'Claude read all sheets', artifact: '~' + Math.round(JSON.stringify(modelSummary).length/3) + ' tokens', result: '✓ Pass', duration: '', notes: `${modelType} · ${modelSummary.currency || ''} · ${modelSummary.periodicity || ''}` },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Classify', action: 'Model type derived', artifact: domain.file + ' loaded', result: '✓ Pass', duration: '', notes: `Model type: ${modelType}` },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 1', action: `${t1Results.length} code checks`, artifact: `${t1Results.filter(r=>r.status==='pass').length} pass · ${t1Failures.length} fail`, result: t1Failures.length > 0 ? '⚠ Issues' : '✓ Pass', duration: '', notes: t1Failures.map(f=>f.id).join(', ') || 'All passed' },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 2', action: `Claude — 3 batches · 129 rules`, artifact: 'Batches 1-3', result: t2Failures.length > 0 ? '⚠ Issues' : '✓ Pass', duration: '', notes: `${t2Results.filter(r=>r.status==='pass').length} pass · ${t2Failures.length} issues` }
    ];

    // Extract overall assessment from Tier 2 meta
    const t2Meta = t2Results[0] && t2Results[0]._meta ? t2Results[0]._meta : {};
    const auditCompletion = t2Meta.audit_completion_percent || Math.round(((141 - allFlagged.length) / 141) * 100);
    const auditCommentary = t2Meta.audit_completion_commentary || `The audit file has completed ${auditCompletion}% of the planned review procedures. Open items are listed by priority below.`;
    const overallAssessment = 'audit_complete';
    const igReadiness = auditCompletion;
    const igCommentary = auditCommentary;

    await buildReportFile(reportPath, allFlagged, [], {
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
      // Local disk is a working directory only — the Drive copy (with its
      // own retention sweep) is the retained artefact. Remove the local
      // copy now that delivery succeeded; keep it on failure so nothing
      // is silently lost.
      fs.unlink(reportPath, () => {});
      logAuditEvent({ event: 'report_delivered', originalName, reportName, ip: clientIp, issueCount: allFlagged.length, runLog: runLog.filename });
    } catch (driveErr) {
      console.error('   ❌ Drive/notify error:', driveErr.message);
      logAuditEvent({ event: 'drive_upload_failed', originalName, reportName, ip: clientIp, error: driveErr.message, runLog: runLog.filename });
    }
    runLog.stop();

    const duration     = ((Date.now() - startTime) / 1000).toFixed(1);
    const c = require('./config/checklist.json');
    const totalChecked = c.tier1.length + c.tier2.length;
    const score        = totalChecked === 0
      ? 100
      : Math.round(((totalChecked - allFlagged.length) / totalChecked) * 100);
    // KPMG risk rating
    const p1Count = allFlagged.filter(f => f.priority === 'P1' || f.severity === 'fatal' || f.severity === 'critical').length;
    const p2Count = allFlagged.filter(f => f.priority === 'P2' || f.severity === 'high').length;
    const p3Count = allFlagged.filter(f => f.priority === 'P3' || (!f.priority && f.severity === 'low')).length;
    const riskRating = `P1: ${p1Count} · P2: ${p2Count} · P3: ${p3Count}`;

    console.log(`\n✅ Complete in ${duration}s — flagged: ${allFlagged.length}`);

    fs.unlink(filePath, () => {});

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
        total:          allFlagged.length,
        autoFixed:      0,
        needsAttention: allFlagged.length,
        score,
        riskRating,
        p1Count,
        p2Count,
        domainSkill: domain.file,
        tier0Stats: tier0.stats,
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

  } catch (error) {
    console.error('Fatal validation error:', error.message);
    console.error('Stack:', error.stack);
    logAuditEvent({ event: 'validation_error', originalName, ip: clientIp, error: error.message, runLog: runLog.filename });
    runLog.stop();
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

// ── Retention sweep — hourly, plus once on startup ─────────────────────────
const uploadsDir   = path.join(__dirname, 'uploads');
const processedDir = path.join(__dirname, 'processed');
runRetentionSweep({ uploadsDir, processedDir, folderId: FOLDER_ID }).catch(e => console.error('Startup retention sweep failed:', e.message));
cron.schedule('0 * * * *', () => {
  runRetentionSweep({ uploadsDir, processedDir, folderId: FOLDER_ID }).catch(e => console.error('Retention sweep failed:', e.message));
});

app.listen(PORT, () => console.log(`FM Validator running on http://localhost:${PORT}`));
module.exports = app;
