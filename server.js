require('dotenv').config();
const { execFile } = require('child_process');
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
const { acquireSlot }                = require('./src/utils/concurrency-limiter');
const { setProgress, clearProgress, getProgress } = require('./src/utils/run-progress');
const { verifyUploadIntegrity }      = require('./src/utils/upload-integrity-check');

// Core pipeline modules
const { parseExcel, scanFormulaErrors }                             = require('./src/parser');
const { detectRedundantInputs } = require('./src/utils/redundant-inputs');
const { detectOrphanSheets } = require('./src/utils/sheet-linkage');
const { detectNamedRangeIssues } = require('./src/utils/named-range-audit');
const { checkTotalRanges } = require('./src/utils/total-range-check');
const { checkSignConventions } = require('./src/utils/sign-convention-check');
const { checkNpvPeriodZeroRisk, checkIrrNegativeCashFlowRisk, checkIrrMultipleSignChangeRisk } = require('./src/utils/formula-logic-checks');
const { checkFlagProductErrorMasking } = require('./src/utils/flag-error-masking-check');
const { checkTextBooleanFlag } = require('./src/utils/text-boolean-flag-check');
const { checkAutoSumHeaderInclusion } = require('./src/utils/autosum-header-check');
const { checkFormulaPatternConsistency } = require('./src/utils/formula-pattern-consistency-check');
const { checkDaisyChains } = require('./src/utils/daisy-chain-check');
const { checkEmbeddedErrorBranches } = require('./src/utils/embedded-error-branch-check');
const { checkErrorLiteralInFormula } = require('./src/utils/error-literal-in-formula-check');
const { checkTwoDigitYearExtraction } = require('./src/utils/two-digit-year-check');
const { checkConstantFormulaCells } = require('./src/utils/constant-formula-check');
const { checkOverflowError } = require('./src/utils/overflow-error-check');
const { checkMixedReferences } = require('./src/utils/mixed-reference-check');
const { checkWhitespaceSheetNames } = require('./src/utils/whitespace-sheet-name-check');
const { checkHiddenFormulas } = require('./src/utils/hidden-formula-check');
const { checkDuplicateCalculationLogic } = require('./src/utils/duplicate-calculation-logic-check');
const { checkDsraSizing } = require('./src/utils/dsra-sizing-check');
const { checkComplexFormulas } = require('./src/utils/complex-formula-check');
const { checkNumbersStoredAsText } = require('./src/utils/number-as-text-check');
const { checkBalanceNeverNegative } = require('./src/utils/balance-never-negative-check');
const { checkDscrGatedDistributions } = require('./src/utils/dscr-gated-distributions-check');
const { checkLookupExactMatch } = require('./src/utils/lookup-exact-match-check');
const { checkPmtSignConsistency } = require('./src/utils/pmt-sign-convention-check');
const { checkTerminalPeriodCompleteness } = require('./src/utils/terminal-period-completeness-check');
const { checkTaxEffectiveRate } = require('./src/utils/tax-effective-rate-check');
const { checkRevenueDoubleCounting } = require('./src/utils/revenue-double-counting-check');
const { checkBlankCellReferences, groupBlankCellReferencesByTarget } = require('./src/utils/blank-cell-reference-check');
const { checkCrossCasting } = require('./src/utils/cross-cast-check');
const { checkColumnPatternConsistency } = require('./src/utils/column-pattern-consistency-check');
const { assignRecordTypes } = require('./src/utils/record-type-classifier');
const { assignRiskScores } = require('./src/utils/risk-scoring');
const { buildRootCauseFields } = require('./src/utils/root-cause-consolidation');
const { buildRootCauseFieldsFromResults } = require('./src/utils/root-cause-consolidation');
const { loadHistory: loadFindingHistory, saveHistory: saveFindingHistory, computeCrossRunStats, normalizeModelIdentity } = require('./src/utils/finding-history');
const { checkDisplayRoundsToZero } = require('./src/utils/display-rounds-to-zero-check');
const { checkCustomFormatUnitHiding } = require('./src/utils/custom-format-unit-hiding-check');
const { checkRevolverCashCrosscheck } = require('./src/utils/revolver-cash-crosscheck');
const { checkBlankCellBoundary } = require('./src/utils/blank-cell-boundary-check');
const { checkBalanceSheetPlug } = require('./src/utils/balance-sheet-plug-check');
const { checkPeriodSequenceGaps } = require('./src/utils/period-sequence-gap-check');
const { checkStdevaVaraUsage } = require('./src/utils/stdeva-vara-check');
const { checkDataValidationPresence } = require('./src/utils/data-validation-presence-check');
const { checkCellLockingGovernance } = require('./src/utils/cell-locking-governance-check');
const { checkKeyOutputChains } = require('./src/utils/key-output-chain-check');
const { checkBareNPV, checkNestedIFs, checkMergedCells, checkHiddenRowsColumns } = require('./src/utils/fast-standard-checks');
const { checkHardcodedCheckCells } = require('./src/utils/hardcoded-check-cells');
const { checkCircularReferences } = require('./src/utils/circular-reference-detector');
const { checkOffByOneRanges, checkAggregateResultMismatch, checkRangeIncludesOwnTotal, checkSuspiciousErrorMasking } = require('./src/utils/spreadsheet-auditor-checks');
const { checkPII } = require('./src/utils/pii-detection');
const { runFormulaDeepDive } = require('./src/validator-formula-deepdive');
const { runVbaReview } = require('./src/validator-vba');
const { checkWaccOverride, checkTerminalValueConcentration, checkOutputReasonableness, checkRevenuePerUnitMetric, checkTerminalValueCrossCheck, checkModelStatusFlag, checkNpvSignConsistency, checkValuationMethodDivergence, checkDebtYieldNegative } = require('./src/utils/reasonableness-checks');
const { checkDegenerateCovenantBranch } = require('./src/utils/degenerate-covenant-branch-check');
const { checkEquityComponentBackwardSolved } = require('./src/utils/equity-component-backward-solved-check');
const { checkMidRowFormulaRegimeChange } = require('./src/utils/mid-row-formula-regime-change-check');
const { checkZeroBaseRates } = require('./src/utils/zero-base-rate-check');
const { checkDateGatedRatioZero } = require('./src/utils/date-gated-ratio-zero-check');
const { checkExceptionStatusRows } = require('./src/utils/exception-status-check');
const { checkHardcodedMajorAsset } = require('./src/utils/hardcoded-major-asset-check');
const { checkMasterControlFailure } = require('./src/utils/master-control-failure-check');
const { checkImpossibleCountaTarget } = require('./src/utils/impossible-counta-target-check');
const { checkMismatchedBasisComparison } = require('./src/utils/mismatched-basis-comparison-check');
const { checkReleaseGateCoverage } = require('./src/utils/release-gate-coverage-check');
const { checkNonexistentSheetReferences } = require('./src/utils/nonexistent-sheet-reference-check');
const { checkFormulaCountReconciliation } = require('./src/utils/formula-count-reconciliation-check');
const { consolidateTier2Duplicates } = require('./src/utils/tier2-duplicate-consolidation');
const { computeFindingBreakdown, formatBreakdownLine } = require('./src/utils/finding-priority-breakdown');
const { checkErrorScanCoverage } = require('./src/utils/error-scan-coverage-check');
const { findOwnerDecisionChecklist } = require('./src/utils/owner-decision-checklist');
const { detectDuplicateSheets } = require('./src/utils/sheet-linkage');
const { familiariseModel, formatSummaryAsContext } = require('./src/familiariser');
const { loadDomainSkill, maybeQueueDomainDraft } = require('./src/classifier');
const { preValidate }                            = require('./src/pre-validator');
const { runTier1 }                               = require('./src/validator-tier1');
const { runTier0 }                               = require('./src/validator-tier0');
const { shouldUseFullParseRoute }                = require('./src/utils/formula-token-estimator');
const { runTier2, resolveDeepAccountingSheets } = require('./src/validator-tier2');
const { buildReportFile }                        = require('./src/report-tab');
const { uploadBothFiles }                        = require('./src/writer');
const { sendNotification, sendOrderConfirmation, sendReportReadyEmail, sendAdminOrderNotification } = require('./src/notifier');
const { createOrder, getOrder, updateOrder }      = require('./src/utils/order-store');
const { chargeViaEway }                           = require('./src/utils/eway-payment');

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
// Extended to cover the endpoints the public submission form calls
// directly — previously only /api/validate had this applied, which was
// fine while Basic Auth gated the whole path, but these two become
// reachable with no login at all once the public form goes live.
app.use('/api/verify-upload', limiter);
app.use('/api/unique-formulas', limiter);
app.use('/api/submit-order', limiter);

// Tighter, additional limit specifically on FAILED payment attempts —
// this endpoint moves real money, and card-testing/fraud has a
// different risk shape than someone just hammering an upload check.
// skipSuccessfulRequests means genuine successful orders never count
// toward this stricter limit, only declines/errors do.
const paymentAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { error: 'Too many failed payment attempts — please try again later or contact support.' },
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/submit-order', paymentAttemptLimiter);

// ── API key auth middleware ────────────────────────────────────────────────
function requireApiKey(req, res, next) {
  const API_KEY = process.env.VALIDATOR_API_KEY;
  // If no API key configured, allow all (dev mode)
  if (!API_KEY) return next();

  // The x-api-key gate is for programmatic/API callers (curl, integrations,
  // future clients) — NOT the first-party browser UI, which never embeds
  // the key (that would expose it in public HTML/JS). Exempt same-origin
  // browser requests, identified by Origin/Referer matching this server's
  // own allowed origins.
  const originHeader = req.headers.origin ||
    (req.headers.referer ? (() => { try { return new URL(req.headers.referer).origin; } catch (_) { return null; } })() : null);
  if (originHeader && allowedOrigins.includes(originHeader)) return next();

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
    // Extension is the single source of truth — browser MIME labels for
    // Excel formats vary between browsers/OSes, and 'spreadsheet' also
    // matches .ods, which the parser cannot read. The parser supports
    // xlsx/xlsm natively and converts xlsb/xls via SheetJS.
    const ok = /\.(xlsx|xlsm|xlsb|xls)$/i.test(file.originalname);
    ok ? cb(null, true) : cb(new Error('Only .xlsx, .xlsm, .xlsb and .xls files are allowed'), false);
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
// FIX: pricing-per-F-score-band is a business decision, not something
// inferrable from the UI mockup alone — isolated here as a single named
// constant so real figures can be swapped in later without touching the
// route logic below. Values are illustrative placeholders.
const FSCORE_BAND_PRICE = { Low: 3, Moderate: 4, High: 6, Critical: 7 };

// Shared by both /api/unique-formulas and /api/submit-order's server-side
// price re-verification — extracted specifically so both call sites can
// never drift out of sync with each other.
function calculatePricing(fscoreDist) {
  const priceTotal = Object.entries(fscoreDist)
    .reduce((sum, [band, count]) => sum + count * (FSCORE_BAND_PRICE[band] || 0), 0);
  const gstTotal = Math.round(priceTotal * 0.1);
  const grandTotal = priceTotal + gstTotal;
  return { priceTotal, gstTotal, grandTotal };
}

// Unique-formula + F-score estimate — deliberately stops after Tier 0's
// formula scan (deterministic, local, no Anthropic API call) rather than
// running the full pipeline, so this is fast and free of API cost, per
// the "unique formula" feature's own design requirement (confirmed
// directly against validator-tier0.js: uniqueFormulaCount and fscoreDist
// are both computed purely from formula-text pattern normalization,
// before familiarisation or Tier 2 ever run).
app.post('/api/verify-upload', requireApiKey, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ passed: false, code: 'NO_FILE', message: 'No file was uploaded.' });
  }

  const filePath     = req.file.path;
  const originalName = req.file.originalname;
  const clientIp      = getClientIp(req);

  function sanitizeChecksForResponse(checks) {
    return checks.map(({ check, status, detail }) => ({ check, status, detail }));
  }

  try {
    const result = await verifyUploadIntegrity(filePath, originalName);

    if (result.checks.some(c => c.logDetail)) {
      console.log('   Upload verification detail:', result.checks.filter(c => c.logDetail).map(c => `${c.check}: ${c.logDetail}`).join(' | '));
    }

    logAuditEvent({
      event: result.passed ? 'upload_verified' : 'upload_verification_failed',
      originalName, ip: clientIp, code: result.code || null,
    });

    if (!result.passed) {
      fs.unlink(filePath, () => {});
      return res.status(200).json({
        passed: false, code: result.code, message: result.message ?? result.reason, checks: sanitizeChecksForResponse(result.checks),
      });
    }

    res.status(200).json({
      passed: true, code: null, checks: sanitizeChecksForResponse(result.checks),
      storedAs: path.basename(filePath),
    });
  } catch (err) {
    console.error('   \u26a0\ufe0f  Upload verification crashed:', err.message);
    fs.unlink(filePath, () => {});
    res.status(500).json({ passed: false, code: 'INTERNAL_ERROR', message: 'Something went wrong checking your file. Please try again.' });
  }
});

app.post('/api/unique-formulas', requireApiKey, upload.single('file'), async (req, res) => {
  let filePath, originalName, shouldCleanup;

  if (req.file) {
    filePath = req.file.path;
    originalName = req.file.originalname;
    shouldCleanup = true;
  } else if (req.body.storedAs) {
    // Reuse a file already verified by /api/verify-upload instead of
    // re-uploading the same bytes a second time. path.basename() strips
    // any directory-traversal attempt (e.g. "../../etc/passwd") before
    // this ever touches the filesystem — never trust a client-supplied
    // filename directly in a path join.
    const safeFilename = path.basename(req.body.storedAs);
    filePath = path.join(__dirname, 'uploads', safeFilename);
    originalName = safeFilename;
    shouldCleanup = false; // not ours to delete — /api/verify-upload owns this file's lifecycle
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ status: 'error', message: 'Referenced file not found — it may have expired or already been processed. Please re-upload.' });
    }
  } else {
    return res.status(400).json({ status: 'error', message: 'No file uploaded' });
  }

  try {
    const parsed = await parseExcel(filePath);
    const tier0  = await runTier0(parsed);
    const fscoreDist = (tier0.stats && tier0.stats.fscoreDist) || { Low: 0, Moderate: 0, High: 0, Critical: 0 };
    const uniqueFormulaTotal = (tier0.stats && tier0.stats.uniqueFormulaCount) || 0;
    const { priceTotal, gstTotal, grandTotal } = calculatePricing(fscoreDist);

    res.json({
      status: 'success',
      originalName,
      uniqueFormulaTotal,
      fscoreDist,
      priceTotal,
      gstTotal,
      grandTotal,
      pricePerBand: FSCORE_BAND_PRICE
    });
  } catch (err) {
    console.error('   \u26a0\ufe0f  Unique-formula estimate failed:', err.message);
    res.status(500).json({ status: 'error', message: err.message || 'Could not scan the file.' });
  } finally {
    if (shouldCleanup) fs.unlink(filePath, () => {});
  }
});

// Well-formed-syntax-only check, matching the confirmed decision — no
// existing-customer lookup, no deliverability verification.
const EMAIL_SYNTAX_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/submit-order', requireApiKey, async (req, res) => {
  const { storedAs, fullName, company, email, eWayEncryptedPayload, quotedGrandTotal } = req.body || {};
  const clientIp = getClientIp(req);

  // ── Validate the basics before touching the filesystem or Anthropic-adjacent work ──
  if (!storedAs || typeof storedAs !== 'string') {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'No file reference provided.' });
  }
  if (!fullName || !company || !email) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Full name, company, and email are all required.' });
  }
  if (!EMAIL_SYNTAX_RE.test(String(email).trim())) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Please provide a valid email address.' });
  }
  if (!eWayEncryptedPayload) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'No payment information provided.' });
  }
  if (!Number.isFinite(quotedGrandTotal)) {
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Missing or invalid quoted price.' });
  }

  // ── Resolve the file safely — same path-traversal guard as /api/unique-formulas ──
  const safeFilename = path.basename(storedAs);
  const filePath = path.join(__dirname, 'uploads', safeFilename);
  if (!fs.existsSync(filePath)) {
    // Matches the confirmed decision directly: no order ID is ever
    // created for a file that isn't a genuine, currently-staged,
    // already-verified upload.
    return res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'Referenced file not found — it may have expired. Please re-upload and try again.' });
  }

  // ── Security requirement, not optional: re-verify the price server-side
  //    against the actual file, never trust a client-supplied amount ──
  let grandTotal, uniqueFormulaTotal, fscoreDist, fileSizeBytes;
  try {
    const parsed = await parseExcel(filePath);
    const tier0 = await runTier0(parsed);
    fscoreDist = (tier0.stats && tier0.stats.fscoreDist) || { Low: 0, Moderate: 0, High: 0, Critical: 0 };
    uniqueFormulaTotal = (tier0.stats && tier0.stats.uniqueFormulaCount) || 0;
    fileSizeBytes = fs.statSync(filePath).size;
    ({ grandTotal } = calculatePricing(fscoreDist));
  } catch (err) {
    console.error('   \u26a0\ufe0f  Price re-verification failed:', err.message);
    return res.status(500).json({ success: false, code: 'VALIDATION_ERROR', message: 'Could not verify pricing for this file. Please try again.' });
  }

  if (grandTotal !== quotedGrandTotal) {
    console.error(`   \u26a0\ufe0f  Price mismatch on order attempt: quoted ${quotedGrandTotal}, actual ${grandTotal} (${safeFilename}, ip ${clientIp})`);
    return res.status(400).json({ success: false, code: 'PRICE_MISMATCH', message: 'The quoted price no longer matches this file. Please refresh and try again.' });
  }

  // ── Charge via eWay — PLACEHOLDER, see src/utils/eway-payment.js ──
  let chargeResult;
  try {
    chargeResult = await chargeViaEway(eWayEncryptedPayload, grandTotal);
  } catch (err) {
    // Distinguishing a genuine decline from "not wired up yet" matters —
    // once real eWay integration lands, only genuine declines should
    // reach this path.
    console.error('   \u26a0\ufe0f  Payment processing error:', err.message);
    return res.status(502).json({ success: false, code: 'PAYMENT_DECLINED', message: 'Payment could not be processed. Please try again shortly.' });
  }
  if (!chargeResult || !chargeResult.success) {
    return res.status(402).json({ success: false, code: 'PAYMENT_DECLINED', message: (chargeResult && chargeResult.declineReason) || 'Your payment was declined.' });
  }

  // ── Payment succeeded — create the order and trigger both emails ──
  let order;
  try {
    order = createOrder({
      fullName, company, email,
      originalName: safeFilename,
      storedAs: safeFilename,
      grandTotal,
      uniqueFormulaTotal,
      fscoreDist,
      fileSizeBytes,
      transactionId: chargeResult.transactionId,
      ip: clientIp,
    });
  } catch (err) {
    console.error('   \u26a0\ufe0f  Order creation failed after successful payment:', err.message);
    return res.status(500).json({ success: false, code: 'VALIDATION_ERROR', message: 'Payment succeeded but the order could not be recorded. Please contact support with your transaction reference.' });
  }

  logAuditEvent({ event: 'order_created', orderId: order.orderId, originalName: safeFilename, ip: clientIp, grandTotal });

  sendOrderConfirmation(order).catch(() => {});
  sendAdminOrderNotification(order).catch(() => {});

  res.json({ success: true, orderId: order.orderId });
});

app.get('/api/view-log/:orderId', requireApiKey, (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order || !order.runLogFilename) {
    return res.status(404).json({ error: 'No log available for this order yet.' });
  }
  // Defensive path.basename() even though this value is our own
  // generated filename, not direct user input — matching the same safe
  // pattern used everywhere else in this project.
  const safeFilename = path.basename(order.runLogFilename);
  const logPath = path.join(__dirname, 'logs', 'runs', safeFilename);
  if (!fs.existsSync(logPath)) {
    return res.status(404).json({ error: 'Log file no longer exists on disk.' });
  }
  res.type('text/plain').send(fs.readFileSync(logPath, 'utf8'));
});

app.get('/api/download-report/:orderId', requireApiKey, (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order || !order.reportName) {
    return res.status(404).json({ error: 'No report available for this order yet.' });
  }
  const safeFilename = path.basename(order.reportName);
  const reportPath = path.join(__dirname, 'processed', safeFilename);
  if (!fs.existsSync(reportPath)) {
    return res.status(404).json({ error: 'Report file no longer exists on disk.' });
  }
  res.download(reportPath, safeFilename);
});

app.post('/api/send-report-email/:orderId', requireApiKey, async (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }
  if (!order.email) {
    return res.status(400).json({ error: 'This order has no email address on file (may have been PII-scrubbed).' });
  }
  const result = await sendReportReadyEmail(order);
  if (result.error) {
    return res.status(502).json({ error: result.error });
  }
  if (result.skipped) {
    return res.status(200).json({ skipped: true, message: 'Email sending is not configured on this server.' });
  }
  res.json({ success: true });
});

app.get('/api/run-progress/:runId', (req, res) => {
  const progress = getProgress(req.params.runId);
  if (!progress) {
    return res.status(404).json({ error: 'No progress found for this run.' });
  }
  res.json(progress);
});

app.post('/api/validate', requireApiKey, upload.single('file'), async (req, res) => {
  let filePath, originalName, shouldCleanup;

  if (req.file) {
    filePath = req.file.path;
    originalName = req.file.originalname;
    shouldCleanup = true;
  } else if (req.body.storedAs) {
    // Admin-dashboard-triggered run against an already-staged order
    // file — never delete it afterward, since it's tied to a permanent
    // order record and needs to survive until the separate, already-
    // scoped 2-week retention job, not get removed after one run.
    const safeFilename = path.basename(req.body.storedAs);
    filePath = path.join(__dirname, 'uploads', safeFilename);
    originalName = safeFilename;
    shouldCleanup = false;
    if (!fs.existsSync(filePath)) {
      return res.status(400).json({ status: 'error', message: 'Referenced file not found — it may have expired or already been processed.' });
    }
  } else {
    return res.status(400).json({ status: 'error', message: 'No file uploaded' });
  }
  const runId         = req.body.orderId || originalName;
  const startTime    = Date.now();
  const clientIp      = getClientIp(req);
  const runLog        = startRunLog(originalName);
  let slot              = null;
  try {
    slot = await acquireSlot(originalName);
  } catch (slotErr) {
    // acquireSlot() only reaches here on a genuine filesystem error
    // (e.g. EACCES/ENOSPC) — the normal "slot currently taken" case is
    // handled internally via retry and never throws. Caught here,
    // specifically, because this call sits before the main pipeline's
    // try block below and would otherwise be an unhandled rejection
    // with the multer-uploaded file never cleaned up.
    console.error('   ❌ Could not acquire a validation slot:', slotErr.message);
    logAuditEvent({ event: 'slot_acquisition_failed', originalName, ip: clientIp, error: slotErr.message, runLog: runLog.filename });
    runLog.stop();
    if (shouldCleanup) fs.unlink(filePath, () => {});
    return res.status(500).json({ status: 'error', message: 'Could not start validation — server resource issue. Please try again shortly.' });
  }

  logAuditEvent({
    event: 'upload_received', originalName, storedAs: path.basename(filePath),
    ip: clientIp, sizeBytes: fs.statSync(filePath).size, runLog: runLog.filename
  });

  console.log(`\n─────────────────────────────────────`);
  console.log(`FM VALIDATOR — ${originalName}`);
  console.log(`─────────────────────────────────────`);

  try {
    // ── Step 1: Parse ──────────────────────────────────────────────────
    console.log('[1/6] Parsing file...');
    setProgress(runId, 1, 'Parsing file');
    const parsed = await parseExcel(filePath);
    console.log(`   Found ${parsed.sheetNames.length} sheets`);

    // ── Step 1.5: Tier 0 — Formula text scan ──────────────────────────
    console.log('[1.5/6] Scanning formula text...');
    setProgress(runId, 1.5, 'Scanning formula text');
    const tier0 = await runTier0(parsed);

    // FIX (Phase 2.1): funnel routing decision, matching index.js exactly.
    const funnelDecision = shouldUseFullParseRoute(parsed._raw);
    console.log(`   Funnel routing: ${funnelDecision.useFullParse ? 'FULL-PARSE' : 'CURATED'} route (~${funnelDecision.estimate.estimatedTokens.toLocaleString()} estimated raw-formula tokens vs ${funnelDecision.threshold.toLocaleString()} threshold)`);

    // Opt-in only — this is an additional-cost, additional-time review
  // beyond the standard run. Off by default; set ENABLE_FORMULA_DEEPDIVE=true
  // (or pass formulaDeepDive:true in the request body, for server.js) to enable.
  const wantsDeepDive = process.env.ENABLE_FORMULA_DEEPDIVE === 'true' || (req.body && req.body.formulaDeepDive === true);
  // Wave 1 reasonableness checks — deterministic, always on (unlike
  // Formula Deep Dive these are cheap and don't need an opt-in gate).
  const reasonableness = (() => { try { return {
    waccOverride: checkWaccOverride(parsed._raw),
    terminalValue: checkTerminalValueConcentration(parsed._raw),
    outputs: checkOutputReasonableness(parsed._raw),
    revenuePerUnit: checkRevenuePerUnitMetric(parsed._raw),
    terminalValueCrossCheck: checkTerminalValueCrossCheck(parsed._raw),
    modelStatusFlag: checkModelStatusFlag(parsed._raw),
    npvSignConsistency: checkNpvSignConsistency(parsed._raw),
    valuationMethodDivergence: checkValuationMethodDivergence(parsed._raw),
    debtYieldNegative: checkDebtYieldNegative(parsed._raw)
  }; } catch (e) { console.error('   \u26a0\ufe0f  Reasonableness checks failed:', e.message);
    return { waccOverride:{applicable:false}, terminalValue:{applicable:false}, outputs:{applicable:false}, revenuePerUnit:{applicable:false}, terminalValueCrossCheck:{applicable:false}, modelStatusFlag:{applicable:false}, npvSignConsistency:{applicable:false}, valuationMethodDivergence:{applicable:false}, debtYieldNegative:{applicable:false} }; } })();
  const duplicateSheets = (() => { try { return detectDuplicateSheets(parsed.sheetNames); }
    catch (e) { console.error('   \u26a0\ufe0f  Duplicate-sheet scan failed:', e.message); return { applicable:false, flaggedCount:0, flagged:[] }; } })();
  const degenerateCovenantBranch = (() => { try { return checkDegenerateCovenantBranch(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Degenerate covenant branch scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const equityComponentBackwardSolved = (() => { try { return checkEquityComponentBackwardSolved(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Equity-component backward-solve scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const midRowFormulaRegimeChange = (() => { try { return checkMidRowFormulaRegimeChange(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Mid-row formula regime-change scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const zeroBaseRates = (() => { try { return checkZeroBaseRates(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Zero-base-rate scan failed:', e.message); return { applicable:false, found:false, candidates:[] }; } })();
  const dateGatedRatioZero = (() => { try { return checkDateGatedRatioZero(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Date-gated ratio scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const exceptionStatusRows = (() => { try { return checkExceptionStatusRows(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Exception-status scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const hardcodedMajorAsset = (() => { try { return checkHardcodedMajorAsset(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Hardcoded-major-asset scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const masterControlFailure = (() => { try { return checkMasterControlFailure(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Master-control-failure scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const impossibleCountaTarget = (() => { try { return checkImpossibleCountaTarget(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Impossible-COUNTA-target scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const mismatchedBasisComparison = (() => { try { return checkMismatchedBasisComparison(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Mismatched-basis-comparison scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const releaseGateCoverage = (() => { try { return checkReleaseGateCoverage(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Release-gate-coverage scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const nonexistentSheetReferences = (() => { try { return checkNonexistentSheetReferences(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Nonexistent-sheet-reference scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const formulaCountReconciliation = (() => { try { return checkFormulaCountReconciliation(parsed._raw, tier0.stats); }
    catch (e) { console.error('   \u26a0\ufe0f  Formula-count-reconciliation scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const formulaDeepDive = wantsDeepDive
    ? await (async () => { try { return await runFormulaDeepDive(parsed, tier0, {}); }
        catch (e) { console.error('   \u26a0\ufe0f  Formula Deep Dive failed:', e.message); return { applicable:false, note:e.message, reviewed:0, findings:[] }; } })()
    : { applicable:false, note:'Not requested for this run.', reviewed:0, findings:[] };
  const errorScan = (() => { try { return scanFormulaErrors(parsed._raw); } catch (e) { console.error('   \u26a0\ufe0f  Error scan failed:', e.message); return []; } })();
  const redundantInputs = (() => { try { return detectRedundantInputs(parsed._raw); } catch (e) { console.error('   \u26a0\ufe0f  Redundant-input scan failed:', e.message); return { applicable:false, note:e.message, totalInputs:0, redundantCount:0, redundant:[], inputSheets:[] }; } })();
  const orphanSheets = (() => { try { return detectOrphanSheets(tier0.dependencyMap, parsed.sheetNames, redundantInputs.inputSheets || []); } catch (e) { console.error('   \u26a0\ufe0f  Orphan-sheet scan failed:', e.message); return { applicable:false, note:e.message, orphanSheets:[], financialStatementSheets:[], reachableSheets:[], totalSheets:0 }; } })();
  const namedRangeAudit = (() => { try { return detectNamedRangeIssues(parsed._raw, parsed._filePath); } catch (e) { console.error('   \u26a0\ufe0f  Named-range audit failed:', e.message); return { applicable:false, note:e.message, unused:[], poorlyNamed:[], broken:[], totalNamedRanges:0 }; } })();
  const errorScanCoverage = (() => { try { return checkErrorScanCoverage(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Error-scan-coverage scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  const ownerDecisionChecklist = (() => { try { return findOwnerDecisionChecklist(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Owner-decision-checklist scan failed:', e.message); return null; } })();
    // Wave 2 — VBA/macro review. Deterministic (not opt-in, unlike Formula
    // Deep Dive) but genuinely async since it spawns a Python subprocess,
    // so it needs its own await rather than fitting the synchronous IIFE
    // pattern the checks above use. Uses the multer upload path directly
    // (filePath), same file parseExcel() just read.
    const vbaReview = await (async () => { try { return await runVbaReview(filePath); }
      catch (e) { console.error('   \u26a0\ufe0f  VBA/macro review failed:', e.message); return { applicable:false, note:e.message, hasVbaProject:false, findings:[] }; } })();

    // Encrypted workbook — stop here rather than continue into Familiarise/
    // Tier 1/Tier 2 against a file we've already confirmed we can't fully
    // see into for macro content. A report produced past this point would
    // implicitly claim coverage it doesn't have.
    if (vbaReview.blockValidation) {
      console.log('   ❌ Workbook is password-encrypted — stopping validation');
      logAuditEvent({ event: 'vba_encrypted_blocked', originalName, ip: clientIp, runLog: runLog.filename });
      runLog.stop();
      if (slot) slot.release();
      clearProgress(runId);
      if (req.body.orderId) updateOrder(req.body.orderId, { runLogFilename: runLog.filename });
      return res.json({
        status: 'vba-encrypted',
        message: 'This workbook is password-encrypted, so its VBA/macro content cannot be verified without the password. Please provide an unencrypted copy, or the password, to proceed with validation.',
        modelType: null,
        modelIndustry: null,
        stats: { total: 0, autoFixed: 0, needsAttention: 0, score: 0 },
        runLogFilename: runLog.filename,
      });
    }

    // Check for potential formula caching issue — if many formulas but few errors
    // detected, warn that cached values may be missing
    if (tier0.stats.totalFormulaCells > 10000 && tier0.stats.totalRefInFormula === 0) {
      console.log('   ℹ️  Note: No #REF! detected in formula text. If the model has known errors,');
      console.log('   ℹ️  ensure the file was saved in Excel with calculation enabled (F9 before save).');
    }
    // ── Step 2: Familiarise ────────────────────────────────────────────
    console.log('[2/6] Familiarising with the model...');
    setProgress(runId, 2, 'Familiarising with the model');
    const modelSummary = await familiariseModel(parsed);
    const modelContext = formatSummaryAsContext(modelSummary);

    // ── Step 3: Classify + load domain skill ──────────────────────────
    console.log('[3/6] Classifying model type...');
    setProgress(runId, 3, 'Classifying model type');
    const modelType = modelSummary.model_type || 'generic';
    console.log(`   Model type: ${modelType} — ${modelSummary.industry || 'unknown'}`);

    const domain = loadDomainSkill(modelType);
    console.log(`   Domain skill loaded: ${domain.file}`);

    // Opportunistic, non-blocking: if this model type has no dedicated
    // skill yet, queue a draft for future review. Never awaited.
    maybeQueueDomainDraft(modelType, modelSummary, parsed.sheetNames, domain);

    // ── Step 4: Pre-validation gate ────────────────────────────────────
    console.log('[4/6] Pre-validation gate...');
    setProgress(runId, 4, 'Pre-validation gate');
    const preResult = preValidate(parsed, { tier0Stats: tier0.stats, modelSummary });
    if (!preResult.passed) {
      const failures = preResult.results.filter(r => r.status === 'fail');
      console.log(`   ❌ Pre-validation failed — ${failures.length} issues`);
      clearProgress(runId);
      if (req.body.orderId) updateOrder(req.body.orderId, { runLogFilename: runLog.filename });
      return res.json({
        status: 'pre-validation-failed',
        message: 'File failed pre-validation checks',
        modelType,
        modelIndustry: modelSummary.industry,
        failures: failures.map(f => ({ check: f.check, reason: f.reason })),
        stats: { total: failures.length, autoFixed: 0, needsAttention: failures.length, score: 0 },
        runLogFilename: runLog.filename,
      });
    }
    console.log('   ✅ Pre-validation passed');
    (preResult.warnings || []).forEach(w => console.log('   ⚠️  ' + w));

    // ── Step 5: Validation ─────────────────────────────────────────────
    console.log('[5/6] Running validation...');
    setProgress(runId, 5, 'Running validation (this is the longest step)');
    let allFlagged = [];

    const t1Results  = runTier1(parsed);
    const t1Failures = t1Results.filter(r => r.status === 'fail');

    const t2Results  = await runTier2(parsed, { domain: domain.content, domainFile: domain.file, modelContext, keySheets: modelSummary.key_sheets, tier0Stats: tier0.stats, tier0Risks: tier0.riskIndicators, namedRangeAudit, vbaReview, useFullParse: funnelDecision.useFullParse });
    const t2FailuresRaw = t2Results.filter(r => r.status !== 'pass');
    // FIX (I-11): found via an independent review confirming at least
    // 3 Tier 2 findings explicitly self-identify as duplicates of
    // another finding (Tier 2's own text literally begins "Same as
    // T2-XXX"), inflating the headline count even though Tier 2
    // itself already recognized them as the same root cause.
    const { consolidated: t2Failures, removed: t2DuplicatesRemoved } = (() => {
      try { return consolidateTier2Duplicates(t2FailuresRaw); }
      catch (e) { console.error('   \u26a0\ufe0f  Tier 2 duplicate consolidation failed:', e.message); return { consolidated: t2FailuresRaw, removed: [] }; }
    })();
    if (t2DuplicatesRemoved.length > 0) {
      console.log(`   \u2139\ufe0f  ${t2DuplicatesRemoved.length} Tier 2 finding(s) consolidated \u2014 self-identified by Tier 2 itself as "Same as" another finding, so counted once, not separately`);
    }

    console.log(`   Tier 1: ${t1Results.length - t1Failures.length} pass, ${t1Failures.length} fail`);
    console.log(`   Tier 2: ${t2Results.filter(r => r.status === 'pass').length} pass, ${t2Failures.length} issues`);

    // Deduplicate and collect all flagged items
    const allFailures  = [...t1Failures, ...t2Failures];
    const existingKeys = new Set();
    for (const f of allFailures) {
      // FIX: found via a real bug-scan run — server.js still had the old
      // version of this key, which collapsed to "undefined-SheetName"
      // when f.id was missing, letting two different id-less findings
      // collide and silently drop one. Mirrors the same fix already
      // applied to index.js.
      const key = `${f.id || f.reason || f.label || JSON.stringify(f)}-${f.sheet || ""}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        allFlagged.push(f);
      }
    }
    // Captured here, before any T0-* deterministic findings (redundant
    // inputs, orphan sheets, named ranges, reasonableness, duplicate
    // sheets, VBA review, etc.) get pushed below. Those checks aren't part
    // of the 141-rule checklist, so they must not dilute the score/
    // completion % computed against it later — allFlagged.length keeps
    // growing below, but this snapshot stays fixed at the true
    // checklist-rule count.
    const checklistFindingCount = allFlagged.length;
  // Redundant-input finding (V11 §2) — deterministic; flows through the register.
  if (redundantInputs.applicable && redundantInputs.redundantCount > 0) {
    const _locs = redundantInputs.redundant.slice(0, 15).map(x => `${x.sheet}!${x.cell}`).join(', ');
    const _more = redundantInputs.redundantCount > 15 ? ` and ${redundantInputs.redundantCount - 15} more` : '';
    const _ratio = redundantInputs.redundantCount / Math.max(redundantInputs.totalInputs, 1);
    allFlagged.push({
      id: 'T0-RI-001',
      label: `${redundantInputs.redundantCount} input-sheet constant(s) not referenced by any formula`,
      severity: _ratio > 0.2 ? 'high' : 'medium',
      status: 'fail',
      sheet: redundantInputs.inputSheets[0],
      cell: (redundantInputs.redundant[0] || {}).cell || 'A1',
      condition: `${redundantInputs.redundantCount} of ${redundantInputs.totalInputs} numeric constants on ${redundantInputs.inputSheets.join(', ')} are not referenced by any static formula reference (including ranges, whole columns/rows and defined names): ${_locs}${_more}. ${redundantInputs.note}`,
      reason: `${redundantInputs.redundantCount} of ${redundantInputs.totalInputs} input constants unreferenced — examples: ${_locs}${_more}`,
      corrective_action: 'For each listed input: link it into the calculation chain, remove it, or relabel it as a memo item. Every retained assumption must demonstrably drive the model.',
      workstream: 'Inputs', category: 'Structure', issue_type: 'Redundant input',
      model_risk: 'Users may believe these assumptions drive the forecast when they affect nothing — scenario analysis over these inputs is meaningless and conclusions drawn from it unsafe.',
      key_output_impact: 'No', method: 'automated', needs_retest: true,
      root_cause: 'Orphaned / unlinked input', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 95
    });
  }
  // Orphan-sheet finding — deterministic; a whole calculation area that
  // never reaches the financial statements is more serious than a single
  // unused input, so this gets its own T1-level treatment.
  if (orphanSheets.applicable && orphanSheets.orphanSheets.length > 0) {
    const _sheets = orphanSheets.orphanSheets.join(', ');
    allFlagged.push({
      id: 'T0-LINK-001',
      label: `${orphanSheets.orphanSheets.length} sheet(s) have no traceable path to a financial statement`,
      severity: 'critical',
      status: 'fail',
      sheet: orphanSheets.orphanSheets[0],
      cell: 'A1',
      condition: `The following sheet(s) contain formulas but have no static reference path (direct or indirect, including named ranges) to a detected financial-statement sheet (${orphanSheets.financialStatementSheets.join(', ')}): ${_sheets}. ${orphanSheets.note}`,
      reason: `${orphanSheets.orphanSheets.length} sheet(s) not traceable to financial statements: ${_sheets}`,
      corrective_action: 'For each listed sheet: confirm whether it should feed the financial statements and link it in, or document why it is intentionally standalone.',
      workstream: 'Structure', category: 'Linkage', issue_type: 'Orphan sheet',
      model_risk: 'This sheet may calculate real values that never reach the reported outputs — assumptions here can be changed with no visible effect on the model, or a genuine result may be silently missing from the financial statements.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Sheet not linked to financial statements', escalation_flag: true,
      urgency: 'Before next reliance', confidence: 90
    });
  }
  // Named-range findings — unused (P2, may include legitimate benign
  // cases) and broken (P1, unambiguously wrong) get separate findings so
  // severity isn't diluted by mixing them.
  if (namedRangeAudit.applicable && namedRangeAudit.broken.length > 0) {
    const names = namedRangeAudit.broken.map(b => b.name).join(', ');
    allFlagged.push({
      id: 'T0-NR-001',
      label: `${namedRangeAudit.broken.length} named range(s) point to a broken or deleted reference`,
      severity: 'critical', status: 'fail',
      sheet: '', cell: 'A1', category: 'Linkage',
      condition: `The following named range(s) no longer resolve to a valid location: ${names}. Any formula that used to reference these would show #REF!/#NAME? errors.`,
      reason: `${namedRangeAudit.broken.length} broken named range(s): ${names}`,
      corrective_action: 'Repair or remove each broken named range; check whether any formula was relying on it before the underlying range was deleted.',
      workstream: 'Structure', category: 'Linkage', issue_type: 'Broken named range',
      model_risk: 'A broken named range signals a structural change (deleted sheet/range) that was not fully cleaned up — worth checking nothing else was silently affected.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Named range reference invalid', escalation_flag: true,
      urgency: 'Before next reliance', confidence: 95
    });
  }
  // Cross-reference broken named ranges against real VBA source code -
  // found and independently verified on a real production run: 3 of 8
  // broken names were confirmed, verbatim, actively referenced by
  // Range("Name").Select calls in real macro code, which would genuinely
  // crash at runtime - a defect the broken-name check above and the VBA
  // review each separately report without ever connecting the two.
  // Word-boundary matching (\b) avoids a broken name like "II_SO"
  // incorrectly matching inside an unrelated longer identifier.
  if (namedRangeAudit.applicable && namedRangeAudit.broken.length > 0 &&
      vbaReview.applicable && vbaReview.hasVbaProject && Array.isArray(vbaReview.modules)) {
    const calledBrokenNames = [];
    for (const brokenName of namedRangeAudit.broken.map(b => b.name)) {
      const pattern = new RegExp(`\\b${brokenName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      const callingModules = vbaReview.modules
        .filter(m => pattern.test(m.sourceCode || ''))
        .map(m => m.name);
      if (callingModules.length > 0) {
        calledBrokenNames.push({ name: brokenName, modules: callingModules });
      }
    }
    if (calledBrokenNames.length > 0) {
      const nameList = calledBrokenNames.map(c => `${c.name} (called from ${c.modules.join(', ')})`).join('; ');
      allFlagged.push({
        id: 'T0-VBA-NR-001',
        label: `${calledBrokenNames.length} broken named range(s) are actively called by VBA macro code`,
        severity: 'critical', status: 'fail',
        sheet: '', cell: 'A1', category: 'Linkage',
        condition: `The following broken named range(s) are directly referenced by Range("Name") calls in real VBA code, not just present in the workbook's name list: ${nameList}. Since the name no longer resolves, this line will raise a runtime error the moment the macro executes it.`,
        reason: `${calledBrokenNames.length} broken named range(s) actively called by VBA: ${nameList}`,
        corrective_action: 'Repair or remove each of these named ranges specifically before the macro is next run - this is not a cosmetic defect, the macro will fail to complete.',
        workstream: 'Structure', category: 'Linkage', issue_type: 'Broken named range called by macro',
        model_risk: 'A macro that runs on file open, on a button click, or on a scheduled trigger will error out partway through, potentially leaving the workbook in a partially-updated, inconsistent state.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: 'Named range reference invalid and actively used by VBA', escalation_flag: true,
        urgency: 'Before next reliance', confidence: 95
      });
    }
  }
  if (namedRangeAudit.applicable && namedRangeAudit.unused.length > 0) {
    const names = namedRangeAudit.unused.slice(0, 8).map(u => u.name).join(', ');
    allFlagged.push({
      id: 'T0-NR-002',
      label: `${namedRangeAudit.unused.length} named range(s) are defined but never referenced by any formula`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Linkage',
      condition: `The following named range(s) exist but no formula anywhere references them, by name or by the cell address they point to: ${names}${namedRangeAudit.unused.length > 8 ? ' and others' : ''}. A name whose wording suggests a key output (total, capex, revenue, debt) deserves particular attention.`,
      reason: `${namedRangeAudit.unused.length} unused named range(s)`,
      corrective_action: 'For each: confirm whether it should be linked into the model, or remove it if genuinely no longer needed.',
      workstream: 'Structure', category: 'Linkage', issue_type: 'Unused named range',
      model_risk: 'The underlying value may be a real output that never reaches the financial statements — the exact failure mode described in the capex linkage case study.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Named range not referenced', escalation_flag: true,
      urgency: 'Before next reliance', confidence: 85
    });
  }

  // ── A1 — INDIRECT() opaque dynamic reference finding ────────────────────
  // Was only ever wired into index.js, never here — server.js (the actual
  // web/API path) never fired this finding at all until now.
  if (tier0.stats && tier0.stats.totalIndirectCount > 0) {
    const indirectCells = (tier0.riskIndicators.indirectCells || []).slice(0, 8)
      .map(c => `${c.sheet}!${c.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-INDIRECT-001',
      label: `${tier0.stats.totalIndirectCount} formula cell(s) use INDIRECT() to construct a reference from a string`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${tier0.stats.totalIndirectCount} formula cell(s) use INDIRECT(), including: ${indirectCells}${tier0.stats.totalIndirectCount > 8 ? ' and others' : ''}. Because the reference is built from a string at calculation time, the actual target cell or sheet cannot be confirmed just by reading the formula — this is a materially more opaque pattern than a normal cell reference for anyone tracing the model's logic.`,
      reason: `${tier0.stats.totalIndirectCount} cell(s) use INDIRECT()`,
      corrective_action: 'Confirm what each INDIRECT() call actually resolves to at runtime, and consider replacing it with a direct cell reference where the target does not genuinely need to be computed dynamically.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Opaque dynamic reference',
      model_risk: 'A reference built from a string cannot be verified by reading the formula alone — if the string is ever wrong or the target is renamed/moved, the formula can silently point somewhere unintended without producing a visible error.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'INDIRECT() used to construct a dynamic reference',
      escalation_flag: false, urgency: 'Before next reliance', confidence: 100
    });
  }

  // ── A2 — SUM() ranges that exclude real data at either end ─────────────
  const totalRangeCheck = (() => { try { return checkTotalRanges(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Total-range check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (totalRangeCheck.applicable && totalRangeCheck.findings.length > 0) {
    totalRangeCheck.findings.forEach((f) => {
      const id = `T0-TOTALRANGE-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.cell}`;
      allFlagged.push({
        id,
        label: `${f.sheet}!${f.cell} sums a range that excludes ${f.excludedCount} adjacent numeric row(s)`,
        severity: 'medium', status: 'fail',
        sheet: f.sheet, cell: f.cell, category: 'Structure',
        condition: f.note,
        reason: `SUM range (${f.sumRange}) does not match the real contiguous data block (${f.actualBlockRange})`,
        corrective_action: 'Confirm whether the excluded row(s) genuinely belong in this total. If so, extend the SUM range to include them — this is the classic symptom of a row inserted after the range was set.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Truncated SUM range',
        model_risk: 'A total that silently excludes real adjacent data understates whatever it feeds into, without producing any visible error.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: 'SUM range does not cover the full contiguous data block', escalation_flag: false,
        urgency: 'Before next reliance', confidence: 85
      });
    });
  }

  // ── A3 — Sign-convention inconsistency for the same line item ──────────
  const signConventionCheck = (() => { try { return checkSignConventions(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Sign-convention check failed:', e.message); return { applicable:false, flaggedCount:0, results:[] }; } })();
  if (signConventionCheck.applicable && signConventionCheck.results.length > 0) {
    signConventionCheck.results.forEach((r, i) => {
      // FIX (found while designing cross-run tracking, before it could
      // cause silent damage): this ID was positional (T0-SIGNCONV-001,
      // -002, ... by array index), which is NOT stable across runs — if
      // the SET of flagged groups changes (e.g. "Cash balance" becomes
      // newly flagged), "Capex" could shift from index 1 to index 2,
      // breaking cross-run identity entirely. Label-derived instead,
      // matching the convention T0-BALNEG already used correctly.
      const id = `T0-SIGNCONV-${r.label.replace(/\s+/g, '').toUpperCase().slice(0, 10)}-001`;
      allFlagged.push({
        id,
        label: `"${r.label}" appears with inconsistent sign across the workbook`,
        severity: 'medium', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: r.note,
        reason: `${r.positiveCount} positive and ${r.negativeCount} negative instance(s) found for the same labelled line item`,
        corrective_action: 'Confirm the model\'s own sign convention for this line item and correct whichever instance(s) don\'t follow it — or confirm the difference is a deliberate, disclosed convention change between sheets.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Sign convention inconsistency',
        model_risk: 'A silently inconsistent sign convention can cause a value to be added where it should be subtracted (or vice versa) wherever it is later referenced.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: 'Same labelled line item has inconsistent sign across the workbook', escalation_flag: false,
        urgency: 'Before next reliance', confidence: 75,
        ...buildRootCauseFieldsFromResults(id, { results: [r] }, { commonRemediationAction: 'Confirm the model\'s own sign convention for this line item and correct whichever instance(s) don\'t follow it.' })
      });
    });
  }

  // ── NPV period-0 inclusion risk / IRR negative-cash-flow risk ──────────
  // Sourced from real worked examples in "Mastering Advanced Excel
  // Formulas and Functions" (Suman) — fm-validator book-mining findings
  // L19 and L20. Distinct from the existing T0-NPV check above (which is
  // about NPV()'s implicit even-period-spacing assumption vs. XNPV — a
  // timing question) and from key-output-chain-check.js / reasonableness-
  // checks.js (which treat IRR as a labelled RESULT to sanity-check, not
  // a formula whose own RANGE composition is being verified here). Also
  // formalizes what config/checklist.json's Tier 2 rule "IRR and NPV
  // formulas use correct timing, sign convention, and dates" currently
  // only asks a human/Claude reviewer to check qualitatively — this makes
  // the sign-convention half of that same question deterministic.
  const npvPeriodZeroCheck = (() => { try { return checkNpvPeriodZeroRisk(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  NPV period-0 check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (npvPeriodZeroCheck.applicable && npvPeriodZeroCheck.findings.length > 0) {
    const sample = npvPeriodZeroCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-NPVP0-001',
      label: `${npvPeriodZeroCheck.findings.length} NPV() formula(s) with no separate period-0 term`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${npvPeriodZeroCheck.findings.length} NPV() formula(s) have no term added outside the NPV() call itself, including: ${sample}${npvPeriodZeroCheck.findings.length > 8 ? ' and others' : ''}. NPV()'s summation treats its first value as one period from now — if the period-0 (initial) investment is folded into the NPV range rather than added separately, it is silently discounted by one extra period it shouldn't be.`,
      reason: `${npvPeriodZeroCheck.findings.length} NPV() call(s) show no separate period-0 addition term`,
      corrective_action: 'Confirm the NPV() range genuinely starts at period 1 (not period 0), and that any period-0 investment is added as a separate term outside the NPV() call.',
      workstream: 'Structure', category: 'Structure', issue_type: 'NPV period-0 inclusion risk',
      model_risk: 'A period-0 investment folded into an NPV() range is discounted by one extra period, understating (or overstating, for a negative rate) the true NPV without producing any visible error.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'NPV() formula has no visible separate period-0 term', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 70,
      ...buildRootCauseFields('T0-NPVP0-001', npvPeriodZeroCheck, { commonRemediationAction: 'Confirm the NPV() range starts at period 1, and add any period-0 investment as a separate term outside the NPV() call.' })
    });
  }

  const irrNegativeCashFlowCheck = (() => { try { return checkIrrNegativeCashFlowRisk(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  IRR negative-cash-flow check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (irrNegativeCashFlowCheck.applicable && irrNegativeCashFlowCheck.findings.length > 0) {
    const sample = irrNegativeCashFlowCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-IRRSIGN-001',
      label: `${irrNegativeCashFlowCheck.findings.length} IRR() formula(s) with no negative value in range`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${irrNegativeCashFlowCheck.findings.length} IRR() formula(s) reference a range where every value is currently zero or positive, including: ${sample}${irrNegativeCashFlowCheck.findings.length > 8 ? ' and others' : ''}. IRR() requires at least one negative value (the initial outflow) to be mathematically defined.`,
      reason: `${irrNegativeCashFlowCheck.findings.length} IRR() range(s) contain no negative value`,
      corrective_action: 'Confirm whether the initial investment/outflow is genuinely missing from this range, or zero, before attributing any IRR-related error to a recalculation-engine limitation.',
      workstream: 'Structure', category: 'Structure', issue_type: 'IRR missing negative cash flow',
      model_risk: 'IRR() over a range with no negative value is mathematically undefined — Excel returns #NUM!, and a downstream formula referencing this cell may mask that with a misleading fallback value.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'IRR() range contains no negative (initial-investment) value', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 80,
      ...buildRootCauseFields('T0-IRRSIGN-001', irrNegativeCashFlowCheck, { commonRemediationAction: 'Confirm whether the initial investment/outflow is genuinely missing from the IRR() range, or zero.' })
    });
  }

  const irrMultipleSignChangeCheck = (() => { try { return checkIrrMultipleSignChangeRisk(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  IRR multiple-sign-change check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (irrMultipleSignChangeCheck.applicable && irrMultipleSignChangeCheck.findings.length > 0) {
    const sample = irrMultipleSignChangeCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-IRRMULTISIGN-001',
      label: `${irrMultipleSignChangeCheck.findings.length} IRR() formula(s) over a cash flow series with 2+ sign changes`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${irrMultipleSignChangeCheck.findings.length} IRR() formula(s) reference a cash flow series that changes sign 2 or more times, including: ${sample}${irrMultipleSignChangeCheck.findings.length > 8 ? ' and others' : ''}. Such a series can have more than one mathematically valid IRR, and a plain IRR() call gives no indication the result is ambiguous.`,
      reason: `${irrMultipleSignChangeCheck.findings.length} IRR() range(s) have a cash flow series with 2+ sign changes`,
      corrective_action: 'Confirm this IRR result against an NPV-vs-discount-rate profile before relying on it, and consider whether a guess argument or an alternative metric (e.g. MIRR) is more appropriate for a non-conventional cash flow series.',
      workstream: 'Structure', category: 'Structure', issue_type: 'IRR multiple sign changes',
      model_risk: 'A cash flow series with 2+ sign changes can have multiple mathematically valid IRRs — a plain IRR() call silently converges to just one root, with no indication in the cell that the result is ambiguous.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'IRR() range has a non-conventional cash flow series (2+ sign changes)', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 75,
      ...buildRootCauseFields('T0-IRRMULTISIGN-001', irrMultipleSignChangeCheck, { commonRemediationAction: 'Confirm this IRR against an NPV-vs-discount-rate profile; consider a guess argument or MIRR instead.' })
    });
  }

  const flagErrorMaskingCheck = (() => { try { return checkFlagProductErrorMasking(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Flag error-masking check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (flagErrorMaskingCheck.applicable && flagErrorMaskingCheck.findings.length > 0) {
    const sample = flagErrorMaskingCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-FLAGERRMASK-001',
      label: `${flagErrorMaskingCheck.findings.length} PRODUCT()-based flag formula(s) with an unprotected inline division`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${flagErrorMaskingCheck.findings.length} PRODUCT()-based flag-combination formula(s) contain an inline division with no IFERROR() protection, including: ${sample}${flagErrorMaskingCheck.findings.length > 8 ? ' and others' : ''}. PRODUCT() cannot trap an error the way IF() can — a #DIV/0! inside one term propagates through the whole product rather than being masked.`,
      reason: `${flagErrorMaskingCheck.findings.length} PRODUCT()-based flag formula(s) have an unprotected inline division`,
      corrective_action: 'Wrap the division in IFERROR(), or restructure the flag as an explicit IF-based test, so the flag degrades gracefully rather than surfacing a raw Excel error.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Flag formula cannot trap underlying error',
      model_risk: 'A PRODUCT()-based flag combination silently loses its ability to produce a clean 0/1 signal exactly when an underlying error condition occurs — the flag itself becomes an error, rather than correctly flagging the problem.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'PRODUCT()-based flag has an unprotected inline division', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 75,
      ...buildRootCauseFields('T0-FLAGERRMASK-001', flagErrorMaskingCheck, { commonRemediationAction: 'Wrap the division in IFERROR(), or restructure as an explicit IF-based test.' })
    });
  }

  const textBooleanFlagCheck = (() => { try { return checkTextBooleanFlag(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Text-boolean flag check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (textBooleanFlagCheck.applicable && textBooleanFlagCheck.findings.length > 0) {
    const sample = textBooleanFlagCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-TEXTBOOLFLAG-001',
      label: `${textBooleanFlagCheck.findings.length} IF() formula(s) return "TRUE"/"FALSE" as text rather than a genuine boolean`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${textBooleanFlagCheck.findings.length} IF() formula(s) return the literal quoted text "TRUE"/"FALSE" rather than a genuine boolean or 1/0, including: ${sample}${textBooleanFlagCheck.findings.length > 8 ? ' and others' : ''}. This looks identical on screen to a real boolean but will produce #VALUE! the moment it's used in any downstream arithmetic.`,
      reason: `${textBooleanFlagCheck.findings.length} IF() formula(s) return text "TRUE"/"FALSE" instead of a genuine boolean`,
      corrective_action: 'Replace with a direct comparison (e.g. =F7>F6) or =IF(condition,1,0), which evaluate correctly in any downstream arithmetic use.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Text pseudo-boolean flag',
      model_risk: 'A cell returning quoted text "TRUE"/"FALSE" looks identical to a genuine boolean on screen, but will produce #VALUE! rather than the intended 0/1 behaviour if ever referenced arithmetically, now or in a future edit.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'IF() formula returns quoted text "TRUE"/"FALSE" instead of boolean/1/0', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 80,
      ...buildRootCauseFields('T0-TEXTBOOLFLAG-001', textBooleanFlagCheck, { commonRemediationAction: 'Replace with a direct comparison or IF(condition,1,0).' })
    });
  }

  // ── AutoSum header-inclusion risk (L7) ──────────────────────────────────
  // Sourced from "Excel for Auditors" (Jelen & Dowell) — fm-validator
  // book-mining finding L7. Distinct from total-range-check.js (which
  // catches a SUM range that EXCLUDES real adjacent data) — this catches
  // the opposite symptom: a SUM range that INCLUDES a header row it
  // shouldn't. Cannot achieve zero false positives (a genuine value could
  // coincidentally fall in a plausible-year range), so framed as a
  // verification prompt in its own finding text.
  const autoSumHeaderCheck = (() => { try { return checkAutoSumHeaderInclusion(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  AutoSum header-inclusion check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (autoSumHeaderCheck.applicable && autoSumHeaderCheck.findings.length > 0) {
    const sample = autoSumHeaderCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-AUTOSUMHDR-001',
      label: `${autoSumHeaderCheck.findings.length} SUM() range(s) with a plausible header year at the top of the range`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${autoSumHeaderCheck.findings.length} SUM() formula(s) have a plain numeric value in the range 1990-2100 as the very first cell of their range, including: ${sample}${autoSumHeaderCheck.findings.length > 8 ? ' and others' : ''}. This is the classic symptom of AutoSum sweeping a year-heading row into a total when there's no blank row separating the header from the data below it.`,
      reason: `${autoSumHeaderCheck.findings.length} SUM() range(s) start with a plausible calendar-year value`,
      corrective_action: 'Confirm the top cell of each flagged range is genuine data, not a header label swept into the total — if it is a header, adjust the range to start one row lower.',
      workstream: 'Structure', category: 'Structure', issue_type: 'AutoSum header-inclusion risk',
      model_risk: 'A total inflated by a header value (e.g. adding 2024 to a sum of dollar figures) looks plausible at a glance and can go unnoticed indefinitely.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'SUM() range appears to include a header row rather than starting at the first row of real data', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 65,
      ...buildRootCauseFields('T0-AUTOSUMHDR-001', autoSumHeaderCheck, { commonRemediationAction: 'Confirm the top cell of each flagged range is genuine data; if it is a header, adjust the range to start one row lower.' })
    });
  }

  // ── Formula pattern consistency (L10) ───────────────────────────────────
  // Sourced from "Excel for Auditors" (Jelen & Dowell) — fm-validator
  // book-mining finding L10 — formalizing Excel's own native "formula
  // differs from surrounding cells" warning into a check that can't be
  // permanently dismissed via "Ignore Error". Independently backed by
  // FAST Standard 3.02-01 and ICAEW Financial Modelling Code Principle
  // #12. Aggregated into one finding with a sample, matching this
  // pipeline's established convention for checks that can fire hundreds+
  // of times (confirmed on real files: 123-695 findings per model).
  const formulaPatternCheck = (() => { try { return checkFormulaPatternConsistency(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Formula pattern consistency check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (formulaPatternCheck.applicable && formulaPatternCheck.findings.length > 0) {
    const sample = formulaPatternCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-FMLPATTERN-001',
      label: `${formulaPatternCheck.findings.length} formula cell(s) differ from their row's dominant pattern`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${formulaPatternCheck.findings.length} formula cell(s) have a different structure than the majority pattern used by the rest of their row, including: ${sample}${formulaPatternCheck.findings.length > 8 ? ' and others' : ''}. This is the same signal Excel's own "inconsistent formula" warning uses, but cannot be permanently dismissed the way that warning can via "Ignore Error".`,
      reason: `${formulaPatternCheck.findings.length} formula cell(s) show a row-pattern inconsistency`,
      corrective_action: 'Review each flagged cell against the rest of its row — confirm whether the difference is deliberate (e.g. a genuinely different calculation for that period) or an unintended range/reference that was not extended or updated consistently with the rest of the row.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Formula pattern inconsistency',
      model_risk: 'A single cell in an otherwise-consistent row using a different range or reference structure can silently produce a wrong value for that one period, indistinguishable at a glance from its neighbors.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Formula cell structurally deviates from its row\'s established pattern', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 60,
      ...buildRootCauseFields('T0-FMLPATTERN-001', formulaPatternCheck, { commonRemediationAction: 'Confirm whether each flagged cell\'s deviation from its row is deliberate; if not, correct the range/reference to match the row\'s established pattern.' })
    });
  }

  // ── Column-direction formula pattern consistency (book-mining) ──────────
  // The column-direction sibling to the row-direction check above,
  // explicitly named in that check's own note as "a deliberate,
  // documented gap for a future pass, not silently ignored." Sourced
  // from Clermont, Hanin & Mittermeir's field-audit paper (EuSpRIG),
  // found in a book-mining pass — a "logical equivalence class" of
  // formulas distributed DOWN a column, not just across a row, caught
  // real errors across a 3.03% cell error rate in 78 audited
  // spreadsheets. Reuses normalizeFormula directly rather than
  // duplicating it. Real-file testing surfaced and fixed three genuine
  // false-positive classes: a date-metadata block mixed with unrelated
  // numeric cells, a checks-register sheet where every row is a
  // deliberately different named check, and a real bug in the fix for
  // the first case (a wrapper-object/raw-cell shape mismatch that
  // silently defeated the whole segmentation).
  const columnPatternCheck = (() => { try { return checkColumnPatternConsistency(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Column pattern consistency check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (columnPatternCheck.applicable && columnPatternCheck.findings.length > 0) {
    const sample = columnPatternCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-COLPATTERN-001',
      label: `${columnPatternCheck.findings.length} formula cell(s) differ from their column's dominant pattern`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${columnPatternCheck.findings.length} formula cell(s) have a different structure than the majority pattern used by the rest of their column, including: ${sample}${columnPatternCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${columnPatternCheck.findings.length} formula cell(s) show a column-pattern inconsistency`,
      corrective_action: 'Review each flagged cell against the rest of its column — confirm whether the difference is deliberate or an unintended range/reference not extended consistently (e.g. as the model\'s timeline was widened).',
      workstream: 'Structure', category: 'Structure', issue_type: 'Formula pattern inconsistency (column)',
      model_risk: 'A single cell in an otherwise-consistent column using a different range or reference structure can silently produce a wrong value, indistinguishable at a glance from its neighbors.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Formula cell structurally deviates from its column\'s established pattern', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 55,
      ...buildRootCauseFields('T0-COLPATTERN-001', columnPatternCheck, { commonRemediationAction: 'Confirm whether each flagged cell\'s deviation from its column is deliberate; if not, correct the range/reference to match the column\'s established pattern.' })
    });
  }

  // ── Daisy-chain / link-to-link detection ────────────────────────────────
  // Sourced from THREE independent standards: FAST 3.06-02, PwC Global
  // Financial Modeling Guidelines (D1), and ICAEW's "How to Review a
  // Spreadsheet" (D6) — the most cross-validated candidate in this
  // session's book-mining. Uses fan-in (is the intermediate cell reused
  // elsewhere) rather than same-sheet-vs-cross-sheet as the signal,
  // after real testing found the naive "any 2-hop chain" version
  // produced 1,125 false positives on a real file, driven by a
  // deliberately-built staging sheet. Confidence set at a moderate
  // level, not high: even with the fan-in fix, a real remaining
  // ambiguity was found and disclosed — a dedicated staging sheet with a
  // genuine 1:1 staging-cell-to-consumer mapping is technically a daisy
  // chain under FAST's own literal definition, but is also a legitimate,
  // deliberate architecture choice, not necessarily an accident. This is
  // presented as a worth-reviewing pattern, not an asserted defect.
  const daisyChainCheck = (() => { try { return checkDaisyChains(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Daisy-chain check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (daisyChainCheck.applicable && daisyChainCheck.findings.length > 0) {
    const sample = daisyChainCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-DAISYCHAIN-001',
      label: `${daisyChainCheck.findings.length} daisy-chained link(s) found`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${daisyChainCheck.findings.length} cell(s) link to another cell that is itself just a link with no other use in the workbook, rather than the original source, including: ${sample}${daisyChainCheck.findings.length > 8 ? ' and others' : ''}. Some of these may sit within a deliberately-built staging/import sheet — worth a quick review to confirm whether simplifying is warranted, not an assumed defect.`,
      reason: `${daisyChainCheck.findings.length} cell(s) show link-to-link chaining`,
      corrective_action: 'For each flagged cell, confirm whether routing through the intermediate link serves a real purpose (e.g. a shared local reference); if not, redirect the link to reference the ultimate source directly.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Daisy-chained link',
      model_risk: 'Extra, purposeless hops make a formula harder to trace and slightly increase the chance of an intermediate cell being edited or deleted without the chain being noticed.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Cell links to another cell that is itself just a link, with no other use', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 50,
      ...buildRootCauseFields('T0-DAISYCHAIN-001', daisyChainCheck, { commonRemediationAction: 'Redirect each flagged link to reference the ultimate source directly, unless the intermediate cell serves a genuine, reused purpose.' })
    });
  }

  // ── Embedded error-literal in IF branches ───────────────────────────────
  // Sourced from Plum Solutions/Mazars "Top 10 Errors" (D3) and
  // independently confirmed by FAST Standard 3.03-11 — two sources for
  // the same pattern, which FAST itself notes "model audit software will
  // often not detect."
  const embeddedErrorCheck = (() => { try { return checkEmbeddedErrorBranches(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Embedded error-branch check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (embeddedErrorCheck.applicable && embeddedErrorCheck.findings.length > 0) {
    const sample = embeddedErrorCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-IFERRLIT-001',
      label: `${embeddedErrorCheck.findings.length} IF() branch(es) with a literal error value`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${embeddedErrorCheck.findings.length} IF() call(s) have an Excel error literal (#REF!, #VALUE!, etc.) wired directly into a branch, including: ${sample}${embeddedErrorCheck.findings.length > 8 ? ' and others' : ''}. These produce no visible error today, only once the underlying condition flips.`,
      reason: `${embeddedErrorCheck.findings.length} IF() branch(es) contain a dormant error literal`,
      corrective_action: 'Review each flagged cell — confirm whether the error branch is genuinely unreachable under all valid model states, or replace it with the correct fallback logic.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Dormant error literal in IF branch',
      model_risk: 'A condition change (a date range shift, a flag flip, a scenario switch) can surface this error for the first time long after the model was built and reviewed, with no warning beforehand.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'IF() branch contains a literal Excel error value', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 80,
      ...buildRootCauseFields('T0-IFERRLIT-001', embeddedErrorCheck, { commonRemediationAction: 'Confirm whether the error branch is genuinely unreachable under all valid model states, or replace it with correct fallback logic.' })
    });
  }

  // ── Bare error literal in formula text (book-mining) ────────────────────
  // Sourced from the Operis Analysis Kit manual's "Error constants"
  // section, found in a book-mining pass — most commonly the result of
  // a formula referencing a range that was later deleted, which Excel
  // silently rewrites to a literal error token. Deliberately
  // complementary to the IF-branch check above: excludes the exact
  // case where the literal is the entire content of an IF() branch
  // (already covered there) and catches everything else — an
  // arithmetic term, a function argument, anywhere else in the
  // formula. Real-file testing on Carlsberg found a genuine broken
  // cross-sheet reference (a deleted 'Scenario analysis' range,
  // repeated across multiple period columns via INDEX()).
  const errorLiteralCheck = (() => { try { return checkErrorLiteralInFormula(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Error literal in formula check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (errorLiteralCheck.applicable && errorLiteralCheck.findings.length > 0) {
    const sample = errorLiteralCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-ERRLITERAL-001',
      label: `${errorLiteralCheck.findings.length} formula(s) with a bare error literal in their text`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${errorLiteralCheck.findings.length} formula(s) contain a bare Excel error literal directly in their text, including: ${sample}${errorLiteralCheck.findings.length > 8 ? ' and others' : ''}. Most commonly left behind when a referenced range was deleted.`,
      reason: `${errorLiteralCheck.findings.length} formula(s) contain a bare error literal`,
      corrective_action: 'Confirm whether each flagged reference should point somewhere else (the range it originally referenced was likely deleted) and correct it.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Bare error literal in formula',
      model_risk: 'A stale reference to a deleted range silently produces an error wherever it feeds into a calculation, and can be masked further downstream by IFERROR or similar.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Formula contains a bare Excel error literal, most likely from a deleted range reference', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 75,
      ...buildRootCauseFields('T0-ERRLITERAL-001', errorLiteralCheck, { commonRemediationAction: 'Confirm the correct reference and update the formula.' })
    });
  }

  // ── Unguarded 2-digit year extraction (book-mining) ──────────────────────
  // Sourced from Patrick O'Beirne's "Excel 2013 Spreadsheet Inquire"
  // review (EuSpRIG 2013), found in a book-mining pass — the review's
  // own table of Excel's built-in error-checking rules names "Cells
  // containing years represented as 2 digits" as a pattern "Not
  // reported" by any tool, including Microsoft's own Inquire add-in.
  // Deliberately scoped to a precise formula signal (VALUE(RIGHT(x,2)))
  // rather than guessing from raw values. Real-file testing found the
  // overwhelming majority of raw matches (197 of 199 on one real model)
  // were the model safely restoring the century explicitly (e.g.
  // 2000+VALUE(RIGHT(x,2))) — those are excluded; only genuinely
  // unguarded extractions, especially ones subtracted/compared against
  // each other, are flagged.
  const twoDigitYearCheck = (() => { try { return checkTwoDigitYearExtraction(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Two-digit year extraction check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (twoDigitYearCheck.applicable && twoDigitYearCheck.findings.length > 0) {
    const sample = twoDigitYearCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-2DIGITYEAR-001',
      label: `${twoDigitYearCheck.findings.length} formula(s) extract a 2-digit year without restoring the century`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${twoDigitYearCheck.findings.length} formula(s) use VALUE(RIGHT(x,2)) to extract a 2-digit year without an explicit century-restoring addition nearby, including: ${sample}${twoDigitYearCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${twoDigitYearCheck.findings.length} formula(s) extract a 2-digit year without a century guard`,
      corrective_action: 'Confirm whether this model\'s date range could ever cross a century boundary; if so, restore the full 4-digit year explicitly rather than comparing raw 2-digit extractions.',
      workstream: 'Structure', category: 'Structure', issue_type: '2-digit year extraction',
      model_risk: 'If the extracted 2-digit values ever span a century boundary (e.g. "99" vs "05"), arithmetic on them silently produces a wrong result with no visible error.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Formula extracts a 2-digit year via RIGHT() without restoring the century', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 45,
      ...buildRootCauseFields('T0-2DIGITYEAR-001', twoDigitYearCheck, { commonRemediationAction: 'Restore the full 4-digit year explicitly rather than comparing raw 2-digit extractions.' })
    });
  }

  // ── Constant formula cells (book-mining) ─────────────────────────────────
  // Sourced from the Operis Analysis Kit manual's "Search | Constant
  // formula cells" command, found in a book-mining pass — a formula
  // with zero cell references that combines literal numbers via an
  // operator or function (e.g. =10+40) may really be a hidden input,
  // not a genuine calculation, and so escapes the checking a real
  // input cell would get. Real-file testing found and fixed two
  // genuine bugs: whole-row/whole-column references (5:5, A:A) weren't
  // recognized, and a bare literal placeholder (=0) was being flagged
  // even though it isn't deriving anything. Also found a genuinely
  // valuable real pattern: a descriptive range label ("3-5%") that
  // Excel silently interpreted as arithmetic, computing 2.95 instead
  // of storing the intended text — a real, silent data-entry error.
  const constantFormulaCheck = (() => { try { return checkConstantFormulaCells(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Constant formula cells check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (constantFormulaCheck.applicable && constantFormulaCheck.findings.length > 0) {
    const sample = constantFormulaCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-CONSTFORMULA-001',
      label: `${constantFormulaCheck.findings.length} formula(s) with no cell references, possibly hiding an input`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${constantFormulaCheck.findings.length} formula(s) reference no other cells at all, computing their result purely from literal numbers, including: ${sample}${constantFormulaCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${constantFormulaCheck.findings.length} formula(s) may be hiding an input as a "constant formula"`,
      corrective_action: 'Confirm whether the numbers in each flagged formula should be split out onto the face of the worksheet as an explicit input, and check for a data-entry error where descriptive text may have been silently interpreted as arithmetic.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Constant formula cell',
      model_risk: 'A numeric assumption buried in a formula (rather than a visible input cell) escapes normal input-checking against documentation, and — as found on a real model — descriptive text can be silently misinterpreted as arithmetic with no visible error.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Formula has zero cell references and combines literal numbers via an operator or function', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 40,
      ...buildRootCauseFields('T0-CONSTFORMULA-001', constantFormulaCheck, { commonRemediationAction: 'Split the buried number out as an explicit input, or confirm the formula is correctly capturing the intended value.' })
    });
  }

  // ── Overflow error (book-mining) ─────────────────────────────────────────
  // Sourced from Patrick O'Beirne's "Excel 2013 Spreadsheet Inquire"
  // review (EuSpRIG 2013), found in a book-mining pass — named
  // explicitly as a gap: "an overflow error, such as a negative or
  // excessive date value, is not reported... but as a real date...
  // rather than the ##### error value." Real-file testing on The Bend
  // model confirmed two distinct real causes for the same symptom:
  // genuine date-arithmetic overflow, and — the more common case found —
  // a dashboard cell pulling a dollar figure through a bare reference
  // while still carrying a stale date-style number format, producing
  // an absurd multi-millennium "date" on screen. Also found and fixed a
  // real crash: an actually-invalid Date object (not just implausible)
  // threw on .toISOString() rather than being handled.
  const overflowErrorCheck = (() => { try { return checkOverflowError(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Overflow error check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (overflowErrorCheck.applicable && overflowErrorCheck.findings.length > 0) {
    const sample = overflowErrorCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-OVERFLOW-001',
      label: `${overflowErrorCheck.findings.length} cell(s) show an implausible or invalid date`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${overflowErrorCheck.findings.length} formula cell(s) evaluate to a date far outside any plausible range (or an actually invalid date), including: ${sample}${overflowErrorCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${overflowErrorCheck.findings.length} cell(s) show a nonsensical date with no visible error`,
      corrective_action: 'Check whether the underlying calculation is genuinely producing a wrong date, or whether the cell simply has a stale date-style number format applied to an unrelated value — correct whichever applies.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Overflow / implausible date',
      model_risk: 'A nonsensical date displays as ordinary-looking content rather than a visible error, and can be easily missed on a quick review.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Formula result is a date far outside any plausible range, or is invalid', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 35,
      ...buildRootCauseFields('T0-OVERFLOW-001', overflowErrorCheck, { commonRemediationAction: 'Correct the underlying calculation, or fix the cell\'s number format if the value itself is correct.' })
    });
  }

  // ── Mixed absolute/relative range references (book-mining) ──────────────
  // Sourced from the Operis Analysis Kit manual's "Cell reference
  // profligacy" section, found in a book-mining pass — Operis's own
  // example: "=SUM($A1:C1)... evaluate to ranges of different size as
  // they are copied." Real-file testing on The Bend model found this
  // is very often a deliberate pattern (a running/cumulative total
  // with one boundary anchored to a fixed starting point, the other
  // growing as the formula is copied across periods), not a mistake —
  // but per Operis's own stated view, even a deliberate mixed reference
  // "merits careful examination" since, unlike an ordinary copied
  // formula, its correctness can't be inferred from a neighbouring
  // cell being correct.
  const mixedRefCheck = (() => { try { return checkMixedReferences(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Mixed reference check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (mixedRefCheck.applicable && mixedRefCheck.findings.length > 0) {
    const sample = mixedRefCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-MIXEDREF-001',
      label: `${mixedRefCheck.findings.length} range reference(s) mix absolute and relative addressing`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${mixedRefCheck.findings.length} range reference(s) mix absolute and relative addressing between their two endpoints, so their effective size changes depending on where the formula is copied to, including: ${sample}${mixedRefCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${mixedRefCheck.findings.length} range reference(s) mix absolute and relative addressing`,
      corrective_action: 'Confirm the range is growing (or shrinking) as intended — often a deliberate running/cumulative total, but worth a quick check since its correctness can\'t be inferred from a neighbouring cell the way an ordinary copied formula\'s can.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Mixed absolute/relative range reference',
      model_risk: 'A range whose size changes as it\'s copied behaves differently from cell to cell in a way that isn\'t visible just by looking at the formula bar for one cell.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Range reference mixes absolute and relative addressing between its two endpoints', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 35,
      ...buildRootCauseFields('T0-MIXEDREF-001', mixedRefCheck, { commonRemediationAction: 'Confirm the range is growing or shrinking as intended.' })
    });
  }

  // ── Whitespace in sheet names (book-mining) ──────────────────────────────
  // Sourced from Patrick O'Beirne's "Excel 2013 Spreadsheet Inquire"
  // review (EuSpRIG 2013), found in a book-mining pass — directly
  // relevant given this session's own real bug: sheet-resolver.js needed
  // a fix earlier this session because two blank/whitespace-only sheet
  // NAMES could incorrectly resolve as equal to each other. A leading or
  // trailing space in an otherwise-real sheet name is invisible on the
  // tab itself but is exactly the same class of subtle reference-
  // matching failure — a visual review would never catch it.
  const whitespaceSheetCheck = (() => { try { return checkWhitespaceSheetNames(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Whitespace sheet name check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (whitespaceSheetCheck.applicable && whitespaceSheetCheck.findings.length > 0) {
    const sample = whitespaceSheetCheck.findings.slice(0, 8).map(f => `"${f.sheet}"`).join(', ');
    allFlagged.push({
      id: 'T0-WSSHEETNAME-001',
      label: `${whitespaceSheetCheck.findings.length} sheet name(s) have leading or trailing whitespace`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${whitespaceSheetCheck.findings.length} sheet name(s) have leading or trailing whitespace, invisible on the tab itself, including: ${sample}.`,
      reason: `${whitespaceSheetCheck.findings.length} sheet name(s) have leading or trailing whitespace`,
      corrective_action: 'Rename each flagged sheet to remove the leading/trailing space, and confirm any formulas or named ranges referencing it still resolve correctly afterward.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Whitespace in sheet name',
      model_risk: 'A formula or named range referencing the sheet without the space (as it visually appears) may not resolve the way a reviewer expects — a subtle reference-matching failure invisible on a normal visual review.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Sheet name has leading or trailing whitespace', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 60,
      ...buildRootCauseFields('T0-WSSHEETNAME-001', whitespaceSheetCheck, { commonRemediationAction: 'Rename the sheet to remove the leading/trailing space.' })
    });
  }

  // ── Hidden formulas under sheet protection (book-mining) ─────────────────
  // Sourced from Patrick O'Beirne's "Excel 2013 Spreadsheet Inquire"
  // review (EuSpRIG 2013), found in a book-mining pass — Excel's own
  // per-cell "Hidden" protection attribute, distinct from row/column/
  // sheet hiding: it specifically hides a formula from the formula bar
  // once sheet protection is enabled, while the computed value stays
  // fully visible. No reviewer, even one with full file access, can
  // inspect the logic behind such a cell. Only meaningful when sheet
  // protection is actually active — the attribute is inert otherwise.
  const hiddenFormulaCheck = (() => { try { return checkHiddenFormulas(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Hidden formula check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (hiddenFormulaCheck.applicable && hiddenFormulaCheck.findings.length > 0) {
    const sample = hiddenFormulaCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-HIDDENFORMULA-001',
      label: `${hiddenFormulaCheck.findings.length} formula(s) hidden from the formula bar under sheet protection`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${hiddenFormulaCheck.findings.length} formula(s) are hidden from the formula bar under active sheet protection — the computed value is visible but the calculation itself cannot be inspected, including: ${sample}.`,
      reason: `${hiddenFormulaCheck.findings.length} formula(s) have their logic hidden from any reviewer`,
      corrective_action: 'Confirm whether hiding each flagged formula is genuinely intentional; if not, clear the Hidden protection attribute so the calculation can be reviewed.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Formula hidden under protection',
      model_risk: 'A hidden formula\'s logic cannot be verified by any reviewer, including one with full access to the file — this is a materially different, more opaque situation than ordinary row/column/sheet hiding.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Formula is hidden from the formula bar under active sheet protection', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 65,
      ...buildRootCauseFields('T0-HIDDENFORMULA-001', hiddenFormulaCheck, { commonRemediationAction: 'Confirm whether hiding this formula is intentional; clear the Hidden attribute if not.' })
    });
  }

  // ── Duplicate calculation logic across sheets (Tier 0 complement to
  // the manual_only Tier 2 rule T2-S1-004) ─────────────────────────────────
  // Sourced from real user feedback that a naive "no calculation in
  // more than one sheet" rule would incorrectly flag legitimate
  // aggregation — a detail table's line items feeding a single summary
  // formula that's then linked elsewhere is correct, expected
  // structure; not every line item needs to independently reach the
  // financial statements. Grounded in a real best-practice principle
  // (RÖDL's "10 Golden Rules of Financial Modeling": "calculated only
  // once and then linked to avoid redundancies"). T2-S1-004 stays
  // manual_only because Tier 2 (Mode A) has no formula-text access at
  // all and cannot verify this from values alone; this Tier 0 check has
  // full formula access and can. Deliberately conservative: only exact
  // aggregate-function matches over an identical precedent range,
  // never bare references (the correct link pattern) or same-sheet
  // row/column repetition (already covered elsewhere). Real-file
  // testing found a genuine instance: two differently-named diagnostic
  // sheets independently computing the identical balance-sheet-
  // imbalance formula, character for character.
  const dupCalcCheck = (() => { try { return checkDuplicateCalculationLogic(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Duplicate calculation logic check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (dupCalcCheck.applicable && dupCalcCheck.findings.length > 0) {
    dupCalcCheck.findings.forEach((f) => {
      const firstOccurrence = f.occurrences[0];
      const [occSheet, occCell] = firstOccurrence.includes('!') ? firstOccurrence.split('!') : [f.sheets[0], firstOccurrence];
      const groupId = `T0-DUPCALC-${occSheet.replace(/[^A-Za-z0-9]/g, '')}-${occCell}`;
      allFlagged.push({
        id: groupId,
        label: `The same ${f.fnName}() aggregate is independently computed on ${f.sheets.length} different sheets`,
        severity: 'medium', status: 'fail',
        sheet: f.sheets[0], cell: occCell,
        category: 'Structure',
        condition: f.note,
        reason: `Duplicated ${f.fnName}() calculation across sheets: ${f.occurrences.join(', ')}`,
        corrective_action: 'Confirm whether one location should instead be a simple reference to the other, so the calculation is computed once and linked, not independently rebuilt.',
        workstream: 'Structure', issue_type: 'Duplicate calculation logic',
        model_risk: 'If the underlying detail range changes later, one copy of this calculation may be updated while the other is silently left behind, causing the two to quietly diverge.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: `Same ${f.fnName}() aggregate independently computed on multiple sheets`, escalation_flag: false,
        urgency: 'Next scheduled review', confidence: 70,
        root_cause_id: groupId, master_finding_id: groupId,
        occurrence_count: f.occurrences.length, material_occurrence_count: f.occurrences.length,
        affected_cells: f.occurrences, affected_sheets: f.sheets,
        common_remediation_action: 'Link one location to the other instead of independently recomputing the same aggregate.',
      });
    });
  }

  // ── DSRA target sizing ───────────────────────────────────────────────────
  // Sourced from TWO independent references citing the same customary
  // practice: Ofgem's Cap and Floor Financial Model Handbook (D4) and
  // the World Bank/PPIAF Greenfield Mining Transport Infrastructure
  // report (D5). Directly feeds G3 per this project's own Phase D
  // sequencing. One-sided (only flags apparent under-funding, never
  // over-funding) and deliberately narrow (only fires when an explicitly
  // monthly-labelled debt service figure exists — periodicity is never
  // guessed).
  const dsraSizingCheck = (() => { try { return checkDsraSizing(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  DSRA sizing check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (dsraSizingCheck.applicable && dsraSizingCheck.findings.length > 0) {
    const sample = dsraSizingCheck.findings.slice(0, 5).map(f => `${f.sheet}!${f.dsraCell} (~${f.monthsCovered} months)`).join(', ');
    allFlagged.push({
      id: 'T0-DSRASIZE-001',
      label: `${dsraSizingCheck.findings.length} DSRA target(s) apparently below the customary funding floor`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${dsraSizingCheck.findings.length} DSRA target value(s) cover fewer than ~5 months of a labelled monthly debt service figure, including: ${sample}. Lenders customarily require at least six months of coverage at completion.`,
      reason: `${dsraSizingCheck.findings.length} DSRA target(s) below the customary six-month funding floor`,
      corrective_action: 'Confirm whether the DSRA sizing shown reflects the deal\'s actual agreed terms (which vary by transaction) or an under-funded reserve relative to customary market practice.',
      workstream: 'Structure', category: 'Structure', issue_type: 'DSRA under-funding risk',
      model_risk: 'A DSRA sized below customary lender requirements may not provide adequate liquidity cover in a downside scenario, and may not match what was actually agreed in financing documents.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'DSRA target value covers fewer than the customary minimum months of debt service', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 55,
      ...buildRootCauseFields('T0-DSRASIZE-001', dsraSizingCheck, { commonRemediationAction: 'Confirm whether DSRA sizing reflects actual agreed deal terms or represents genuine under-funding relative to customary practice.' })
    });
  }

  // ── Complex-formula detection ────────────────────────────────────────────
  // Sourced from PwC Global Financial Modeling Guidelines (D1) — explicit
  // named threshold (3+ opening parentheses). Deliberately low confidence
  // and aggregated: expect a high volume, including many common,
  // unremarkable idioms (IFERROR(INDEX(...,MATCH(...)),0) already clears
  // this threshold) — a readability-review prompt, not an error signal.
  const complexFormulaCheck = (() => { try { return checkComplexFormulas(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Complex formula check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (complexFormulaCheck.applicable && complexFormulaCheck.findings.length > 0) {
    const sample = complexFormulaCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-COMPLEXFML-001',
      label: `${complexFormulaCheck.findings.length} formula(s) with 3+ parentheses`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${complexFormulaCheck.findings.length} formula(s) contain 3 or more opening parentheses, per PwC's stated complexity threshold, including: ${sample}${complexFormulaCheck.findings.length > 8 ? ' and others' : ''}. Many of these are likely standard nested-lookup idioms (e.g. IFERROR wrapping INDEX/MATCH) rather than genuine readability problems.`,
      reason: `${complexFormulaCheck.findings.length} formula(s) exceed PwC's stated complexity threshold`,
      corrective_action: 'Informational — review flagged formulas for genuine readability concerns; a high count here is expected and not itself evidence of a problem.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Formula complexity (informational)',
      model_risk: 'A genuinely over-complex formula is harder to review and more error-prone, but this check cannot distinguish that from a standard nested-lookup pattern.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Formula contains 3 or more opening parentheses', escalation_flag: false,
      urgency: 'Informational', confidence: 30,
      ...buildRootCauseFields('T0-COMPLEXFML-001', complexFormulaCheck, { commonRemediationAction: 'Review for genuine readability concerns; simplify only where testing shows an actual defect, not merely for parenthesis count.' })
    });
  }

  // ── Numbers stored as text ───────────────────────────────────────────────
  // Sourced from ICAEW's "How to Review a Spreadsheet" (D6) — a common,
  // well-known Excel gotcha: a numeric-looking value stored as text is
  // silently excluded from SUM() and most arithmetic.
  const numberAsTextCheck = (() => { try { return checkNumbersStoredAsText(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Numbers-as-text check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (numberAsTextCheck.applicable && numberAsTextCheck.findings.length > 0) {
    const sample = numberAsTextCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell} ("${f.textValue}")`).join(', ');
    allFlagged.push({
      id: 'T0-NUMASTEXT-001',
      label: `${numberAsTextCheck.findings.length} number(s) stored as text`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${numberAsTextCheck.findings.length} plain input cell(s) contain a numeric-looking value stored as text rather than a real number, including: ${sample}${numberAsTextCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${numberAsTextCheck.findings.length} cell(s) contain a number stored as text`,
      corrective_action: 'Confirm whether these cells feed into any calculation — if so, re-enter them as genuine numeric values (e.g. via Text to Columns or a paste-special multiply-by-1) rather than text.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Number stored as text',
      model_risk: 'A number stored as text is silently excluded from SUM() and most arithmetic without any visible error — a common paste-from-PDF or paste-from-web artifact.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Cell contains a numeric-looking value stored as text', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 70,
      ...buildRootCauseFields('T0-NUMASTEXT-001', numberAsTextCheck, { commonRemediationAction: 'Re-enter each flagged cell as a genuine numeric value (Text to Columns, or paste-special multiply-by-1) if it feeds any calculation.' })
    });
  }

  // ── Revolver/cash never-negative ─────────────────────────────────────────
  // Sourced from FMI's "Checking and Reviewing a Model" (D2). Checks
  // EVERY period of a labelled time series, using findLabeledRowSeries
  // rather than the single-nearest-value findLabeledValues — necessary
  // given the same limitation disclosed for sign-convention-check.js's
  // balance-type groups (the nearest column is often a genuine zero
  // opening balance, hiding a much longer real series).
  const balanceNeverNegativeCheck = (() => { try { return checkBalanceNeverNegative(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Balance never-negative check failed:', e.message); return { applicable:false, flaggedCount:0, results:[] }; } })();
  if (balanceNeverNegativeCheck.applicable && balanceNeverNegativeCheck.results.length > 0) {
    for (const r of balanceNeverNegativeCheck.results) {
      const sample = r.negativeInstances.slice(0, 5).map(n => `${n.sheet}!${n.cell} (${n.value})`).join(', ');
      const id = `T0-BALNEG-${r.label.replace(/\s+/g, '').toUpperCase().slice(0, 10)}-001`;
      allFlagged.push({
        id,
        label: `${r.negativeCount} negative period(s) in "${r.label}"`,
        severity: 'high', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `"${r.label}"-labelled time series include ${r.negativeCount} negative period(s), e.g. ${sample}.`,
        reason: `${r.negativeCount} negative period(s) found in a "${r.label}" time series`,
        corrective_action: 'A negative cash or revolver balance is a common sign of a broken or incomplete funding mechanism (e.g. a revolver draw not triggering, a minimum-cash requirement not enforced) — trace the driving logic for the flagged period(s).',
        workstream: 'Structure', category: 'Structure', issue_type: 'Negative balance-sheet balance',
        model_risk: 'A negative cash or revolver balance is not commercially achievable — its presence indicates the funding/draw mechanism is not correctly enforcing a floor.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: `${r.label} time series includes a negative value`, escalation_flag: false,
        urgency: 'Before next reliance', confidence: 75,
        ...buildRootCauseFieldsFromResults(id, { results: [r] }, { commonRemediationAction: 'Trace the funding/draw logic for the flagged negative period(s) — confirm why the floor was not enforced.' })
      });
    }
  }

  // ── DSCR-gated distributions ─────────────────────────────────────────────
  // Sourced from the World Bank/PPIAF Greenfield Mining Transport
  // Infrastructure report (D5). Anchored on DSCR < 1.0x (mathematically
  // insufficient cash flow) rather than the deal-varying customary
  // ~1.4x lock-up level, to avoid false positives against a different
  // agreed threshold. Falls back to a single unified "DSCR" label when
  // no explicit backward/forward split exists — confirmed necessary via
  // real testing (a real file used exactly this pattern, and its stated
  // lock-up mechanism was confirmed genuinely working, zero violations).
  const dscrGatedCheck = (() => { try { return checkDscrGatedDistributions(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  DSCR-gated distributions check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (dscrGatedCheck.applicable && dscrGatedCheck.findings.length > 0) {
    const sample = dscrGatedCheck.findings.slice(0, 5).map(f => `${f.sheet}!${f.distributionCell}`).join(', ');
    allFlagged.push({
      id: 'T0-DSCRGATE-001',
      label: `${dscrGatedCheck.findings.length} distribution(s) paid with DSCR below 1.0x`,
      // P1/P2/P3 framework renewal, Tier 2 item 4: see the matching
      // comment in index.js for the full rationale.
      severity: 'critical', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${dscrGatedCheck.findings.length} period(s) show a distribution paid while DSCR reads below 1.0x, including: ${sample}. The project's own cash flow was mathematically insufficient to cover debt service in the affected period(s).`,
      reason: `${dscrGatedCheck.findings.length} distribution(s) paid despite DSCR below 1.0x`,
      corrective_action: 'Trace the distribution formula\'s gating logic for the flagged period(s) — confirm whether a DSCR-based lock-up test is actually wired into the distribution calculation, or whether distributions are flowing regardless of DSCR.',
      workstream: 'Structure', category: 'Structure', issue_type: 'DSCR lock-up not enforced',
      model_risk: 'A distribution paid while DSCR is below 1.0x understates the project\'s inability to cover its own debt service that period — a real lender-protection mechanism appears not to be enforced.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Distribution paid in a period where DSCR is below 1.0x', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 65,
      ...buildRootCauseFields('T0-DSCRGATE-001', dscrGatedCheck, { commonRemediationAction: 'Trace the distribution formula\'s gating logic — confirm whether a DSCR-based lock-up test is actually wired into the calculation.' })
    });
  }

  // ── VLOOKUP/HLOOKUP/MATCH missing exact-match parameter (L1) ────────────
  // Sourced from "Excel for Auditors" (Jelen & Dowell). Confirmed via
  // real testing to correctly identify the root cause of an already-
  // documented Formualizer limitation on Carlsberg (MATCH() with default
  // approximate type against a mixed text/number row).
  const lookupExactMatchCheck = (() => { try { return checkLookupExactMatch(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Lookup exact-match check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (lookupExactMatchCheck.applicable && lookupExactMatchCheck.findings.length > 0) {
    const sample = lookupExactMatchCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-LOOKUPMATCH-001',
      label: `${lookupExactMatchCheck.findings.length} lookup(s) missing an exact-match parameter`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${lookupExactMatchCheck.findings.length} VLOOKUP()/HLOOKUP()/MATCH() call(s) do not use an explicit exact-match argument, including: ${sample}${lookupExactMatchCheck.findings.length > 8 ? ' and others' : ''}. These silently default to approximate matching, which requires the lookup column to be sorted and can return a plausible but wrong value with no visible error.`,
      reason: `${lookupExactMatchCheck.findings.length} lookup formula(s) default to approximate matching`,
      corrective_action: 'Add an explicit FALSE (VLOOKUP/HLOOKUP) or 0 (MATCH) exact-match argument, unless approximate matching is genuinely intended and the lookup range is confirmed sorted.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Lookup missing exact-match parameter',
      model_risk: 'Approximate matching against an unsorted range can silently return a plausible but wrong value — one of the most common, well-documented sources of silent lookup errors.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'VLOOKUP/HLOOKUP/MATCH call missing an explicit exact-match argument', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 75,
      ...buildRootCauseFields('T0-LOOKUPMATCH-001', lookupExactMatchCheck, { commonRemediationAction: 'Add an explicit FALSE (VLOOKUP/HLOOKUP) or 0 (MATCH) exact-match argument.' })
    });
  }

  // ── PMT/IPMT/PPMT sign convention consistency (L18) ──────────────────────
  // Sourced from "Mastering Advanced Excel Formulas and Functions"
  // (Suman). Compares the sign of the pv FORMULA ARGUMENT across all
  // PMT-family calls, distinct from sign-convention-check.js which
  // compares labelled VALUE signs.
  const pmtSignCheck = (() => { try { return checkPmtSignConsistency(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  PMT sign convention check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (pmtSignCheck.applicable && pmtSignCheck.flaggedCount > 0) {
    const f = pmtSignCheck.findings[0];
    allFlagged.push({
      id: 'T0-PMTSIGN-001',
      label: 'PMT()/IPMT()/PPMT() pv argument sign is inconsistent',
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: f.note,
      reason: `${f.positiveCount} positive-pv and ${f.negativeCount} negative-pv PMT-family call(s) found`,
      corrective_action: 'Standardize the pv argument sign across all PMT()/IPMT()/PPMT() calls in the model — either convention is fine, but it must be applied consistently.',
      workstream: 'Structure', category: 'Structure', issue_type: 'PMT sign convention inconsistency',
      model_risk: 'Payment values with inconsistent signs cannot be safely summed together, silently misstating any total that combines them.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'PMT-family calls use an inconsistent pv-argument sign convention', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 70,
      ...buildRootCauseFields('T0-PMTSIGN-001', pmtSignCheck, { commonRemediationAction: 'Standardize the pv argument sign across all PMT()/IPMT()/PPMT() calls.' })
    });
  }

  // ── Terminal-period completeness (G2) ────────────────────────────────────
  // Sourced from "Issues the Audit Missed." Architecturally distinct
  // from L10 (formula-pattern check): catches a VALUE anomaly (a sudden
  // drop to zero at the terminal boundary) even when the formula
  // structure is identical across the whole row. Two real bugs found
  // and fixed via testing before shipping: (1) cell.value?.result
  // silently drops a genuine zero result due to an ExcelJS quirk — the
  // exact value this check most needs to see; (2) a sparse one-time-cost
  // row (mostly zero with a single spike) could pass an average-based
  // threshold without being a genuine stable series — now requires
  // established-window consistency, not just a nonzero average.
  const terminalPeriodCheck = (() => { try { return checkTerminalPeriodCompleteness(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Terminal-period completeness check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (terminalPeriodCheck.applicable && terminalPeriodCheck.findings.length > 0) {
    const sample = terminalPeriodCheck.findings.slice(0, 8).map(f => `${f.sheet} row ${f.row}`).join(', ');
    allFlagged.push({
      id: 'T0-TERMPERIOD-001',
      label: `${terminalPeriodCheck.findings.length} row(s) drop suddenly to zero in the terminal period(s)`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${terminalPeriodCheck.findings.length} row(s) show a stable, non-declining run of values that then drops suddenly to near-zero in the last 1-2 periods, including: ${sample}${terminalPeriodCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${terminalPeriodCheck.findings.length} row(s) show an unexplained terminal-period drop to zero`,
      corrective_action: 'Confirm whether the terminal period genuinely has zero activity (e.g. a loan reaching maturity), or whether an upstream driver silently drops out at that boundary.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Terminal-period value gap',
      model_risk: 'A silent terminal-period omission (a cost category, a working-capital movement, a capex schedule) understates the model\'s later years without producing any visible error — the formula can look identical to every other period.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Row value drops suddenly to near-zero specifically in the terminal period(s)', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 55,
      ...buildRootCauseFields('T0-TERMPERIOD-001', terminalPeriodCheck, { commonRemediationAction: 'Confirm whether the terminal-period drop is genuine (e.g. project/loan completion) or an upstream driver silently dropping out.' })
    });
  }

  // ── Tax effective-rate reasonableness (G6) ───────────────────────────────
  // Compares computed effective tax rate against a labelled statutory
  // rate. Deliberately narrow after real testing: an earlier version's
  // bare-"tax" fallback term matched five genuinely different tax-
  // adjacent concepts on a real file (terminal-value adjustments,
  // deferred tax movements, normalization lines) — removed entirely
  // rather than risk comparing the wrong row against the statutory rate.
  const taxEffectiveRateCheck = (() => { try { return checkTaxEffectiveRate(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Tax effective-rate check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (taxEffectiveRateCheck.applicable && taxEffectiveRateCheck.findings.length > 0) {
    const sample = taxEffectiveRateCheck.findings.slice(0, 5).map(f => `${f.sheet}!${f.taxCell} (${(f.effectiveRate*100).toFixed(1)}% vs ${(f.statutoryRate*100).toFixed(1)}%)`).join(', ');
    allFlagged.push({
      id: 'T0-TAXRATE-001',
      label: `${taxEffectiveRateCheck.findings.length} period(s) with effective tax rate far from statutory rate`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${taxEffectiveRateCheck.findings.length} period(s) show a computed effective tax rate more than 10 percentage points from the labelled statutory rate, e.g. ${sample}.`,
      reason: `${taxEffectiveRateCheck.findings.length} period(s) show an unexplained effective/statutory tax-rate gap`,
      corrective_action: 'Confirm whether the gap reflects a legitimate reason (tax losses carried forward, credits, a different jurisdictional rate) or a broken tax formula.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Tax effective-rate discrepancy',
      model_risk: 'A tax formula not correctly referencing the statutory rate, or referencing the wrong base, silently misstates net income and downstream cash flow.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Computed effective tax rate deviates significantly from the labelled statutory rate', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 45,
      ...buildRootCauseFields('T0-TAXRATE-001', taxEffectiveRateCheck, { commonRemediationAction: 'Confirm whether the tax-rate gap reflects a legitimate reason (losses carried forward, credits, jurisdictional rate) or a broken tax formula.' })
    });
  }

  // ── Cross-casting (book-mining) ──────────────────────────────────────────
  // Sourced from "Spreadsheet Modelling Best Practice" (ICAEW-published,
  // Business Dynamics / Coopers & Lybrand, 1999), found in a book-mining
  // pass. The book's own worked example: a grid with a "Total" row and
  // a "Total" column should arrive at the same grand total when summed
  // independently — a missing line item in one aggregation range breaks
  // this without producing any visible error. Deliberately conservative:
  // requires a confidently-identified Total row/column pair with at
  // least 2 real data points on each side, within a bounded distance.
  const crossCastCheck = (() => { try { return checkCrossCasting(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Cross-cast check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (crossCastCheck.applicable && crossCastCheck.findings.length > 0) {
    const sample = crossCastCheck.findings.slice(0, 5).map(f => f.cell).join(', ');
    allFlagged.push({
      id: 'T0-CROSSCAST-001',
      label: `${crossCastCheck.findings.length} grid(s) where the totals row and totals column disagree`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${crossCastCheck.findings.length} grid(s) have a "Total" row and "Total" column that arrive at different grand totals when summed independently, including: ${sample}.`,
      reason: `${crossCastCheck.findings.length} grid(s) fail a cross-cast: two independent paths to the same grand total disagree`,
      corrective_action: 'Check both aggregation ranges (the totals row and the totals column) for a missing or extra line item, row, or column.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Cross-cast mismatch',
      model_risk: 'Two independently-computed grand totals disagreeing usually means one aggregation range is incomplete — a real, silent numerical error, not a display issue.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Totals row and totals column sum to different grand totals', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 65,
      ...buildRootCauseFields('T0-CROSSCAST-001', crossCastCheck, { commonRemediationAction: 'Check both aggregation ranges for a missing or extra line item.' })
    });
  }

  // ── Blank cell references (book-mining) ──────────────────────────────────
  // Sourced from three independent corroborating sources found in a
  // book-mining pass: Clermont, Hanin & Mittermeir's field-audit paper
  // (EuSpRIG) — "reference to empty cell" was one of five named error
  // categories found across 78 real client spreadsheets; Patrick
  // O'Beirne's "Excel 2013 Spreadsheet Inquire" review (EuSpRIG 2013),
  // listing "Formulas referring to empty cells" among Excel's own
  // built-in error-checking rules; and the Operis Analysis Kit manual's
  // "Search | References to blank cell" command. Deliberately scoped to
  // bare single-cell references only, never a cell inside a multi-cell
  // range — all three sources warn that intentional range padding is
  // common and must not be flagged. A real-file test run also
  // surfaced a genuine false-positive class (a structural spacer/label
  // column with low overall population) which is now filtered too.
  //
  // FIX: found via investigating a real production run — 27 genuinely
  // distinct target-row patterns were hidden inside one undifferentiated
  // 200-item cap, all sharing a single low-severity finding ID. The
  // largest (145 references to a completely blank, labeled "Lease Cash
  // Outgoings" row — a real, material cost category potentially missing
  // from the entire model) was getting the exact same visibility as a
  // single one-off reference. Grouped by distinct target sheet+row
  // instead, via the shared groupBlankCellReferencesByTarget function
  // (not duplicated inline here), so each real pattern surfaces as its
  // own finding, with confidence scaled by occurrence count.
  const blankCellRefCheck = (() => { try { return checkBlankCellReferences(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Blank cell reference check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (blankCellRefCheck.applicable && blankCellRefCheck.findings.length > 0) {
    const groups = groupBlankCellReferencesByTarget(blankCellRefCheck.findings);
    groups.forEach(({ groupId, targetCell, count, findings: groupFindings }) => {
      const sample = groupFindings.slice(0, 5).map(f => f.cell).join(', ');
      const isSystematic = count >= 10;
      // FIX (R-18): use the genuine sheet/cell location already
      // available in targetCell, instead of hardcoding placeholders.
      const [targetSheet, targetCellAddr] = targetCell.includes('!') ? targetCell.split('!') : ['', 'A1'];
      allFlagged.push({
        id: groupId,
        label: `${count} formula(s) reference the genuinely blank cell ${targetCell}`,
        severity: isSystematic ? 'medium' : 'low', status: 'fail',
        sheet: targetSheet, cell: targetCellAddr, category: 'Structure',
        condition: `${count} formula(s) contain a bare reference to ${targetCell}, which is genuinely blank across the cells checked, including: ${sample}.`,
        reason: `${count} formula(s) reference the blank cell ${targetCell}`,
        corrective_action: `Confirm whether ${targetCell} and the row it's part of should contain real data — this pattern repeats across ${count} formula(s), which is a stronger signal of a systematic gap than an isolated reference.`,
        workstream: 'Structure', category: 'Structure', issue_type: 'Reference to blank cell',
        model_risk: isSystematic
          ? `A row referenced ${count} times but never populated is a strong signal of a genuinely missing line item — Excel evaluates the blank reference as 0 with no visible error, so this can silently omit a real cost, revenue, or other figure across the entire model.`
          : 'Excel evaluates a blank reference as 0 today with no visible error — but a stray value later landing in that cell would silently flow into the calculation with no warning.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: `Formula(s) reference the blank cell ${targetCell}`, escalation_flag: false,
        urgency: isSystematic ? 'Before next reliance' : 'Next scheduled review',
        confidence: isSystematic ? 55 : 40,
        root_cause_id: groupId, master_finding_id: groupId,
        occurrence_count: count, material_occurrence_count: count,
        affected_cells: groupFindings.map(f => `${f.sheet}!${f.cell}`),
        affected_sheets: [...new Set(groupFindings.map(f => f.sheet))],
        common_remediation_action: 'Confirm whether the reference is intentional; delete it or populate the referenced cell as appropriate.',
      });
    });
  }

  // ── Revenue double-counting (G4) ─────────────────────────────────────────
  // Sourced from "Issues the Audit Missed." Scoped deliberately narrower
  // than full multi-path graph tracing: flags a revenue source cell
  // summed into two or more SEPARATE "Total Revenue"-style aggregations,
  // not one total simply linking to another (a harmless pass-through).
  const revDoubleCountCheck = (() => { try { return checkRevenueDoubleCounting(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Revenue double-counting check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (revDoubleCountCheck.applicable && revDoubleCountCheck.findings.length > 0) {
    const sample = revDoubleCountCheck.findings.slice(0, 5).map(f => f.componentCell).join(', ');
    allFlagged.push({
      id: 'T0-REVDOUBLE-001',
      label: `${revDoubleCountCheck.findings.length} revenue source(s) summed into multiple separate totals`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${revDoubleCountCheck.findings.length} revenue source cell(s) are summed into two or more separately-labelled "Total Revenue" aggregations, including: ${sample}.`,
      reason: `${revDoubleCountCheck.findings.length} revenue source(s) contribute to multiple distinct revenue totals`,
      corrective_action: 'Confirm whether these totals are ever combined further downstream — if so, this revenue source is being counted more than once in the combined figure.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Revenue double-counting risk',
      model_risk: 'A revenue source counted in two separate totals inflates any downstream figure that combines both totals, without producing any visible error.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Revenue source cell is summed into multiple separate revenue-total aggregations', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 50,
      ...buildRootCauseFields('T0-REVDOUBLE-001', revDoubleCountCheck, { commonRemediationAction: 'Confirm whether these totals are ever combined downstream; if so, remove the double-counted source from one of them.' })
    });
  }

  // ── Display rounds to zero ───────────────────────────────────────────────
  // Sourced from ICAEW's "How to Review a Spreadsheet" (D6). Only the
  // no-decimal-place percentage format case is checked, matching the
  // specific example ICAEW cites.
  const displayZeroCheck = (() => { try { return checkDisplayRoundsToZero(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Display-rounds-to-zero check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (displayZeroCheck.applicable && displayZeroCheck.findings.length > 0) {
    const sample = displayZeroCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-DISPLAYZERO-001',
      label: `${displayZeroCheck.findings.length} cell(s) with a nonzero value displaying as "0%"`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${displayZeroCheck.findings.length} cell(s) hold a small nonzero percentage but are formatted with no decimal places, displaying as "0%" — indistinguishable from a genuine zero, including: ${sample}${displayZeroCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${displayZeroCheck.findings.length} cell(s) display as 0% despite a nonzero underlying value`,
      corrective_action: 'Add a decimal place to the number format for these cells, or confirm the near-zero value is genuinely intended.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Display rounds to zero',
      model_risk: 'A reviewer scanning displayed values would reasonably read this as exactly zero, potentially missing a real, small, nonzero driver.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Cell value rounds to 0% under its own number format', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 60,
      ...buildRootCauseFields('T0-DISPLAYZERO-001', displayZeroCheck, { commonRemediationAction: 'Add a decimal place to the number format, or confirm the near-zero value is genuinely intended.' })
    });
  }

  // ── Custom number-format unit-hiding ─────────────────────────────────────
  // Sourced from PwC's "Essence of Spreadsheet Evil" list (D1). Real
  // false-positive class found and fixed: formats with an embedded
  // quoted unit label (e.g. "M") are self-documenting, not hiding
  // anything — 256 such cases on a real file were confirmed and
  // excluded before this shipped.
  const customFormatCheck = (() => { try { return checkCustomFormatUnitHiding(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Custom-format unit-hiding check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (customFormatCheck.applicable && customFormatCheck.findings.length > 0) {
    const sample = customFormatCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell} (${f.scaleLabel})`).join(', ');
    allFlagged.push({
      id: 'T0-UNITHIDE-001',
      label: `${customFormatCheck.findings.length} cell(s) with an unlabelled scaling number format`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${customFormatCheck.findings.length} cell(s) use a custom number format that divides the displayed value (thousands/millions) with no unit label baked into the format itself, including: ${sample}${customFormatCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${customFormatCheck.findings.length} cell(s) use an unlabelled scaling number format`,
      corrective_action: 'Confirm the sheet or column header clearly states the display scale, or add a unit suffix directly into the number format.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Unlabelled scaling number format',
      model_risk: 'A reviewer scanning raw displayed values without noticing the format can misread magnitude by orders of magnitude.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Number format scales the displayed value with no embedded unit label', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 40,
      ...buildRootCauseFields('T0-UNITHIDE-001', customFormatCheck, { commonRemediationAction: 'Confirm the header states the display scale, or add a unit suffix directly into the number format.' })
    });
  }

  // ── Revolver/cash zero-balance cross-check ───────────────────────────────
  // Sourced from FMI's "Checking and Reviewing a Model" (D2).
  const revCashCheck = (() => { try { return checkRevolverCashCrosscheck(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Revolver/cash cross-check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (revCashCheck.applicable && revCashCheck.findings.length > 0) {
    const sample = revCashCheck.findings.slice(0, 5).map(f => `${f.sheet}!${f.revolverCell} (${f.pattern})`).join(', ');
    allFlagged.push({
      id: 'T0-REVCASH-001',
      label: `${revCashCheck.findings.length} period(s) with an inconsistent revolver/cash pattern`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${revCashCheck.findings.length} period(s) show either an undrawn revolver with non-positive cash, or a meaningfully drawn revolver with ample cash also present, including: ${sample}.`,
      reason: `${revCashCheck.findings.length} period(s) show an inconsistent revolver/cash relationship`,
      corrective_action: 'Confirm the revolver draw/repayment logic correctly responds to the cash position each period.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Revolver/cash inconsistency',
      model_risk: 'A revolver mechanism that doesn\'t correctly draw to cover a cash shortfall (or unnecessarily draws when cash is ample) misstates liquidity and interest expense.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Revolver balance and cash balance show an inconsistent relationship in the same period', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 50,
      ...buildRootCauseFields('T0-REVCASH-001', revCashCheck, { commonRemediationAction: 'Confirm the revolver draw/repayment logic correctly responds to the cash position each period.' })
    });
  }

  // ── Blank-cell reference at period boundary ──────────────────────────────
  // Sourced from PwC Global Financial Modeling Guidelines (D1). Confirmed
  // genuine on real Carlsberg data before shipping.
  const blankBoundaryCheck = (() => { try { return checkBlankCellBoundary(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Blank-cell boundary check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (blankBoundaryCheck.applicable && blankBoundaryCheck.findings.length > 0) {
    const sample = blankBoundaryCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-BLANKBOUND-001',
      label: `${blankBoundaryCheck.findings.length} opening-balance reference(s) to a blank cell`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${blankBoundaryCheck.findings.length} first-period opening-balance cell(s) reference a genuinely blank cell rather than an explicit zero, including: ${sample}${blankBoundaryCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${blankBoundaryCheck.findings.length} opening-balance formula(s) reference a blank cell`,
      corrective_action: 'Replace the blank-cell reference with an explicit 0, or confirm the referenced cell is intentionally reserved and will never hold a stray value.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Blank-cell boundary reference',
      model_risk: 'Evaluates correctly today (Excel treats a blank as 0), but any future stray value in that cell would silently flow into the opening balance with no warning.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Opening-balance formula references a genuinely blank cell rather than an explicit zero', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 55,
      ...buildRootCauseFields('T0-BLANKBOUND-001', blankBoundaryCheck, { commonRemediationAction: 'Replace the blank-cell reference with an explicit 0.' })
    });
  }

  // ── Balance-sheet plug detection ─────────────────────────────────────────
  // Sourced from ICAEW's "How to Review a Spreadsheet" (D6). Deliberately
  // narrow: only flags a cell that is BOTH plug-labelled AND has a
  // residual formula shape — does not attempt to infer plug-ness from
  // formula structure alone, which would need identifying which cell is
  // "the check" being forced to balance, a Tier 2-level judgment call.
  const plugCheck = (() => { try { return checkBalanceSheetPlug(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Balance-sheet plug check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (plugCheck.applicable && plugCheck.findings.length > 0) {
    const sample = plugCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell} ("${f.labelText}")`).join(', ');
    allFlagged.push({
      id: 'T0-BSPLUG-001',
      label: `${plugCheck.findings.length} labelled balancing/plug figure(s) with a residual formula`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${plugCheck.findings.length} cell(s) are labelled as a balancing figure/plug and use a residual formula (a SUM combined with a subtraction), including: ${sample}.`,
      reason: `${plugCheck.findings.length} labelled plug/balancing cell(s) found with a residual formula shape`,
      corrective_action: 'Confirm what this line represents commercially, and whether its presence indicates an unresolved discrepancy elsewhere that should be traced to its root cause instead.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Balancing figure / plug',
      model_risk: 'A plug can mask a genuine error elsewhere in the model by absorbing the discrepancy into an unexplained residual line rather than surfacing it.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Cell is labelled as a balancing/plug figure and computes a residual', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 55,
      ...buildRootCauseFields('T0-BSPLUG-001', plugCheck, { commonRemediationAction: 'Confirm what this line represents commercially; trace any unresolved discrepancy to its root cause instead of leaving it as a plug.' })
    });
  }

  // ── Period-sequence gap detection (L11) ──────────────────────────────────
  // Sourced from "Excel for Auditors" (Jelen & Dowell).
  const periodGapCheck = (() => { try { return checkPeriodSequenceGaps(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Period-sequence gap check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (periodGapCheck.applicable && periodGapCheck.findings.length > 0) {
    const sample = periodGapCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.beforeCell}->${f.afterCell}`).join(', ');
    allFlagged.push({
      id: 'T0-PERIODGAP-001',
      label: `${periodGapCheck.findings.length} irregular gap(s) found in a period/date sequence`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${periodGapCheck.findings.length} location(s) show a period/date sequence gap well beyond the row's own established spacing, including: ${sample}${periodGapCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${periodGapCheck.findings.length} irregular period-sequence gap(s) found`,
      corrective_action: 'Confirm whether a period was intentionally skipped, or a column/record was deleted from the sequence without the surrounding logic being adjusted.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Period-sequence gap',
      model_risk: 'A skipped or deleted period can silently break period-over-period formulas that assume a continuous, regularly-spaced sequence.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Date/period sequence shows a gap well beyond the row\'s established spacing', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 60,
      ...buildRootCauseFields('T0-PERIODGAP-001', periodGapCheck, { commonRemediationAction: 'Confirm whether a period was intentionally skipped, or a column/record was deleted without adjusting the surrounding logic.' })
    });
  }

  // ── STDEVA/VARA usage (L21) ───────────────────────────────────────────────
  // Sourced from "Mastering Advanced Excel Formulas and Functions" (Suman).
  const stdevaCheck = (() => { try { return checkStdevaVaraUsage(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  STDEVA/VARA check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (stdevaCheck.applicable && stdevaCheck.findings.length > 0) {
    const sample = stdevaCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell} (${f.functionUsed})`).join(', ');
    allFlagged.push({
      id: 'T0-STDEVA-001',
      label: `${stdevaCheck.findings.length} STDEVA()/VARA() usage(s)`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${stdevaCheck.findings.length} formula(s) use STDEVA()/VARA(), which include text and logical values in their calculation, including: ${sample}${stdevaCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${stdevaCheck.findings.length} formula(s) use STDEVA()/VARA() instead of STDEV()/VAR()`,
      corrective_action: 'Confirm this is intentional, not a mistyped or pasted function name — if the range includes any header, label, or flag cell, this will silently distort the result.',
      workstream: 'Structure', category: 'Structure', issue_type: 'STDEVA/VARA usage',
      model_risk: 'A range containing a header, label, or boolean flag alongside real numeric data will silently distort the statistic under STDEVA/VARA, without producing any visible error.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Formula uses STDEVA()/VARA() rather than STDEV()/VAR()', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 65,
      ...buildRootCauseFields('T0-STDEVA-001', stdevaCheck, { commonRemediationAction: 'Confirm this is intentional, not a mistyped or pasted function name.' })
    });
  }

  // ── Data Validation presence on inputs (L24) ─────────────────────────────
  // Sourced from ICAEW's "How to Review a Spreadsheet". Purely
  // informational — absence of Data Validation is common and normal,
  // never itself a defect. Only surfaced when coverage is genuinely
  // near-zero among a meaningful number of identified input cells.
  const dataValCheck = (() => { try { return checkDataValidationPresence(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Data Validation presence check failed:', e.message); return { applicable:false, inputCells:0, withValidation:0 }; } })();
  if (dataValCheck.applicable && dataValCheck.inputCells >= 20 && dataValCheck.coverageFraction < 0.05) {
    allFlagged.push({
      id: 'T0-DATAVALID-001',
      label: `${dataValCheck.withValidation} of ${dataValCheck.inputCells} input cell(s) carry Data Validation`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${dataValCheck.note}`,
      reason: 'Informational — Data Validation coverage on identified input cells is near zero',
      corrective_action: 'Informational only — consider adding Data Validation on key input cells to reduce the risk of an out-of-range value being entered, if that risk is material for this model.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Data Validation coverage (informational)',
      model_risk: 'No material risk implied by absence alone — this is a governance observation, not a defect.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Input cells identified via font colour convention carry no Data Validation rule', escalation_flag: false,
      urgency: 'Informational', confidence: 40,
      root_cause_id: 'T0-DATAVALID-001',
      master_finding_id: 'T0-DATAVALID-001',
      occurrence_count: dataValCheck.inputCells - dataValCheck.withValidation,
      material_occurrence_count: dataValCheck.inputCells - dataValCheck.withValidation,
      affected_cells: dataValCheck.examplesWithout || [],
      affected_sheets: [...new Set((dataValCheck.examplesWithout || []).map(ref => ref.split('!')[0]))],
      common_remediation_action: 'Consider adding Data Validation on key input cells if out-of-range entry is a material risk for this model.',
    });
  }

  // ── Cell-locking governance signal (L25) ─────────────────────────────────
  // Sourced from "Excel for Auditors" (Jelen & Dowell). Only evaluated
  // where sheet protection is actually enabled — absence of protection
  // is common and not itself flagged.
  const cellLockCheck = (() => { try { return checkCellLockingGovernance(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Cell-locking governance check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (cellLockCheck.applicable && cellLockCheck.findings.length > 0) {
    const sample = cellLockCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell} (${f.issue})`).join(', ');
    allFlagged.push({
      id: 'T0-CELLLOCK-001',
      label: `${cellLockCheck.findings.length} cell(s) with a lock state inconsistent with their role`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `Sheet protection is enabled on ${cellLockCheck.protectedSheets.join(', ')}. ${cellLockCheck.findings.length} cell(s) have a lock state inconsistent with their apparent role, including: ${sample}${cellLockCheck.findings.length > 8 ? ' and others' : ''}.`,
      reason: `${cellLockCheck.findings.length} cell(s) show an inconsistent lock state under active sheet protection`,
      corrective_action: 'Confirm whether the locked/unlocked state of these cells is intentional — an input cell left locked cannot be edited without unprotecting the sheet, and a formula cell left unlocked can be overwritten despite protection.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Cell-locking inconsistency',
      model_risk: 'An input cell locked under active protection blocks legitimate editing; a formula cell left unlocked defeats the purpose of protecting the sheet.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Cell lock state does not match its apparent input/formula role under active sheet protection', escalation_flag: false,
      urgency: 'Next scheduled review', confidence: 55,
      ...buildRootCauseFields('T0-CELLLOCK-001', cellLockCheck, { commonRemediationAction: 'Confirm whether the locked/unlocked state of each flagged cell is intentional.' })
    });
  }

  // ── A4 — Key-output dependency-chain tracing ────────────────────────────
  const keyOutputChainCheck = (() => { try { return checkKeyOutputChains(parsed._raw, tier0.cellScoreIndex, parsed.sheetNames); }
    catch (e) { console.error('   \u26a0\ufe0f  Key-output chain check failed:', e.message); return { applicable:false, flaggedCount:0, results:[] }; } })();
  if (keyOutputChainCheck.applicable && keyOutputChainCheck.results.length > 0) {
    keyOutputChainCheck.results.forEach((r) => {
      const affectedList = r.affectedOutputs.map(o => `${o.labelText} (${o.sheet}!${o.cell})`).join(', ');
      const isError = r.type === 'error_propagation';
      allFlagged.push({
        id: `T0-CHAIN-${r.sheet.replace(/[^A-Za-z0-9]/g, '')}-${r.cell}`,
        label: isError
          ? `${r.sheet}!${r.cell} holds a cached error (${r.value}) that ${r.affectedOutputs.length} key output(s) trace back through`
          : `${r.sheet}!${r.cell} is blank, and ${r.affectedOutputs.length} key output(s) trace back through it`,
        severity: 'medium', status: 'fail',
        sheet: r.sheet, cell: r.cell, category: 'Structure',
        condition: isError
          ? `Tracing the formula chain behind these key outputs back through their precedents reaches ${r.sheet}!${r.cell}, which holds a cached error value (${r.value}). Affected: ${affectedList}.`
          : `Tracing the formula chain behind these key outputs back through their precedents reaches ${r.sheet}!${r.cell}, which is blank — no formula and no value. Affected: ${affectedList}. This may be a genuinely missing input, or a template column for a period not yet populated — confirm which before treating this as an error.`,
        reason: isError ? `Cached error propagating to ${r.affectedOutputs.length} key output(s)` : `Blank cell reached by ${r.affectedOutputs.length} key output(s)`,
        corrective_action: isError
          ? 'Investigate and resolve the underlying error at its source rather than the symptom in each affected output.'
          : 'Confirm whether this cell is expected to be blank (e.g. a future period not yet reached) or is a genuinely missing input feeding these outputs.',
        workstream: 'Structure', category: 'Structure', issue_type: isError ? 'Error propagation to key output' : 'Key output chain reaches blank cell',
        model_risk: isError
          ? 'A cached error at the root of a chain means every key output depending on it is unreliable until the error is resolved.'
          : 'If genuinely missing rather than an expected placeholder, every key output depending on this cell is currently understating or misstating its true value.',
        key_output_impact: affectedList,
        method: 'automated', needs_retest: true,
        root_cause: isError ? 'Cached formula error at a shared precedent cell' : 'Shared precedent cell is blank',
        escalation_flag: false, urgency: 'Before next reliance', confidence: 70
      });
    });
  }

  // ── FAST Standard checks — four rules confirmed directly against a real
  // copy of the FAST Standard (02c, July 2019). Each aggregates into ONE
  // finding per check, not one per instance.
  const npvCheck = (() => { try { return checkBareNPV(tier0.cellScoreIndex); }
    catch (e) { console.error('   \u26a0\ufe0f  Bare NPV check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (npvCheck.applicable && npvCheck.findings.length > 0) {
    const sample = npvCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-NPV-001',
      label: `${npvCheck.findings.length} formula cell(s) use NPV() rather than XNPV()`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${npvCheck.findings.length} formula cell(s) use NPV(), including: ${sample}${npvCheck.findings.length > 8 ? ' and others' : ''}. NPV() assumes the first cash flow occurs exactly one period from today and every subsequent flow is evenly spaced — an assumption that rarely matches a real model's actual dates. XNPV (using actual dates) avoids this silent timing mismatch. This is a named rule in the FAST Standard (FAST 4.01-02).`,
      reason: `${npvCheck.findings.length} cell(s) use NPV() instead of XNPV()`,
      corrective_action: 'Confirm the timing assumption embedded in each NPV() call is actually correct for this model, or replace with XNPV using the model\'s real dates.',
      workstream: 'Structure', category: 'Structure', issue_type: 'NPV timing assumption',
      model_risk: 'A silent, uncommunicated assumption about cash flow timing can materially misstate a discounted value without ever producing a visible error.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'NPV() used instead of XNPV()', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 90
    });
  }

  const nestedIfCheck = (() => { try { return checkNestedIFs(tier0.cellScoreIndex); }
    catch (e) { console.error('   \u26a0\ufe0f  Nested IF check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (nestedIfCheck.applicable && nestedIfCheck.findings.length > 0) {
    const sheetCounts = {};
    nestedIfCheck.findings.forEach(f => { sheetCounts[f.sheet] = (sheetCounts[f.sheet] || 0) + 1; });
    const sheetSummary = Object.entries(sheetCounts).slice(0, 6).map(([s, c]) => `${s} (${c})`).join(', ');
    const sample = nestedIfCheck.findings.slice(0, 5).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-NESTEDIF-001',
      label: `${nestedIfCheck.findings.length} formula cell(s) contain nested IF statements`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${nestedIfCheck.findings.length} formula cell(s) contain a nested IF (an IF statement inside another IF's own arguments), concentrated in: ${sheetSummary}. Examples: ${sample}. Nested IFs are a named FAST Standard anti-pattern (FAST 3.03-07) — they take materially longer to decode correctly and are prone to untested combinations of logical states.`,
      reason: `${nestedIfCheck.findings.length} cell(s) contain nested IF logic`,
      corrective_action: 'Consider replacing nested IFs with flag-based multiplication or INDEX/CHOOSE lookups where the logic allows — particularly for the highest-concentration sheets listed.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Nested IF statements',
      model_risk: 'Nested conditional logic is difficult to fully test — a combination of conditions that was never exercised during model construction can silently produce the wrong branch.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Nested IF statements', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 95
    });
  }

  const mergedCellCheck = (() => { try { return checkMergedCells(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Merged cell check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (mergedCellCheck.applicable && mergedCellCheck.findings.length > 0) {
    const totalMerges = mergedCellCheck.findings.reduce((sum, f) => sum + f.mergeCount, 0);
    const sheetSummary = mergedCellCheck.findings.slice(0, 8).map(f => `${f.sheet} (${f.mergeCount})`).join(', ');
    allFlagged.push({
      id: 'T0-MERGE-001',
      label: `${totalMerges} merged cell range(s) across ${mergedCellCheck.findings.length} sheet(s)`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${totalMerges} merged cell range(s) found across: ${sheetSummary}${mergedCellCheck.findings.length > 8 ? ' and others' : ''}. Merged cells break column/row selection consistency and are a named FAST Standard anti-pattern (FAST 4.02-02) — FAST's own stated concern is directly relevant to automated review: some model-audit tools will silently unmerge cells while processing a file, which can itself alter the workbook.`,
      reason: `${totalMerges} merged range(s) across ${mergedCellCheck.findings.length} sheet(s)`,
      corrective_action: 'Confirm merged cells are confined to presentation/header areas rather than calculation blocks — centre-across-selection formatting achieves the same visual effect without merging.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Merged cells',
      model_risk: 'Merged cells in or near calculation areas can silently drop values (only the upper-left cell of a merge retains its value) and complicate automated or manual review alike.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Merged cell ranges present', escalation_flag: false,
      urgency: 'When convenient', confidence: 100
    });
  }

  const hiddenCheck = (() => { try { return checkHiddenRowsColumns(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Hidden rows/columns check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (hiddenCheck.applicable && hiddenCheck.findings.length > 0) {
    const withLogic = hiddenCheck.findings.filter(f => (f.hiddenRowsWithLogicCount || 0) > 0 || (f.hiddenColsWithLogicCount || 0) > 0);
    const metadataOnly = hiddenCheck.findings.filter(f => (f.hiddenRowsWithLogicCount || 0) === 0 && (f.hiddenColsWithLogicCount || 0) === 0);

    if (withLogic.length > 0) {
      const sheetSummary = withLogic.slice(0, 8).map(f => `${f.sheet} (${f.hiddenRowsWithLogicCount} row(s), ${f.hiddenColsWithLogicCount} col(s) with live formula logic)`).join(', ');
      allFlagged.push({
        id: 'T0-HIDDEN-001',
        label: `${withLogic.length} sheet(s) contain hidden rows or columns with live formula logic`,
        severity: 'high', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `Hidden rows and/or columns containing at least one formula cell found on: ${sheetSummary}${withLogic.length > 8 ? ' and others' : ''}. This is distinct from the separate check for entirely hidden sheets — these are hidden ranges within otherwise-visible sheets, and unlike a purely presentational hidden range, these specifically contain live calculation logic a normal review would never see. The FAST Standard names this explicitly (FAST 2.01-08): hidden ranges can conceal stale, overridden, or manipulated values from a reviewer who is only looking at what's visible.`,
        reason: `Hidden rows/columns containing live formula logic found on ${withLogic.length} sheet(s)`,
        corrective_action: 'Unhide and review the contents of each hidden range to confirm the calculation logic inside it is genuinely intentional and correctly reflected in any downstream, visible output that depends on it.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Hidden rows or columns with live formula logic',
        model_risk: 'A hidden row or column containing live formula logic is invisible during a normal visual review, and any manual override, stale value, or calculation error sitting inside one would not be caught without deliberately unhiding it.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
        root_cause: 'Hidden rows or columns containing live formula logic present', escalation_flag: false,
        urgency: 'Before next reliance', confidence: 100
      });
    }
    if (metadataOnly.length > 0) {
      const sheetSummary = metadataOnly.slice(0, 8).map(f => `${f.sheet} (${f.hiddenRowCount} row(s), ${f.hiddenColCount} col(s))`).join(', ');
      allFlagged.push({
        id: 'T0-HIDDEN-002',
        label: `${metadataOnly.length} sheet(s) contain hidden rows or columns with no formula content (likely presentation/provenance metadata)`,
        severity: 'low', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `Hidden rows and/or columns with no formula cells at all found on: ${sheetSummary}${metadataOnly.length > 8 ? ' and others' : ''}. Contains no live calculation logic — consistent with intentionally-hidden presentation or supporting-register content (e.g. provenance/documentation columns) rather than concealed calculations, but still worth a quick confirmation.`,
        reason: `Hidden rows/columns with no formula content found on ${metadataOnly.length} sheet(s)`,
        corrective_action: 'Spot-confirm this hidden content is genuinely presentation/metadata only, not a hardcoded value that should be a live formula.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Hidden rows or columns (metadata only)',
        model_risk: 'Lower risk than hidden live logic, but a hardcoded value sitting in a hidden, metadata-style range would still not be caught without deliberately unhiding it.',
        key_output_impact: 'No', method: 'automated', needs_retest: false,
        root_cause: 'Hidden rows or columns present, containing no formula cells', escalation_flag: false,
        urgency: 'Informational', confidence: 100
      });
    }
  }

  // G1 — hardcoded check/reconciliation cells.
  const hardcodedCheckResult = (() => { try { return checkHardcodedCheckCells(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Hardcoded check-cell scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (hardcodedCheckResult.applicable) {
    const highConf = hardcodedCheckResult.findings.filter(f => f.confidence === 'high');
    const lowConf = hardcodedCheckResult.findings.filter(f => f.confidence === 'low');
    if (highConf.length > 0) {
      const sample = highConf.slice(0, 8).map(f => `${f.sheet}!${f.cell} ("${f.label}" = ${JSON.stringify(f.value)})`).join(', ');
      const lowNote = lowConf.length > 0 ? ` A further ${lowConf.length} lower-confidence candidate(s) were also found but are more likely to be column headers or period labels than genuine check results — not included above, worth a manual glance if time allows.` : '';
      const totalCount = highConf.length + lowConf.length;
      const breakdown = lowConf.length > 0 ? ` (${highConf.length} high-confidence, ${lowConf.length} lower-confidence)` : '';
      allFlagged.push({
        id: 'T0-HARDCHECK-001',
        label: `${totalCount} check/reconciliation cell(s) appear hardcoded rather than formula-driven${breakdown}`,
        severity: 'high', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `${highConf.length} of ${totalCount} cell(s) in a check- or reconciliation-labeled row show a static, typed-in pass/fail-style value with no formula behind them, with high confidence: ${sample}.${lowNote} A hardcoded check result will keep showing the same outcome forever, regardless of what the underlying numbers actually do — the model could stop passing this test and the cell would never reflect it.`,
        reason: `${totalCount} check cell(s) appear to be hardcoded rather than live${breakdown}`,
        corrective_action: 'Replace each flagged cell with a formula that genuinely compares the observed result against the expected result, rather than a static status.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Hardcoded check cell',
        model_risk: 'A check cell that cannot fail gives false assurance — a reviewer sees "PASS" and trusts it, without realising the cell never actually recalculates.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: 'Check result hardcoded rather than formula-driven', escalation_flag: false,
        urgency: 'Before next reliance', confidence: 85
      });
    }
  }

  // G7 — genuine circular-reference detection.
  const circularRefResult = (() => { try { return checkCircularReferences(tier0.cellScoreIndex, parsed.sheetNames, parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Circular reference detection failed:', e.message); return { applicable:false, totalCycles:0, dividendRelatedCycles:[], otherCycles:[] }; } })();
  if (circularRefResult.applicable) {
    if (circularRefResult.dividendRelatedCycles.length > 0) {
      const byCell = {};
      circularRefResult.dividendRelatedCycles.forEach(c => {
        if (!byCell[c.dividendCell]) byCell[c.dividendCell] = { label: c.dividendLabel, count: 0 };
        byCell[c.dividendCell].count++;
      });
      const summary = Object.entries(byCell).map(([cell, v]) => `${cell} ("${v.label}") — ${v.count} distinct cycle path(s)`).join('; ');
      const [sh, cl] = Object.keys(byCell)[0].split('!');
      allFlagged.push({
        id: 'T0-CIRC-001',
        label: `Circular reference routed through a distribution/funding decision`,
        severity: 'high', status: 'fail',
        sheet: sh, cell: cl, category: 'Structure',
        condition: `A genuine circular reference was found passing through: ${summary}. This is a distribution or funding-decision cell whose own formula depends, through a chain of precedents, on a cash balance that already reflects that same decision — the decision is calculated from its own outcome. Unlike the common, often-intentional interest-on-average-balance circularity, this pattern usually indicates a real logic error rather than a deliberate iterative-solve design choice.`,
        reason: `Circular reference through a distribution/funding-decision cell`,
        corrective_action: 'Trace the cycle in Excel (Formulas → Error Checking → Circular References) and confirm whether this is a genuine error or a deliberately iterative calculation. If deliberate, document the rationale on the Inputs sheet and confirm iterative calculation is enabled; if not, break the cycle by referencing a prior-period balance rather than the current period\'s post-decision balance.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Circular reference — distribution/funding',
        model_risk: 'A distribution or funding decision that depends on its own outcome can converge to an unstable or misleading result, or silently rely on Excel\'s iterative-calculation settings without anyone realising the model requires them.',
        key_output_impact: 'Yes', method: 'automated', needs_retest: true,
        root_cause: 'Circular reference through a distribution/funding-decision cell', escalation_flag: false,
        urgency: 'Before next reliance', confidence: 80
      });
    }
    if (circularRefResult.otherCycles.length > 0) {
      const sample = circularRefResult.otherCycles.slice(0, 3).map(c => c.path[0]).join(', ');
      allFlagged.push({
        id: 'T0-CIRC-002',
        label: `${circularRefResult.otherCycles.length} other circular reference chain(s) found`,
        severity: 'low', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `${circularRefResult.otherCycles.length} circular reference chain(s) found not involving a distribution/funding-decision cell, e.g. starting near: ${sample}. This may be a deliberate, common pattern such as interest calculated on an average debt or cash balance — not necessarily an error, but worth confirming iterative calculation is intentionally enabled and documented.`,
        reason: `${circularRefResult.otherCycles.length} circular reference chain(s) found`,
        corrective_action: 'Confirm each is a deliberate, documented circularity (e.g. interest on average balance) rather than an unintended error.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Circular reference — general',
        model_risk: 'An undocumented circular reference makes it unclear to a reviewer whether iterative calculation is required by design or is masking an error.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
        root_cause: 'Circular reference present', escalation_flag: false,
        urgency: 'When convenient', confidence: 75
      });
    }
  }

  // G8-G11 — inspired by patterns confirmed real in the
  // petehottelet/spreadsheet-auditor project.
  const g8Result = (() => { try { return checkOffByOneRanges(tier0.cellScoreIndex); }
    catch (e) { console.error('   \u26a0\ufe0f  Off-by-one range check failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (g8Result.applicable && g8Result.findings.length > 0) {
    const sample = g8Result.findings.slice(0, 6).map(f => f.expectedEndCol
      ? `${f.cell} (ends at column ${f.actualEndCol}, its ${f.peerCount} peers mostly end at ${f.expectedEndCol})`
      : `${f.cell} (ends at row ${f.actualEndRow}, its ${f.peerCount} peers mostly end at ${f.expectedEndRow})`).join(', ');
    allFlagged.push({
      id: 'T0-OFFBYONE-001',
      label: `${g8Result.findings.length} aggregate range(s) appear shorter than their structural peers`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${g8Result.findings.length} aggregate formula(s) span a noticeably shorter range than other, structurally identical formulas nearby: ${sample}. Compared against peers (same function, same column, same range start) rather than judged in isolation — a real, specific majority pattern each of these deviates from, not a guess about what the range "should" be.`,
      reason: `${g8Result.findings.length} range(s) end earlier than their peer group's majority pattern`,
      corrective_action: 'Confirm whether the shorter range is intentional (e.g. this row genuinely covers a shorter period) or an unupdated range left behind when a column was inserted elsewhere in the block.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Off-by-one aggregate range',
      model_risk: 'A range that silently excludes the most recent period is a common, easy-to-miss error when new columns are inserted into an existing block.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Aggregate range shorter than its peer group', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 70
    });
  }

  const g9Result = (() => { try { return checkAggregateResultMismatch(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Aggregate result mismatch check failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (g9Result.applicable && g9Result.findings.length > 0) {
    const sample = g9Result.findings.slice(0, 6).map(f => `${f.sheet}!${f.cell} (shows ${f.cachedResult.toLocaleString()}, its own range sums to ${f.independentSum.toLocaleString()})`).join(', ');
    allFlagged.push({
      id: 'T0-AGGMISMATCH-001',
      label: `${g9Result.findings.length} SUM formula(s) whose cached result doesn't match their own range`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${g9Result.findings.length} formula(s) whose stored, displayed result doesn't match an independent sum of their own explicit range's own cached values: ${sample}. This can mean either the file wasn't recalculated and saved with calculation enabled before delivery, or a genuine formula error.`,
      reason: `${g9Result.findings.length} formula(s) show a cached result inconsistent with their own range`,
      corrective_action: 'Open the file in Excel, force a full recalculation (Ctrl+Alt+F9), and re-save. If the mismatch persists after recalculation, it is a genuine formula error requiring investigation.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Stale or inconsistent aggregate result',
      model_risk: 'A displayed total that doesn\'t match its own underlying data is one of the most direct forms of misleading output a reviewer can encounter.',
      key_output_impact: 'Yes', method: 'automated', needs_retest: true,
      root_cause: 'Cached formula result inconsistent with its own range', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 90
    });
  }

  const g10Result = (() => { try { return checkRangeIncludesOwnTotal(tier0.cellScoreIndex, parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Range-includes-own-total check failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (g10Result.applicable && g10Result.findings.length > 0) {
    const sample = g10Result.findings.slice(0, 6).map(f => `${f.cell} (range ${f.range} includes row ${f.subtotalRow}, labeled "${f.subtotalLabel}")`).join(', ');
    allFlagged.push({
      id: 'T0-RANGEDUP-001',
      label: `${g10Result.findings.length} SUM range(s) include a subtotal row within their own span`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${g10Result.findings.length} SUM formula(s) span a range that includes a row itself labeled as a total or subtotal, within the range rather than at its boundary: ${sample}. This likely double-counts that subtotal's own components alongside the subtotal itself.`,
      reason: `${g10Result.findings.length} range(s) likely double-count an internal subtotal`,
      corrective_action: 'Adjust the range to either sum only the line items (excluding the subtotal row) or only the subtotals (excluding the individual line items), not both.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Range includes its own subtotal',
      model_risk: 'A total that silently double-counts a subset of its own components can materially overstate a key figure without any visible error.',
      key_output_impact: 'Yes', method: 'automated', needs_retest: true,
      root_cause: 'Aggregate range includes an internal subtotal row', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 80
    });
  }

  const g11Result = (() => { try { return checkSuspiciousErrorMasking(tier0.cellScoreIndex); }
    catch (e) { console.error('   \u26a0\ufe0f  Error-masking check failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (g11Result.applicable && g11Result.findings.length > 0) {
    const sample = g11Result.findings.slice(0, 8).map(f => `${f.cell} (${f.functionName} falls back to ${f.fallbackValue})`).join(', ');
    allFlagged.push({
      id: 'T0-ERRMASK-001',
      label: `${g11Result.findings.length} IFERROR/IFNA cell(s) fall back to a specific non-zero hardcoded value`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${g11Result.findings.length} cell(s) use IFERROR or IFNA with a fallback to a specific, non-zero hardcoded number rather than 0 or blank: ${sample}. Falling back to 0 or blank for an expected edge case (e.g. an early-period ratio dividing by zero) is common and usually safe — falling back to a specific number is less common and can look like a plug masking whatever the underlying formula would otherwise have produced.`,
      reason: `${g11Result.findings.length} cell(s) mask errors with a specific non-zero fallback`,
      corrective_action: 'Confirm each flagged fallback value is a deliberate, reasoned default rather than a plug covering an unresolved formula issue.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Non-zero error-masking fallback',
      model_risk: 'A hardcoded fallback value can silently substitute for a broken calculation indefinitely, with no visible indication anything is wrong.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'IFERROR/IFNA falls back to a specific non-zero value', escalation_flag: false,
      urgency: 'When convenient', confidence: 65
    });
  }

  // G12 — PII detection.
  const piiResult = (() => { try { return checkPII(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  PII scan failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (piiResult.applicable && piiResult.findings.length > 0) {
    const highConf = piiResult.findings.filter(f => f.confidence === 'high');
    const lowConf = piiResult.findings.filter(f => f.confidence === 'low');
    if (highConf.length > 0) {
      const byType = {};
      highConf.forEach(f => { (byType[f.type] ||= []).push(`${f.sheet}!${f.cell}`); });
      const summary = Object.entries(byType).map(([type, cells]) => `${type}: ${cells.slice(0,5).join(', ')}${cells.length > 5 ? ` and ${cells.length-5} more` : ''}`).join('; ');
      const lowNote = lowConf.length > 0 ? ` A further ${lowConf.length} lower-confidence candidate(s) were also found, requiring row-label context to trigger — worth a manual glance.` : '';
      allFlagged.push({
        id: 'T0-PII-001',
        label: `${highConf.length} cell(s) appear to contain personally identifiable information`,
        severity: 'high', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `${highConf.length} cell(s) contain data matching a recognised PII pattern: ${summary}.${lowNote} Values are not reproduced here — only the cell locations. This workbook may not be safe to share as broadly as a typical financial model, or the data may need to be removed or redacted before wider circulation.`,
        reason: `${highConf.length} cell(s) appear to contain PII`,
        corrective_action: 'Confirm whether this data is genuinely needed in the model; if not, remove it. If it is needed, restrict circulation of this workbook accordingly and consider whether it should be masked or moved to a separate, access-controlled file.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Personally identifiable information detected',
        model_risk: 'A financial model is often circulated more broadly than its original author expects — investment committees, lenders, advisors. PII embedded in the workbook travels with it.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: 'Cell value matches a recognised PII pattern', escalation_flag: true,
        urgency: 'Before external circulation', confidence: 85
      });
    }
  }

  // A1 — real formula recalculation vs. cached values, via Formualizer.
  // Requires `pip install formualizer openpyxl` on the server.
  const recalcCheckResult = await (async () => {
    try {
      const scriptPath = path.join(__dirname, 'src', 'recalc_check.py');
      const stdout = await new Promise((resolve, reject) => {
        execFile('python3', [scriptPath, parsed._filePath],
          { timeout: 180000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
          (err, stdout, stderr) => {
            if (err) { if (stderr) err.message += `\nstderr: ${stderr}`; return reject(err); }
            resolve(stdout);
          });
      });
      return JSON.parse(stdout.trim());
    } catch (e) {
      console.error('   \u26a0\ufe0f  Recalculation check failed to run:', e.message);
      return { status: 'failed_to_run' };
    }
  })();

  if (recalcCheckResult.status === 'unavailable') {
    console.log(`   \u2139\ufe0f  Recalculation check skipped: ${recalcCheckResult.reason} (run 'pip install formualizer openpyxl' on the server to enable)`);
  } else if (recalcCheckResult.status === 'skipped_too_large') {
    console.log(`   \u2139\ufe0f  Recalculation check skipped: ${recalcCheckResult.formula_cells.toLocaleString()} formula cells exceeds the ${recalcCheckResult.threshold.toLocaleString()}-cell safety threshold (see recalc_check.py for tuning notes).`);
  } else if (recalcCheckResult.status === 'success') {
    if (recalcCheckResult.sanitized_defined_names_count > 0) {
      console.log(`   \u2139\ufe0f  Recalculation check succeeded after removing ${recalcCheckResult.sanitized_defined_names_count} defined name(s) containing "?" that this workbook's recalculation engine cannot parse (${recalcCheckResult.sanitized_defined_names.join(', ')}) \u2014 ${recalcCheckResult.sanitized_formula_cells_affected} formula cell(s) referencing them may show as unresolved rather than compared; every other cell was recalculated and compared normally.`);
    }
    if (recalcCheckResult.mismatch_count > 0) {
      const sample = recalcCheckResult.mismatches.slice(0, 8)
        .map(m => `${m.sheet}!${m.cell} (shows ${m.cached.toLocaleString()}, recalculates to ${m.recalculated.toLocaleString()})`).join(', ');
      allFlagged.push({
        id: 'T0-RECALC-001',
        label: `${recalcCheckResult.mismatch_count} formula cell(s) recalculate to a different value than their cached result`,
        severity: 'high', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `A genuine, full-workbook recalculation (${recalcCheckResult.formula_cells_checked.toLocaleString()} formula cells checked, correctly resolving ${recalcCheckResult.genuine_circular_groups} genuine circular dependency group(s) via iterative calculation) found ${recalcCheckResult.mismatch_count} cell(s) whose displayed, cached value doesn't match what the formula actually computes: ${sample}. This means either the file wasn't recalculated and saved with calculation enabled before delivery, or a genuine formula error exists.`,
        reason: `${recalcCheckResult.mismatch_count} cell(s) show a cached value inconsistent with a fresh recalculation`,
        corrective_action: 'Open the file in Excel, force a full recalculation (Ctrl+Alt+F9), and re-save. If mismatches persist after recalculation, investigate each flagged cell\'s formula directly.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Stale or incorrect cached formula result',
        model_risk: 'Every displayed figure in this model is only as trustworthy as its cached value — this check found cells where that trust is misplaced.',
        key_output_impact: 'Yes', method: 'automated', needs_retest: true,
        root_cause: 'Cached formula result does not match a genuine recalculation', escalation_flag: true,
        urgency: 'Before next reliance', confidence: 95
      });
    }
    if (recalcCheckResult.unconverged_circular_groups > 0) {
      allFlagged.push({
        id: 'T0-RECALC-002',
        label: `${recalcCheckResult.unconverged_circular_groups} circular calculation group(s) did not converge`,
        severity: 'high', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `${recalcCheckResult.unconverged_circular_groups} circular dependency group(s) were still changing after the maximum iteration count, rather than settling to a stable value — a genuine, unresolved circularity, not the common and usually-benign interest-on-average-balance pattern that normally converges cleanly.`,
        reason: `${recalcCheckResult.unconverged_circular_groups} circular group(s) failed to converge`,
        corrective_action: 'Investigate the specific formulas involved — an unstable circularity can mean the underlying logic is genuinely unbounded or oscillating, not just slow to settle.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Unconverged circular calculation',
        model_risk: 'A circular calculation that never settles means the model\'s displayed values may depend on exactly how many iterations Excel happened to run, not on a stable, well-defined answer.',
        key_output_impact: 'Yes', method: 'automated', needs_retest: true,
        root_cause: 'Circular calculation did not converge within the iteration limit', escalation_flag: true,
        urgency: 'Before next reliance', confidence: 90
      });
    }
  } else {
    console.log(`   \u26a0\ufe0f  Recalculation check did not complete: ${recalcCheckResult.status}${recalcCheckResult.error ? ' — ' + recalcCheckResult.error : ''}`);
    if (recalcCheckResult.reason) {
      console.log(`   \u2139\ufe0f  ${recalcCheckResult.reason}`);
    }
  }

      if (reasonableness.waccOverride.applicable && reasonableness.waccOverride.mismatch) {
        const w = reasonableness.waccOverride;
        allFlagged.push({
          id: 'T0-RSN-001', label: 'Calculated WACC differs from the applied discount rate',
          severity: 'high', status: 'fail', sheet: w.calculatedLocation.split('!')[0], cell: w.calculatedLocation.split('!')[1],
          category: 'Reasonableness', condition: w.note, reason: w.note,
          corrective_action: 'Document the rationale for the override explicitly next to the applied rate, or confirm the override was unintentional.',
          workstream: 'Valuation', issue_type: 'WACC override',
          model_risk: 'A silent override can mislead a reader into thinking the valuation is based on the calculated cost of capital when it is not.',
          key_output_impact: 'Yes', method: 'automated', needs_retest: true, root_cause: 'Discount rate override not documented',
          escalation_flag: false, urgency: 'Before external circulation', confidence: 90
        });
      }
      if (reasonableness.terminalValue.applicable && reasonableness.terminalValue.flagged) {
        const t = reasonableness.terminalValue;
        allFlagged.push({
          id: 'T0-RSN-002', label: `Terminal value represents ${(t.concentrationPct*100).toFixed(0)}% of total project NPV`,
          severity: 'high', status: 'fail', sheet: t.terminalValueLocation.split('!')[0], cell: t.terminalValueLocation.split('!')[1],
          category: 'Reasonableness', condition: t.note, reason: t.note,
          corrective_action: 'Sensitise the valuation to exit multiple compression and delayed exit timing; show what proportion of return is operating performance versus assumed exit.',
          workstream: 'Valuation', issue_type: 'Terminal value concentration',
          model_risk: 'A high proportion of total return depending on an assumed future exit, rather than demonstrated operating performance, is a higher-risk return profile than the headline NPV alone conveys.',
          key_output_impact: 'Yes', method: 'automated', needs_retest: false, root_cause: 'High reliance on terminal value',
          escalation_flag: false, urgency: 'Before external circulation', confidence: 85
        });
      }
      if (reasonableness.outputs.applicable && reasonableness.outputs.flaggedCount > 0) {
        const flaggedMetrics = reasonableness.outputs.results.filter(r => r.flagged);
        const summary = flaggedMetrics.map(r => `${r.metric} = ${r.unit==='percent' ? (r.value*100).toFixed(1)+'%' : r.value.toFixed(1)+'x'}`).join(', ');
        allFlagged.push({
          id: 'T0-RSN-003', label: `${flaggedMetrics.length} output metric(s) warrant explicit commercial-reasonableness challenge`,
          severity: 'high', status: 'fail', sheet: flaggedMetrics[0].location.split('!')[0], cell: flaggedMetrics[0].location.split('!')[1],
          category: 'Reasonableness',
          condition: `${summary}. ${reasonableness.outputs.note}`,
          reason: `Flagged: ${summary}`,
          corrective_action: 'Benchmark each flagged metric against comparable businesses; document why the model output is defensible or revise the underlying assumption.',
          workstream: 'Valuation', issue_type: 'Output reasonableness',
          model_risk: 'A model can be perfectly wired and still produce commercially unrealistic outputs — these are not automatically wrong, but require named, specific challenge before reliance.',
          key_output_impact: 'Yes', method: 'automated', needs_retest: false, root_cause: 'Aggressive underlying assumptions',
          escalation_flag: false, urgency: 'Before external circulation', confidence: 75
        });
      }
      // ── Revenue-per-unit reasonableness metric existence (2026-07-25
      // gap-analysis review) — absence of evidence is a weaker signal
      // than the positive-match checks above (the metric could exist
      // under wording this check's term list didn't anticipate), so
      // confidence is calibrated lower and framed as a query, not a
      // confirmed defect.
      if (reasonableness.revenuePerUnit.applicable && reasonableness.revenuePerUnit.found === false) {
        allFlagged.push({
          id: 'T0-RSN-004', label: 'No revenue-per-unit reasonableness metric found in this workbook',
          severity: 'medium', status: 'fail', sheet: '', cell: 'A1',
          category: 'Reasonableness', condition: reasonableness.revenuePerUnit.note, reason: reasonableness.revenuePerUnit.note,
          corrective_action: 'Add a revenue-per-unit metric (e.g. per event-night, per patron, per capacity unit, per tonne) that a reviewer can benchmark against comparable-business evidence.',
          workstream: 'Valuation', issue_type: 'Revenue reasonableness',
          model_risk: 'Without any per-unit revenue figure, the overall revenue build has no benchmarkable anchor a reviewer can sanity-check against market or comparable-operator evidence.',
          key_output_impact: 'Unknown', method: 'automated', needs_retest: false, root_cause: 'No revenue-per-unit metric built',
          escalation_flag: false, urgency: 'Next scheduled review', confidence: 40
        });
      }
      // ── Terminal value alternate cross-check existence (same review) ──
      if (reasonableness.terminalValueCrossCheck.applicable && reasonableness.terminalValueCrossCheck.found === false) {
        allFlagged.push({
          id: 'T0-RSN-005', label: 'Terminal value has no independent cross-check',
          severity: 'medium', status: 'fail', sheet: '', cell: 'A1',
          category: 'Reasonableness', condition: reasonableness.terminalValueCrossCheck.note, reason: reasonableness.terminalValueCrossCheck.note,
          corrective_action: 'Add a second, independent cross-check for the terminal value assumption (implied buyer return, implied yield, replacement cost, or revenue multiple) alongside the exit multiple already used.',
          workstream: 'Valuation', issue_type: 'Terminal value reasonableness',
          model_risk: 'Terminal value is often the largest single driver of total return — resting it on one unchallenged exit multiple, with no independent method corroborating it, is a real gap even where the multiple itself looks reasonable.',
          key_output_impact: 'Yes', method: 'automated', needs_retest: false, root_cause: 'No independent terminal value cross-check',
          escalation_flag: false, urgency: 'Before external circulation', confidence: 40
        });
      }
      // ── Model self-discloses a status/readiness flag (found via a real
      // forensic audit review — the model itself directly says it is not
      // reliance-ready, at one or more explicit locations. A direct
      // self-disclosure, not an inference, so confidence is set high and
      // this is treated as a genuine finding rather than a query. ──
      if (reasonableness.modelStatusFlag.applicable && reasonableness.modelStatusFlag.found === true) {
        const flags = reasonableness.modelStatusFlag.flags;
        allFlagged.push({
          id: 'T0-RSN-006', label: 'Model contains its own explicit status/readiness flag',
          severity: 'high', status: 'fail', sheet: flags[0].sheet, cell: flags[0].valueCell,
          category: 'Reasonableness', condition: reasonableness.modelStatusFlag.note, reason: reasonableness.modelStatusFlag.note,
          corrective_action: 'Resolve whatever the flagged status indicates (e.g. outstanding confirmations, unfinished sections) and update the flag to reflect the model\'s actual, current state before external circulation.',
          workstream: 'Governance', issue_type: 'Model status disclosure',
          model_risk: 'The model directly discloses it is not in a final, reliance-ready state — treating its outputs as final without resolving this is a governance gap regardless of how the underlying figures look.',
          key_output_impact: 'Unknown', method: 'automated', needs_retest: true, root_cause: 'Model self-flagged as not ready for reliance',
          escalation_flag: true, urgency: 'Before external circulation', confidence: 95
        });
      }
      // ── NPV sign inconsistency across calculation methods — found via
      // investigating why a confirmed real defect (Project NPV vs XNPV
      // disagreeing on sign) still wasn't caught even after every
      // row-extraction fix; the sheet it lives on isn't consistently
      // selected as a key sheet by Familiarisation, so this is a
      // dedicated, deterministic check independent of that selection. ──
      if (reasonableness.npvSignConsistency.applicable && reasonableness.npvSignConsistency.found === true) {
        const first = reasonableness.npvSignConsistency.flagged[0];
        allFlagged.push({
          id: 'T0-RSN-007', label: 'NPV values disagree on sign for the same underlying metric',
          severity: 'high', status: 'fail', sheet: first.items[0].location.split('!')[0], cell: first.items[0].location.split('!')[1],
          category: 'Reasonableness', condition: reasonableness.npvSignConsistency.note, reason: reasonableness.npvSignConsistency.note,
          corrective_action: 'Reconcile the two calculation methods producing opposite signs — check the cash flow range, sign convention, and discount rate feeding each, since one is very likely a genuine formula error rather than an acceptable difference in method.',
          workstream: 'Valuation', issue_type: 'NPV sign consistency',
          model_risk: 'Two calculation methods for the same underlying project or equity value disagreeing on sign (not just magnitude) is a strong indicator one of them is genuinely wrong, not a benign methodological difference.',
          key_output_impact: 'Yes', method: 'automated', needs_retest: true, root_cause: 'NPV vs XNPV (or similar paired methods) sign mismatch',
          escalation_flag: true, urgency: 'Before next reliance', confidence: 90
        });
      }
      // ── Valuation-method divergence (DCF vs. direct/income
      // capitalisation) — same investigation, same architectural cause. ──
      if (reasonableness.valuationMethodDivergence.applicable && reasonableness.valuationMethodDivergence.found === true) {
        const vmd = reasonableness.valuationMethodDivergence;
        allFlagged.push({
          id: 'T0-RSN-008', label: 'Two valuation methods for the same asset diverge materially',
          severity: 'high', status: 'fail', sheet: vmd.direct.location.split('!')[0], cell: vmd.direct.location.split('!')[1],
          category: 'Reasonableness', condition: vmd.note, reason: vmd.note,
          corrective_action: 'Reconcile the DCF-method and direct/income-capitalisation-method valuations for this asset — a divergence this large usually means one method has a stale or incorrect input, not a genuine, defensible difference in approach.',
          workstream: 'Valuation', issue_type: 'Valuation method divergence',
          model_risk: 'Two independent valuation methods disagreeing this materially on the value of the same asset undermines confidence in whichever figure the model relies on downstream.',
          key_output_impact: 'Yes', method: 'automated', needs_retest: true, root_cause: 'DCF and direct-capitalisation valuations diverge beyond a reasonable tolerance',
          escalation_flag: true, urgency: 'Before next reliance', confidence: 75
        });
      }
      // ── Negative periodic debt yield — same investigation, same
      // architectural cause. ──
      if (reasonableness.debtYieldNegative.applicable && reasonableness.debtYieldNegative.found === true) {
        const dyn = reasonableness.debtYieldNegative;
        allFlagged.push({
          id: 'T0-RSN-009', label: 'Periodic debt yield is negative in at least one period',
          severity: 'high', status: 'fail', sheet: dyn.flagged[0].sheet, cell: 'A1',
          category: 'Reasonableness', condition: dyn.note, reason: dyn.note,
          corrective_action: 'Investigate the period(s) where debt yield goes negative — confirm whether this reflects a genuine operating loss or a formula error, and check whether summary DSCR/yield statistics elsewhere in the model correctly reflect this period.',
          workstream: 'Debt', issue_type: 'Debt yield reasonableness',
          model_risk: 'A negative debt yield implies negative NOI relative to total debt in that period — a summary "average" or "minimum" statistic elsewhere in the model may not surface this specific period.',
          key_output_impact: 'Yes', method: 'automated', needs_retest: true, root_cause: 'Negative periodic debt yield value',
          escalation_flag: true, urgency: 'Before next reliance', confidence: 85
        });
      }
      if (duplicateSheets.applicable && duplicateSheets.flaggedCount > 0) {
        const names = duplicateSheets.flagged.map(f => f.sheet).join(', ');
        allFlagged.push({
          id: 'T0-DUP-001', label: `${duplicateSheets.flaggedCount} duplicate/backup sheet(s) detected`,
          severity: 'medium', status: 'fail', sheet: duplicateSheets.flagged[0].sheet, cell: 'A1',
          category: 'Model Control', condition: `${names}. ${duplicateSheets.note}`,
          reason: `Duplicate/backup sheet(s): ${names}`,
          corrective_action: 'For each: confirm which sheet is official, then archive or remove the other rather than leaving both in the live model.',
          workstream: 'Structure', issue_type: 'Duplicate sheet',
          model_risk: 'Backup sheets can contain stale outputs; investment committee materials can easily pick up the wrong dashboard or summary by mistake.',
          key_output_impact: 'Unknown', method: 'automated', needs_retest: true, root_cause: 'Duplicate sheet not archived',
          escalation_flag: false, urgency: 'Before next reliance', confidence: 90
        });
      }
      // ── Degenerate covenant branch (R-3) — a covenant/gate formula
      // defaulting to PASS on a zero denominator. One Issue Log entry
      // per flagged row, since the check already aggregates repeated
      // periods sharing the same underlying formula into one entry. ──
      if (degenerateCovenantBranch.applicable && degenerateCovenantBranch.flaggedCount > 0) {
        for (const f of degenerateCovenantBranch.findings) {
          allFlagged.push({
            id: `T0-COVENANT-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.rowNum}`,
            label: 'Covenant/gate formula defaults to PASS on a zero denominator',
            severity: 'high', status: 'fail', sheet: f.sheet, cell: f.sampleCell,
            category: 'Debt', condition: f.note,
            reason: f.note,
            corrective_action: 'Change the zero-denominator branch to block (FALSE/0) rather than pass (TRUE) — an inability to measure the covenant ratio should never default to a passing result. Confirm whether any distributions or releases were paid through this branch historically and whether they need to be reversed or disclosed.',
            workstream: 'Debt', issue_type: 'Degenerate covenant branch',
            model_risk: `A distribution, debt-sizing, or release gate that cannot fail when it cannot measure its own ratio provides no genuine protection in exactly the periods where protection matters most — confirmed here across ${f.instanceCount} period(s) on this row alone.`,
            key_output_impact: 'Yes', method: 'automated', needs_retest: true, root_cause: 'Zero-denominator branch defaults to TRUE instead of blocking',
            escalation_flag: true, urgency: 'Before next reliance', confidence: 92
          });
        }
      }
      // ── Equity component backward-solved (R-4) — a contributed-
      // equity style line computed as a residual of Total Assets/
      // Liabilities. ──
      if (equityComponentBackwardSolved.applicable && equityComponentBackwardSolved.flaggedCount > 0) {
        for (const f of equityComponentBackwardSolved.findings) {
          allFlagged.push({
            id: `T0-EQPLUG-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.rowNum}`,
            label: 'Equity component computed as a residual rather than an independent figure',
            severity: 'high', status: 'fail', sheet: f.sheet, cell: f.sampleCell,
            category: 'Accounting', condition: f.note,
            reason: f.note,
            corrective_action: 'Rebuild this line as a genuine independent roll-forward (actual capital contribution events), not a residual of Total Assets and Total Liabilities. If it must remain a plug pending correction, label it explicitly as such so reviewers are not misled into treating it as an independent fact.',
            workstream: 'Accounting', issue_type: 'Unlabelled balance-sheet plug',
            model_risk: 'A component labelled as an independent fact but actually computed as a residual will silently absorb any error elsewhere on the balance sheet, and if later periods anchor back to it, the plug propagates across the whole model horizon undetected.',
            key_output_impact: 'Yes', method: 'automated', needs_retest: true, root_cause: 'Equity component derived from Total Assets minus Total Liabilities rather than tracked independently',
            escalation_flag: true, urgency: 'Before next reliance', confidence: 85
          });
        }
      }
      // ── Mid-row formula regime change (R-5) — a clean formula-
      // shape break at a single column. Medium severity, moderate
      // confidence: confirmed directly this can also be a genuine,
      // legitimate actuals-to-forecast or phase boundary. ──
      if (midRowFormulaRegimeChange.applicable && midRowFormulaRegimeChange.flaggedCount > 0) {
        for (const f of midRowFormulaRegimeChange.findings) {
          allFlagged.push({
            id: `T0-REGIMECHANGE-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.rowNum}`,
            label: 'Formula pattern changes cleanly at a single column mid-row',
            severity: 'medium', status: 'fail', sheet: f.sheet, cell: f.splitCell,
            category: 'Structure', condition: f.note,
            reason: f.note,
            corrective_action: 'Confirm whether this transition is intentional (e.g. an actuals-to-forecast boundary or a construction-to-operations phase change) and, if so, document it explicitly. If not intentional, correct the formula so the pattern is consistent across the full period range.',
            workstream: 'Structure', issue_type: 'Mid-row formula inconsistency',
            model_risk: `A clean, single-point formula change (${f.beforeCount} period(s) one way, ${f.afterCount} another) can be a deliberate model boundary or a copy-paste/model-surgery error — worth confirming which, since it wasn't caught by majority-vote consistency checking (neither side reached a clear majority).`,
            key_output_impact: 'Unknown', method: 'automated', needs_retest: true, root_cause: 'Formula template changes mid-row at a single transition point',
            escalation_flag: false, urgency: 'Before next reliance', confidence: 55
          });
        }
      }
      // ── Zero base rates (R-15) — all debt facility base rates are
      // genuinely zero, precluding rate-sensitivity testing. ──
      if (zeroBaseRates.applicable && zeroBaseRates.found === true) {
        const first = zeroBaseRates.candidates[0];
        allFlagged.push({
          id: 'T0-ZEROBASERATE-001',
          label: 'All debt base rates are genuinely zero',
          severity: 'medium', status: 'fail', sheet: first.sheet, cell: first.valueCell,
          category: 'Debt', condition: zeroBaseRates.note,
          reason: zeroBaseRates.note,
          corrective_action: 'Populate a realistic base/reference rate (or a clearly-labelled placeholder pending confirmation) for each debt facility, so rate-shock and rate-sensitivity scenarios have something to act on.',
          workstream: 'Debt', issue_type: 'Zero base rate',
          model_risk: 'With every base rate at zero, debt pricing is effectively margin-only — a rate-shock or rising-rate stress scenario cannot be meaningfully tested as the model is currently built.',
          key_output_impact: 'Unknown', method: 'automated', needs_retest: true, root_cause: 'All labelled base/reference rate inputs are zero',
          escalation_flag: false, urgency: 'Before next reliance', confidence: 80
        });
      }
      // ── Date-gated ratio zero (R-12) — a covenant/ratio metric
      // structurally forced to zero before a milestone date. ──
      if (dateGatedRatioZero.applicable && dateGatedRatioZero.flaggedCount > 0) {
        for (const f of dateGatedRatioZero.findings) {
          allFlagged.push({
            id: `T0-DATEGATE-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.rowNum}`,
            label: `${f.label} is structurally forced to zero before a milestone date`,
            severity: 'medium', status: 'fail', sheet: f.sheet, cell: f.sampleCell,
            category: 'Debt', condition: f.note,
            reason: f.note,
            corrective_action: 'Confirm this is intentional design, then ensure anything comparing this ratio against a covenant threshold treats the gated periods as not-yet-measurable (N/A) rather than as a genuine zero value to test against the covenant.',
            workstream: 'Debt', issue_type: 'Date-gated ratio structurally zero',
            model_risk: `A "0" produced by deliberate date-gating (${f.instanceCount} period(s) on this row) is easy to mistake for a genuine covenant breach — anything downstream that compares this ratio against a threshold should be checked for whether it correctly distinguishes "not yet measurable" from "measured and failing".`,
            key_output_impact: 'Unknown', method: 'automated', needs_retest: true, root_cause: 'Ratio structurally date-gated to zero before a milestone',
            escalation_flag: false, urgency: 'Before next reliance', confidence: 88
          });
        }
      }
      // ── Exception status rows (R-22) — a check/reconciliation row
      // literally evaluates to "EXCEPTION" across multiple periods,
      // with no visible gate on the report's summary. ──
      if (exceptionStatusRows.applicable && exceptionStatusRows.flaggedCount > 0) {
        for (const f of exceptionStatusRows.findings) {
          allFlagged.push({
            id: `T0-EXCEPTIONSTATUS-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.rowNum}`,
            label: `${f.label} reports EXCEPTION across ${f.instanceCount} period(s)`,
            severity: 'medium', status: 'fail', sheet: f.sheet, cell: f.sampleCell,
            category: 'Structure', condition: f.note,
            reason: f.note,
            corrective_action: 'Resolve the underlying reconciliation failure this check row is reporting, and confirm whether the investor-facing summary or verdict should be gated on this check passing rather than proceeding regardless.',
            workstream: 'Structure', issue_type: 'Unresolved exception status',
            model_risk: 'A check row reporting EXCEPTION is a direct, explicit self-disclosure that a reconciliation is currently failing — treating the model\u2019s outputs as reliable without resolving this is a governance gap regardless of how the other figures look.',
            key_output_impact: 'Unknown', method: 'automated', needs_retest: true, root_cause: 'Check/reconciliation row reports EXCEPTION, apparently ungated',
            escalation_flag: true, urgency: 'Before next reliance', confidence: 90
          });
        }
      }
      // ── Hardcoded major asset (R-7) — a major balance-sheet asset
      // row entirely hardcoded rather than linked to its own cost/
      // basis schedule. ──
      if (hardcodedMajorAsset.applicable && hardcodedMajorAsset.flaggedCount > 0) {
        for (const f of hardcodedMajorAsset.findings) {
          allFlagged.push({
            id: `T0-HARDASSET-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.rowNum}`,
            label: `${f.label} is a major asset line entirely hardcoded`,
            severity: 'high', status: 'fail', sheet: f.sheet, cell: f.sampleCell,
            category: 'Accounting', condition: f.note,
            reason: f.note,
            corrective_action: 'Confirm whether this is a deliberate, confirmed fixed balance or should be linked to the underlying cost/basis schedule so future changes to the cost build flow through automatically.',
            workstream: 'Accounting', issue_type: 'Hardcoded major asset',
            model_risk: 'A large asset line disconnected from its own cost/basis schedule will silently diverge from it over time with no warning, directly misstating the balance sheet and any leverage/coverage ratio computed from it.',
            key_output_impact: 'Yes', method: 'automated', needs_retest: true, root_cause: 'Major asset line hardcoded rather than linked to a cost schedule',
            escalation_flag: true, urgency: 'Before next reliance', confidence: 75
          });
        }
      }
      if (masterControlFailure.applicable && masterControlFailure.flaggedCount > 0) {
        for (const f of masterControlFailure.findings) {
          allFlagged.push({
            id: `T0-MASTERCONTROL-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.cell}`,
            label: `${f.label}: FAIL`,
            severity: 'critical', status: 'fail', sheet: f.sheet, cell: f.cell,
            category: 'Governance', condition: f.note,
            reason: f.note,
            corrective_action: 'Investigate and resolve the underlying cause of this control failure before relying on any output that depends on it. Do not treat this as a lower-confidence query — this is the model\'s own explicit, self-labelled control result, not an inference.',
            workstream: 'Governance', issue_type: 'Master control failure',
            model_risk: `The model itself explicitly reports that ${f.label.toLowerCase()} has failed (${f.instanceCount} cell(s) across ${f.allSheets.join(', ')}) — this is a direct, reliance-blocking signal from the model's own logic, not an audit inference.`,
            key_output_impact: 'Yes', method: 'automated', needs_retest: true, root_cause: `Model's own ${f.label} evaluates to FAIL`,
            escalation_flag: true, urgency: 'Immediate', confidence: 98,
            investment_grade_blocker: true,
          });
        }
      }
      if (impossibleCountaTarget.applicable && impossibleCountaTarget.flaggedCount > 0) {
        for (const f of impossibleCountaTarget.findings) {
          allFlagged.push({
            id: `T0-IMPOSSIBLETARGET-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.cell}`,
            label: `Control target (${f.target}) mathematically exceeds the max achievable sum (${f.maxAchievable})`,
            severity: 'high', status: 'fail', sheet: f.sheet, cell: f.cell,
            category: 'Governance', condition: f.note,
            reason: f.note,
            corrective_action: 'Confirm the correct target value against the ranges as currently sized, or correct the ranges if they were meant to cover more cells. As written, this control can never pass regardless of the model\'s actual state.',
            workstream: 'Governance', issue_type: 'Impossible control target',
            model_risk: `A control gate that can mathematically never pass will always show as failed or excepted, regardless of whether the underlying model is actually correct — this can mask genuine issues among the noise, or cause reviewers to distrust a genuinely important control.`,
            key_output_impact: 'No', method: 'automated', needs_retest: true, root_cause: 'Control target exceeds the mathematical maximum of its own referenced ranges',
            escalation_flag: true, urgency: 'Before next reliance', confidence: 99,
          });
        }
      }
      if (mismatchedBasisComparison.applicable && mismatchedBasisComparison.flaggedCount > 0) {
        for (const f of mismatchedBasisComparison.findings) {
          allFlagged.push({
            id: `T0-BASISMISMATCH-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.cell}`,
            label: `Control compares a fixed link (${f.linkArg}) against a differently-computed actual (${f.computedArg})`,
            severity: 'medium', status: 'fail', sheet: f.sheet, cell: f.cell,
            category: 'Governance', condition: f.note,
            reason: f.note,
            corrective_action: 'Confirm both sides of this equality test genuinely represent the same underlying concept on the same basis (same denominator, same aggregation method) before treating a mismatch here as a value defect rather than a control-design issue.',
            workstream: 'Governance', issue_type: 'Mismatched-basis control comparison',
            model_risk: 'A control comparing a fixed target against a differently-computed actual is structurally unlikely to ever show a genuine pass, which can mask whether the underlying figures are actually reasonable.',
            key_output_impact: 'No', method: 'automated', needs_retest: true, root_cause: 'Control compares values computed on different bases for exact equality',
            escalation_flag: false, urgency: 'Before next reliance', confidence: 70,
          });
        }
      }
      if (releaseGateCoverage.applicable && releaseGateCoverage.flaggedCount > 0) {
        for (const f of releaseGateCoverage.findings) {
          allFlagged.push({
            id: `T0-GATECOVERAGE-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.cell}`,
            label: `Release gate tests ${f.testedRange} only — ${f.uncoveredCount} other status cell(s) on the sheet are outside its coverage`,
            severity: 'high', status: 'fail', sheet: f.sheet, cell: f.cell,
            category: 'Governance', condition: f.note,
            reason: f.note,
            corrective_action: 'Extend the gate\'s tested range (or its precedent logic) to cover every control/status cell on the sheet, or explicitly document why the excluded cells are out of scope for this particular gate.',
            workstream: 'Governance', issue_type: 'Release gate coverage gap',
            model_risk: 'A release or status gate that does not cover all mandatory controls can report a clean status while later, uncovered controls remain untested, failed, or excepted — undermining the very purpose of a single consolidated gate.',
            key_output_impact: 'No', method: 'automated', needs_retest: true, root_cause: 'Release gate\'s tested range does not cover all status-like cells on the same sheet',
            escalation_flag: true, urgency: 'Before next reliance', confidence: 90,
          });
        }
      }
      if (errorScanCoverage.applicable && errorScanCoverage.flaggedCount > 0) {
        for (const f of errorScanCoverage.findings) {
          const gapSummary = [
            f.missingSheets.length > 0 ? `${f.missingSheets.length} sheet(s) entirely missing` : null,
            f.insufficientRanges.length > 0 ? `${f.insufficientRanges.length} sheet(s) with a narrower checked range than their actual used range` : null,
          ].filter(Boolean).join(', ');
          allFlagged.push({
            id: `T0-ERRSCANCOVERAGE-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.cell}`,
            label: `Whole-workbook error-scan control has incomplete coverage — ${gapSummary}`,
            severity: 'high', status: 'fail', sheet: f.sheet, cell: f.cell,
            category: 'Governance', condition: f.note,
            reason: f.note,
            corrective_action: 'Extend the error-scan formula to cover every sheet with formula content, and expand each covered range to match (or exceed) that sheet\'s actual used range.',
            workstream: 'Governance', issue_type: 'Error-scan coverage gap',
            model_risk: 'A "no Excel errors" control that does not cover the full model can report a clean status while a genuine #REF!/#VALUE!/#DIV/0! error sits undetected in an uncovered sheet or row/column range.',
            key_output_impact: 'No', method: 'automated', needs_retest: true, root_cause: 'Error-scan control\'s covered sheets/ranges do not match the model\'s actual structure',
            escalation_flag: true, urgency: 'Before next reliance', confidence: 90,
          });
        }
      }
      if (nonexistentSheetReferences.applicable && nonexistentSheetReferences.flaggedCount > 0) {
        for (const f of nonexistentSheetReferences.findings) {
          allFlagged.push({
            id: `T0-MISSINGSHEETREF-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.cell}`,
            label: `References a sheet named "${f.referencedSheet}" that does not exist in this workbook`,
            severity: 'medium', status: 'fail', sheet: f.sheet, cell: f.cell,
            category: 'Governance', condition: f.note,
            reason: f.note,
            corrective_action: 'Confirm whether this sheet was renamed, removed, or never created, and update the documentation accordingly — or clarify if this is intentionally referencing a separate, external working file rather than a sheet within this workbook.',
            workstream: 'Governance', issue_type: 'Nonexistent sheet reference',
            model_risk: 'Documentation that references a sheet which does not exist misleads a reader trying to navigate or understand the actual workbook structure, and may indicate the model has been restructured without the guide being updated to match.',
            key_output_impact: 'No', method: 'automated', needs_retest: true, root_cause: `Guide/navigational text references a nonexistent sheet named "${f.referencedSheet}"`,
            escalation_flag: false, urgency: 'Before next reliance', confidence: 85,
          });
        }
      }
      if (formulaCountReconciliation.applicable && formulaCountReconciliation.flaggedCount > 0) {
        for (const f of formulaCountReconciliation.findings) {
          allFlagged.push({
            id: `T0-FORMULACOUNTMISMATCH-${f.sheet.replace(/[^A-Za-z0-9]/g, '')}-${f.cell}`,
            label: `Model's self-reported formula count (${f.selfReportedCount.toLocaleString()}) differs from this audit's count (${f.tier0Count.toLocaleString()}) by ${f.pctDiff}%`,
            severity: 'low', status: 'fail', sheet: f.sheet, cell: f.cell,
            category: 'Governance', condition: f.note,
            reason: f.note,
            corrective_action: 'Confirm which count is authoritative, or investigate why the two counting methods diverge by this much before relying on either figure for scope/coverage claims.',
            workstream: 'Governance', issue_type: 'Formula count discrepancy',
            model_risk: 'An unreconciled formula-count discrepancy between the model\'s own self-report and an independent audit count undermines confidence in either figure being used as a coverage or completeness metric.',
            key_output_impact: 'No', method: 'automated', needs_retest: false, root_cause: 'Model\'s self-reported formula count does not match this audit\'s own scan',
            escalation_flag: false, urgency: 'Informational', confidence: 80,
          });
        }
      }
    if (formulaDeepDive.findings && formulaDeepDive.findings.length) allFlagged.push(...formulaDeepDive.findings);
    if (vbaReview.findings && vbaReview.findings.length) allFlagged.push(...vbaReview.findings);

    // ── P1/P2/P3 framework renewal, Tier 1 item 1 ──────────────────────────
    // See the matching comment in index.js for the full rationale.
    assignRecordTypes(allFlagged);

    // ── P1/P2/P3 framework renewal, Tier 2 item 3 ──────────────────────────
    // See the matching comment in index.js for the full rationale.
    assignRiskScores(allFlagged);

    // ── P1/P2/P3 framework renewal, Tier 2 item 2 ──────────────────────────
    // See the matching comment in index.js for the full rationale,
    // including the fix for exact-filename matching not surviving
    // routine re-dating/re-labelling between revisions of the same model.
    const crossRunStats = (() => {
      try {
        const modelIdentity = normalizeModelIdentity(originalName);
        const priorHistory = loadFindingHistory(modelIdentity);
        const stats = computeCrossRunStats(allFlagged, priorHistory);
        saveFindingHistory(modelIdentity, stats.updatedHistory);
        return stats;
      } catch (e) {
        console.error('   \u26a0\ufe0f  Cross-run tracking failed (this run\'s findings are unaffected, history for next run may not update):', e.message);
        return { closed: [], new: [], regressed: [], stillOpen: [] };
      }
    })();
    if (crossRunStats.regressed.length > 0) {
      const regDet = crossRunStats.regressedDeterministicCount ?? crossRunStats.regressed.length;
      const regLlm = crossRunStats.regressedLlmCount ?? 0;
      if (regDet > 0) {
        console.log(`   \u26a0\ufe0f  ${regDet} previously-closed deterministic item(s) have reappeared (regressed) since a prior run`);
      }
      if (regLlm > 0) {
        console.log(`   \u2139\ufe0f  ${regLlm} previously-closed Tier 2 (LLM) item(s) have reappeared — Tier 2 findings can vary between runs even with an unchanged model, so this is not necessarily a genuine regression`);
      }
    }

    console.log(`   ℹ️  ${formatBreakdownLine(computeFindingBreakdown(allFlagged))}`);
    // Per-rule outcomes for the Validation Matrix tab (pass + fail + uncertain)
    const ruleResults = [...t1Results, ...t2Results].map(r => ({
      id: r.id, status: r.status || 'uncertain',
      confidence: r.confidence ?? null, needs_retest: r.needs_retest ?? false
    }));


    // ── Step 6: Build report + upload + notify ─────────────────────────
    console.log('[6/6] Building report, uploading, notifying...');
    setProgress(runId, 6, 'Building report, uploading, notifying');
    const baseName   = path.parse(originalName).name;
    const reportName = `${baseName}_VALIDATED.xlsx`;
    const reportPath = path.join(__dirname, 'processed', reportName);

    if (!fs.existsSync(path.join(__dirname, 'processed'))) {
      fs.mkdirSync(path.join(__dirname, 'processed'), { recursive: true });
    }


    // FIX: see the matching comment in index.js for the full rationale
    // — derives the real rule counts from config/checklist.json instead
    // of the hardcoded '129'/'141' literals that had silently drifted.
    const _checklistCounts = require('./config/checklist.json');
    const _tier2RuleCount = _checklistCounts.tier2.length;
    const _totalRuleCount = _checklistCounts.tier1.length + _checklistCounts.tier2.length;

    // Build audit log for report
    const auditLog = [
      { timestamp: new Date().toISOString().substr(11,8), step: 'Parse', action: `Parsed ${parsed.sheetNames.length} sheets via exceljs`, artifact: originalName, result: '✓ Pass', duration: '', notes: `${parsed.sheetNames.length} sheets found` },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 0', action: `Formula text scan — ${tier0.stats.totalFormulaCells.toLocaleString()} formula cells`, artifact: 'All sheets scanned', result: '✓ Pass', duration: tier0.elapsed || '', notes: `${tier0.stats.uniqueFormulaCount} unique formulas · ${tier0.stats.totalIferrorCount.toLocaleString()} IFERROR · ${tier0.stats.totalExternalLinks} external links` },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Familiarise', action: 'Claude read all sheets', artifact: '~' + Math.round(JSON.stringify(modelSummary).length/3) + ' tokens', result: '✓ Pass', duration: '', notes: `${modelType} · ${modelSummary.currency || ''} · ${modelSummary.periodicity || ''}` },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Classify', action: 'Model type derived', artifact: domain.file + ' loaded', result: '✓ Pass', duration: '', notes: `Model type: ${modelType}` },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 1', action: `${t1Results.length} code checks`, artifact: `${t1Results.filter(r=>r.status==='pass').length} pass · ${t1Failures.length} fail`, result: t1Failures.length > 0 ? '⚠ Issues' : '✓ Pass', duration: '', notes: t1Failures.map(f=>f.id).join(', ') || 'All passed' },
      { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 2', action: `Claude — 3 batches · ${_tier2RuleCount} rules`, artifact: 'Batches 1-3', result: t2Failures.length > 0 ? '⚠ Issues' : '✓ Pass', duration: '', notes: `${t2Results.filter(r=>r.status==='pass').length} pass · ${t2Failures.length} issues` },
      { timestamp: new Date().toISOString().substr(11,8), step: 'VBA Review', action: 'Macro extraction + risk scan', artifact: vbaReview.hasVbaProject ? `${vbaReview.moduleCount} module(s)` : 'No VBA project', result: !vbaReview.applicable ? '⚠ Skipped' : (vbaReview.findings && vbaReview.findings.length ? '⚠ Issues' : '✓ Pass'), duration: '', notes: vbaReview.note || '' }
    ];

    // Extract overall assessment from Tier 2 meta
    const t2Meta = t2Results[0] && t2Results[0]._meta ? t2Results[0]._meta : {};
    // FIX: found via an independent audit of a real production run - the
    // LLM's own self-reported audit_completion_percent said 96%, while
    // this same run's real Validation Matrix data (ruleResults, built
    // just above) showed only 17 of 835 rules with a definitive
    // pass/fail outcome - the rest genuinely 'uncertain'. That's 2%, not
    // 96%. The two were never cross-checked against each other before;
    // the unverified LLM figure was always shown regardless.
    // Computing directly from ruleResults - the same real, objective
    // data the Validation Matrix tab itself displays - so this number
    // can never contradict what a reader sees when they open that tab.
    const definitiveCount = ruleResults.filter(r => r.status === 'pass' || r.status === 'fail').length;
    const auditCompletion = ruleResults.length > 0
      ? Math.round((definitiveCount / ruleResults.length) * 100)
      : (t2Meta.audit_completion_percent || Math.round(((_totalRuleCount - checklistFindingCount) / _totalRuleCount) * 100));
    const auditCommentary = t2Meta.audit_completion_commentary || `The audit file has completed ${auditCompletion}% of the planned review procedures. Open items are listed by priority below.`;
    const overallAssessment = 'audit_complete';
    const igReadiness = auditCompletion;
    const igCommentary = auditCommentary;

    const deepAccountingResolvedSheets = resolveDeepAccountingSheets(parsed.sheetNames);

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
      ruleResults,
      errorScan,
      redundantInputs,
      crossRunStats,
      orphanSheets,
      namedRangeAudit,
      formulaDeepDive,
      reasonableness,
      duplicateSheets,
      vbaReview,
      deepAccountingResolvedSheets,
      recalcCheckResult,
      ownerDecisionChecklist
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
    if (slot) slot.release();

    const duration     = ((Date.now() - startTime) / 1000).toFixed(1);
    const c = require('./config/checklist.json');
    const totalChecked = c.tier1.length + c.tier2.length;
    const score        = totalChecked === 0
      ? 100
      : Math.round(((totalChecked - checklistFindingCount) / totalChecked) * 100);
    // KPMG risk rating
    // FIX: found via a real review of the upload-screen UI — f.priority
    // was checked here, but that field is never set anywhere in the JS
    // pipeline (priority is only computed by build_report.py's own
    // priority() function, Python-side, from record_type + severity).
    // The check silently fell through to raw severity every time,
    // completely bypassing the record_type framework: a Query,
    // Observation, or Critical Query with severity 'critical' was still
    // counted toward p1Count here, even though the real report
    // correctly excludes anything that isn't a Confirmed Finding from
    // the P1-P3 hierarchy. Critical Query also had no representation at
    // all in riskRating, despite blocking reliance with the same force
    // as an open P1 — a model whose only problem was 16 unresolved
    // Critical Queries would have shown a falsely clean-looking summary
    // here. This mirrors build_report.py's actual priority() logic
    // instead of duplicating the old, disconnected one.
    const isConfirmed = f => (f.record_type || 'Confirmed Finding') === 'Confirmed Finding';
    const p1Count = allFlagged.filter(f => isConfirmed(f) && (f.severity === 'fatal' || f.severity === 'critical')).length;
    const p2Count = allFlagged.filter(f => isConfirmed(f) && (f.severity === 'high' || f.severity === 'medium')).length;
    const p3Count = allFlagged.filter(f => isConfirmed(f) && !['fatal','critical','high','medium'].includes(f.severity)).length;
    const criticalQueryCount = allFlagged.filter(f => f.record_type === 'Critical Query').length;
    const riskRating = `P1: ${p1Count} · P2: ${p2Count} · P3: ${p3Count}` +
      (criticalQueryCount > 0 ? ` · Critical Query: ${criticalQueryCount}` : '');

    console.log(`\n✅ Complete in ${duration}s — flagged: ${allFlagged.length}`);

    clearProgress(runId);
    if (shouldCleanup) fs.unlink(filePath, () => {});
    if (req.body.orderId) {
      updateOrder(req.body.orderId, { runLogFilename: runLog.filename, reportName });
    }

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
        p3Count,
        criticalQueryCount,
        domainSkill: domain.file,
        tier0Stats: tier0.stats,
        duration
      },
      driveLink:  driveResult ? driveResult.webViewLink : null,
      runLogFilename: runLog.filename,
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
    if (slot) slot.release();
    clearProgress(runId);
    if (req.body.orderId) updateOrder(req.body.orderId, { runLogFilename: runLog.filename });
    if (shouldCleanup) fs.unlink(filePath, () => {});
    res.status(500).json({ status: 'error', message: error.message || 'Validation failed', runLogFilename: runLog.filename });
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
