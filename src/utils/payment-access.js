'use strict';
const crypto = require('crypto');
const path = require('path');
const { sourceHash, failure } = require('./checkout-store');
function equal(a, b) {
  if (!a || !b || typeof a !== 'string' || typeof b !== 'string') return false;
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
}
function requireInternalApiKey(req, res, next) {
  if (!process.env.VALIDATOR_API_KEY) return res.status(503).json({ success: false, code: 'INTERNAL_AUTH_UNCONFIGURED', message: 'Internal access is not configured.' });
  if (!equal(req.headers['x-api-key'], process.env.VALIDATOR_API_KEY)) return res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'A server API key is required.' });
  next();
}
function requireAdminAuth(req, res, next) {
  if (equal(req.headers['x-api-key'], process.env.VALIDATOR_API_KEY)) return next();
  const header = req.headers.authorization || '';
  const credentials = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '';
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD && equal(credentials, `${process.env.ADMIN_USERNAME}:${process.env.ADMIN_PASSWORD}`)) return next();
  res.set('WWW-Authenticate', 'Basic realm="PLSFX Admin"');
  return res.status(401).json({ error: 'Administrator authentication required.' });
}
function assertPaidSource(order, storedAs, uploadsDir, { allowReviewHold = false } = {}) {
  if (!order || order.payment?.provider !== 'stripe' || order.payment.status !== 'paid' || !/^pi_/.test(order.payment.paymentIntentId || '') || !order.payment.verifiedAt || !order.checkoutId || order.payment.accountId !== process.env.STRIPE_ACCOUNT_ID || order.payment.live !== (process.env.STRIPE_LIVE_MODE === 'true')) throw failure('PAYMENT_REQUIRED', 'A verified paid order is required.', 402);
  if (order.paymentReviewRequired && !allowReviewHold) throw failure('PAYMENT_REVIEW_REQUIRED', 'This paid order is held for administrator review.', 409);
  if (typeof storedAs !== 'string' || path.basename(storedAs) !== storedAs || storedAs.includes('\\') || order.storedAs !== storedAs) throw failure('SOURCE_MISMATCH', 'The source does not match the paid order.', 409);
  try { if (sourceHash(path.join(uploadsDir, storedAs)) !== order.sourceSha256) throw Error('changed'); }
  catch (_) { throw failure('SOURCE_UNAVAILABLE', 'The paid source is missing or changed.', 409); }
  return order;
}
module.exports = { requireInternalApiKey, requireAdminAuth, assertPaidSource };
