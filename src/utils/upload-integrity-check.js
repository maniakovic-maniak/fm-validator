const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const { buildError } = require('./upload-error-messages');

const FALLBACK_SCRIPT = path.join(__dirname, '..', 'quick-parse-check.py');
const FALLBACK_TIMEOUT_MS = 20000; // generous relative to real observed speed, still far under "seconds not minutes"

// ── Known model-structure sheet names, matching pre-validator.js's own
// list — reused deliberately for consistency, not a separate list that
// could drift out of sync with what the full pipeline already treats
// as recognizable structure.
const KNOWN_SHEET_KEYWORDS = ['dashboard','inputs','cons','ops','ifs','afs','debt','equity','p&l',
  'income statement','balance sheet','cash flow','assumptions','revenue','costs','summary','model',
  'forecast','budget','capex','working capital','tax','sensitivity','scenarios','checks','audit',
  'cover','waterfall'];

const MIN_RELATED_SHEETS = 2;
// Matches the existing limit already enforced client-side (public/fm-validator.html)
// and server-side for /api/validate (server.js multer config) — kept in sync
// deliberately, not a separately-chosen number.
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// File signatures, read from the first 8 bytes only — fast enough to
// check without any parsing library at all.
const ZIP_SIGNATURES = [
  Buffer.from([0x50, 0x4B, 0x03, 0x04]), // normal zip
  Buffer.from([0x50, 0x4B, 0x05, 0x06]), // empty zip
  Buffer.from([0x50, 0x4B, 0x07, 0x08]), // spanned zip
];
const OLE2_SIGNATURE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

/**
 * Fast, on-upload integrity check for the new public submission form.
 * Deliberately separate from src/pre-validator.js, which runs later as
 * part of the real pipeline and assumes the file already parsed
 * successfully — this runs BEFORE that, checking things a full parse
 * wouldn't even attempt to distinguish (file-signature mismatch,
 * password-protection) and doing so in milliseconds to seconds, not
 * the minutes a real Tier 0/1/2 run takes. No Anthropic API calls
 * happen anywhere in this function.
 *
 * Every failure message comes from upload-error-messages.js — clean,
 * user-facing text with a stable `code` for the frontend and a
 * separate `logDetail` for server-side logs, so raw system/library
 * error text never reaches the person filling in the form.
 *
 * @param {string} filePath - path to the uploaded file on disk
 * @param {string} originalName - the original filename, for extension checking
 * @returns {Promise<{passed: boolean, checks: Array, reason: string|null, code: string|null}>}
 */
async function verifyUploadIntegrity(filePath, originalName) {
  const checks = [];
  const ext = (originalName.match(/\.[^.]+$/) || [''])[0].toLowerCase();

  // ── Check 1: file is genuinely non-empty ──────────────────────────────
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch (err) {
    return fail(checks, 'File readable', buildError('READ_FAILED', err.message));
  }
  if (stats.size === 0) {
    return fail(checks, 'Not empty', buildError('EMPTY_FILE'));
  }
  if (stats.size > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    const limitMB = MAX_FILE_SIZE_BYTES / 1024 / 1024;
    return fail(checks, 'Within size limit', buildError('FILE_TOO_LARGE', sizeMB, limitMB));
  }
  checks.push({ check: 'Not empty', status: 'pass', detail: `${(stats.size / 1024).toFixed(0)} KB` });

  // ── Check 2: real file signature, and password-protection detection ──
  // Read only the first 8 bytes — this never needs to touch the rest
  // of the file, regardless of its size.
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(8);
  fs.readSync(fd, header, 0, 8, 0);
  fs.closeSync(fd);

  const isZip = ZIP_SIGNATURES.some(sig => header.subarray(0, sig.length).equals(sig));
  const isOle2 = header.equals(OLE2_SIGNATURE);

  if (['.xlsx', '.xlsm', '.xlsb'].includes(ext)) {
    if (isOle2) {
      // A modern Excel format wrapped in the legacy OLE2/CFB container
      // is the exact, distinctive signature Excel produces when a
      // workbook is password-encrypted — the whole file gets wrapped
      // rather than just individual parts, since XML content inside a
      // zip can't be selectively encrypted the way OLE2 storage can.
      return fail(checks, 'Not password-protected', buildError('PASSWORD_PROTECTED'));
    }
    if (!isZip) {
      return fail(checks, 'Correct file format', buildError('WRONG_FORMAT_MODERN', ext));
    }
    checks.push({ check: 'Correct file format', status: 'pass', detail: `Valid ${ext} signature` });
    checks.push({ check: 'Not password-protected', status: 'pass', detail: null });
  } else if (ext === '.xls') {
    if (!isOle2) {
      return fail(checks, 'Correct file format', buildError('WRONG_FORMAT_LEGACY'));
    }
    checks.push({ check: 'Correct file format', status: 'pass', detail: 'Valid legacy .xls signature' });
    // Note: this signature check alone can't distinguish a genuine
    // legacy .xls from a password-protected one, since both use OLE2 —
    // the parse attempt below (Check 3) is what actually catches this
    // case for .xls specifically.
  } else {
    return fail(checks, 'Supported file type', buildError('UNSUPPORTED_EXTENSION', ext));
  }

  // ── Check 3: the file actually opens, and has a minimum related-sheet
  //    count — using ExcelJS's fast path (workbook structure only, not
  //    reading every cell), so this stays seconds-scale even on a large
  //    file, unlike the full pipeline's deep formula-text scan.
  //
  // FIX: found via real testing that ExcelJS can fail on a file that's
  // genuinely valid — confirmed directly on a real report output that
  // openpyxl (and Excel itself) open without any issue. Cross-library
  // Excel-parsing compatibility gaps are a known, real category of risk,
  // not hypothetical — treating an ExcelJS failure as certain corruption
  // would have wrongly rejected a perfectly good file. On failure, this
  // now tries openpyxl as a second opinion before concluding anything.
  let workbook;
  let sheetNames;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    sheetNames = workbook.worksheets.map(ws => ws.name);
  } catch (excelJsErr) {
    const fallback = await tryOpenpyxlFallback(filePath);
    if (fallback.ok) {
      // ExcelJS specifically failed, but a genuine second library opened
      // it fine — this file is not corrupted, ExcelJS just hit a
      // compatibility gap. Proceed using the fallback's sheet names,
      // and note this in the check detail rather than silently hiding
      // that a fallback was needed.
      sheetNames = fallback.sheetNames;
      checks.push({ check: 'File opens correctly', status: 'pass', detail: `${sheetNames.length} sheet(s) found (via fallback parser, after the primary parser reported an issue)` });
    } else {
      // Both a genuine, independent library failed — meaningfully more
      // confident this is real corruption or protection than either
      // check alone would justify.
      const combinedMsg = `${excelJsErr.message} / ${fallback.error}`;
      const errObj = /password|encrypt/i.test(combinedMsg)
        ? buildError('PASSWORD_PROTECTED')
        : buildError('CORRUPTED', fallback.error);
      return fail(checks, 'File opens correctly', errObj);
    }
  }

  if (sheetNames.length === 0) {
    return fail(checks, 'Has sheets', buildError('NO_SHEETS'));
  }
  if (!checks.some(c => c.check === 'File opens correctly')) {
    checks.push({ check: 'File opens correctly', status: 'pass', detail: `${sheetNames.length} sheet(s) found` });
  }

  const matched = sheetNames.filter(n =>
    KNOWN_SHEET_KEYWORDS.some(k => n.trim().toLowerCase().includes(k)));
  if (matched.length < MIN_RELATED_SHEETS) {
    return fail(checks, 'Recognizable model structure', buildError('NOT_A_MODEL', matched.length, sheetNames.length));
  }
  checks.push({ check: 'Recognizable model structure', status: 'pass', detail: `${matched.length} recognizable sheet name(s)` });

  return { passed: true, checks, reason: null, code: null };
}

/**
 * Fallback second opinion, used ONLY when ExcelJS fails to open a file.
 * Spawns src/quick-parse-check.py, a lightweight openpyxl-based check —
 * a genuinely independent library, not just retrying the same one.
 */
function tryOpenpyxlFallback(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('python3', [FALLBACK_SCRIPT, filePath]);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      resolve({ ok: false, error: `Fallback parser timed out after ${FALLBACK_TIMEOUT_MS / 1000}s` });
    }, FALLBACK_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `Could not start fallback parser: ${err.message}` });
    });

    proc.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.ok) {
          resolve({ ok: true, sheetNames: parsed.sheetNames });
        } else {
          resolve({ ok: false, error: stderr.trim() || 'Fallback parser reported failure' });
        }
      } catch (_) {
        resolve({ ok: false, error: stderr.trim() || 'Fallback parser produced no usable output' });
      }
    });
  });
}

function fail(checks, failedCheckName, errorObj) {
  checks.push({ check: failedCheckName, status: 'fail', detail: errorObj.message, logDetail: errorObj.logDetail });
  return { passed: false, checks, reason: errorObj.message, code: errorObj.code };
}

module.exports = { verifyUploadIntegrity };
