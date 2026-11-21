'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson, withLock, withLockSync } = require('./file-state');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function failure(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function matchesToken(token, expected) {
  if (typeof token !== 'string' || !expected || token.length > 256) return false;
  const a = Buffer.from(digest(token)); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function sourceHash(file) { return digest(fs.readFileSync(file)); }
function createCheckoutStore({ dir = process.env.PAYMENT_DATA_DIR || path.join(__dirname, '..', '..', 'payment-state'), uploadsDir = path.join(__dirname, '..', '..', 'uploads') } = {}) {
  for (const name of ['uploads', 'intents', 'promos', 'locks']) fs.mkdirSync(path.join(dir, name), { recursive: true, mode: 0o700 });
  function sourcePath(storedAs) {
    if (typeof storedAs !== 'string' || !storedAs || path.basename(storedAs) !== storedAs || storedAs.includes('\\')) throw failure('INVALID_UPLOAD', 'Invalid file reference.');
    return path.join(uploadsDir, storedAs);
  }
  const uploadFile = storedAs => path.join(dir, 'uploads', `${digest(storedAs)}.json`);
  function registerUpload(storedAs, originalName) {
    const file = sourcePath(storedAs); const token = crypto.randomBytes(32).toString('hex');
    const entry = { storedAs, originalName, sourceSha256: sourceHash(file), fileSizeBytes: fs.statSync(file).size, tokenHash: digest(token), checkoutId: `ci_${crypto.randomBytes(32).toString('hex')}`, createdAt: Date.now(), expiresAt: Date.now() + 48 * 3600000 };
    writeJson(uploadFile(storedAs), entry); return token;
  }
  function assertSource(record) {
    try { if (sourceHash(sourcePath(record.storedAs)) !== record.sourceSha256) throw Error('changed'); }
    catch (_) { throw failure('SOURCE_UNAVAILABLE', 'The verified source file is missing or changed. Contact support@plsfx.ai.', 409); }
  }
  function verifyUpload(storedAs, token) {
    sourcePath(storedAs);
    const u = readJson(uploadFile(storedAs));
    if (!u || !matchesToken(token, u.tokenHash)) throw failure('UPLOAD_ACCESS_DENIED', 'Please upload and verify your file again.', 403);
    // An existing checkout can be resumed after the ordinary upload TTL.
    if (u.expiresAt < Date.now() && !getIntent(u.checkoutId)) throw failure('UPLOAD_EXPIRED', 'Please upload your file again.', 410);
    assertSource(u); return u;
  }
  function intentFile(id) {
    if (!/^ci_[a-f0-9]{64}$/.test(String(id))) throw failure('INVALID_CHECKOUT', 'Invalid checkout reference.', 404);
    return path.join(dir, 'intents', `${id}.json`);
  }
  const getIntent = id => readJson(intentFile(id));
  const saveIntent = record => writeJson(intentFile(record.id), record);
  const lockIntent = (id, fn) => { intentFile(id); return withLock(path.join(dir, 'locks', id), fn); };
  const listIntents = () => fs.readdirSync(path.join(dir, 'intents')).filter(n => /^ci_[a-f0-9]{64}\.json$/.test(n)).map(n => readJson(path.join(dir, 'intents', n)));
  const promoKey = (code, email) => digest(`${String(code).trim().toUpperCase()}\n${String(email).trim().toLowerCase()}`);
  function reservePromo(intent) {
    if (!intent.promoSingleUse) return;
    const file = path.join(dir, 'promos', `${promoKey(intent.promoCode, intent.email)}.json`);
    withLockSync(path.join(dir, 'locks', 'promos'), () => {
      const prior = readJson(file);
      if (prior && prior.checkoutId !== intent.id) throw failure('PROMO_RESERVED', 'This promotion is already reserved for an unpaid checkout. Resume that checkout or wait for it to expire.', 409);
      writeJson(file, { checkoutId: intent.id, createdAt: intent.createdAt });
    });
  }
  function releasePromo(intent) {
    if (!intent.promoSingleUse || !intent.email) return;
    const file = path.join(dir, 'promos', `${promoKey(intent.promoCode, intent.email)}.json`);
    withLockSync(path.join(dir, 'locks', 'promos'), () => { if (readJson(file)?.checkoutId === intent.id) fs.unlinkSync(file); });
  }
  return { dir, uploadsDir, sourcePath, registerUpload, assertSource, verifyUpload, getIntent, saveIntent, lockIntent, listIntents, reservePromo, releasePromo };
}
module.exports = { createCheckoutStore, digest, matchesToken, sourceHash, failure };
