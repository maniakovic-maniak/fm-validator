const fs = require('fs');
const path = require('path');

const CODES_DIR = path.join(__dirname, '..', '..', 'promo-codes');
const USAGE_DIR = path.join(__dirname, '..', '..', 'promo-usage');

let dirsReady = false;
try {
  if (!fs.existsSync(CODES_DIR)) fs.mkdirSync(CODES_DIR, { recursive: true });
  if (!fs.existsSync(USAGE_DIR)) fs.mkdirSync(USAGE_DIR, { recursive: true });
  dirsReady = true;
} catch (err) {
  dirsReady = false;
}

// Codes are matched case-insensitively but stored/displayed in the
// casing they were created with - the normalized form is only used as
// the lookup key (filename), never shown to anyone.
function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function codeFilePath(code) {
  return path.join(CODES_DIR, `${normalizeCode(code)}.json`);
}

/**
 * Creates a new promo code. Uses the same 'wx' atomic-create guard as
 * order-store.js's ID allocation - if a code with this text already
 * exists, this fails cleanly rather than silently overwriting it.
 */
function createPromoCode({ code, expiryDate, discountType, discountValue, singleUse }) {
  if (!dirsReady) throw new Error('Promo code storage directory unavailable');
  if (!code || !String(code).trim()) throw new Error('A code is required');
  if (discountType !== 'percent' && discountType !== 'fixed') {
    throw new Error('discountType must be "percent" or "fixed"');
  }
  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    throw new Error('discountValue must be a positive number');
  }

  const normalized = normalizeCode(code);
  const filePath = codeFilePath(normalized);
  const record = {
    code: String(code).trim(),
    normalizedCode: normalized,
    expiryDate: expiryDate || null,
    discountType,
    discountValue,
    singleUse: !!singleUse,
    createdAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`A promo code "${record.code}" already exists.`);
    throw err;
  }
  return record;
}

function getPromoCode(code) {
  if (!dirsReady) return null;
  try {
    return JSON.parse(fs.readFileSync(codeFilePath(code), 'utf8'));
  } catch (err) {
    return null;
  }
}

function listPromoCodes() {
  if (!dirsReady) return [];
  return fs.readdirSync(CODES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(CODES_DIR, f), 'utf8'));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .map(record => ({ ...record, usageCount: countUsage(record.normalizedCode) }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function usageFilePath(code, email) {
  const key = `${normalizeCode(code)}__${normalizeEmail(email)}`;
  // Usage keys can contain characters not safe in filenames (e.g. the
  // email's @ and .) - base64url-encode the whole key rather than try
  // to sanitize it piecemeal, so this never collides or breaks on an
  // unusual but valid email address.
  const safeKey = Buffer.from(key, 'utf8').toString('base64url');
  return path.join(USAGE_DIR, `${safeKey}.json`);
}

function hasUserUsedCode(code, email) {
  return fs.existsSync(usageFilePath(code, email));
}

function countUsage(normalizedCodeValue) {
  if (!dirsReady) return 0;
  // This directory is expected to stay small (usage events, not
  // per-request traffic), so reading each file's real content to match
  // on normalizedCode is fine - filename matching isn't viable here
  // since base64url encoding doesn't preserve a stable prefix once the
  // variable email part changes the encoding's padding/boundary.
  return fs.readdirSync(USAGE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(USAGE_DIR, f), 'utf8'));
      } catch (_) {
        return null;
      }
    })
    .filter(r => r && r.normalizedCode === normalizedCodeValue)
    .length;
}

/**
 * Atomically claims one use of a code for one email. Returns true if
 * this call genuinely claimed it (first time for this email/code
 * pair); returns false if it was already claimed. The 'wx' flag makes
 * this safe even with multiple PM2 worker processes racing to claim
 * the same (code, email) pair at the same instant - only one can ever
 * win, regardless of process or timing.
 */
function claimUsage(code, email, orderId) {
  if (!dirsReady) throw new Error('Promo usage storage directory unavailable');
  const filePath = usageFilePath(code, email);
  const record = {
    code: normalizeCode(code),
    normalizedCode: normalizeCode(code),
    email: normalizeEmail(email),
    orderId,
    usedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

/**
 * Real validation logic, shared by the "Apply" button's pre-check and
 * submit-order's mandatory server-side re-check - the two must never
 * be able to drift, since the pre-check exists only to give the user
 * a fast answer, not to be trusted for the actual charge.
 */
function validatePromoCode(code, email) {
  const record = getPromoCode(code);
  if (!record) return { valid: false, reason: 'That code was not found.' };
  if (record.expiryDate && new Date(record.expiryDate).getTime() < Date.now()) {
    return { valid: false, reason: 'That code has expired.' };
  }
  if (record.singleUse && hasUserUsedCode(record.normalizedCode, email)) {
    return { valid: false, reason: 'That code has already been used on this email address.' };
  }
  return { valid: true, discountType: record.discountType, discountValue: record.discountValue, code: record.code };
}

module.exports = {
  createPromoCode,
  getPromoCode,
  listPromoCodes,
  validatePromoCode,
  claimUsage,
  hasUserUsedCode,
  normalizeCode,
  normalizeEmail,
};
