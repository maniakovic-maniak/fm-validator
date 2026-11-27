'use strict';
const crypto = require('crypto');
const Stripe = require('stripe');
const { createCheckoutStore, digest, matchesToken, failure } = require('./checkout-store');
const defaultOrders = require('./order-store');
const defaultPromos = require('./promo-code-store');
const { KEY_VERSION } = require('./pricing-formula-count');
const HOUR = 3600000;
function stripeConfig(env = process.env) {
  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_ACCOUNT_ID', 'STRIPE_PRODUCT_ID', 'PUBLIC_CHECKOUT_BASE_URL']) {
    if (!env[key]) throw failure('PAYMENT_NOT_CONFIGURED', 'Secure checkout is not configured. Contact support@plsfx.ai.', 503);
  }
  const live = env.STRIPE_LIVE_MODE === 'true';
  if (!/^[sr]k_(test|live)_/.test(env.STRIPE_SECRET_KEY) || env.STRIPE_SECRET_KEY.includes('_live_') !== live || !/^whsec_/.test(env.STRIPE_WEBHOOK_SECRET) || !/^acct_/.test(env.STRIPE_ACCOUNT_ID) || !/^prod_/.test(env.STRIPE_PRODUCT_ID)) {
    throw failure('PAYMENT_CONFIG_INVALID', 'Payment environment configuration is inconsistent.', 503);
  }
  let url;
  try { url = new URL(env.PUBLIC_CHECKOUT_BASE_URL); } catch (_) { throw failure('PAYMENT_CONFIG_INVALID', 'Invalid checkout base URL.', 503); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && !live && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw failure('PAYMENT_CONFIG_INVALID', 'Checkout requires a trusted HTTPS base URL.', 503);
  if (env.STRIPE_PAYMENT_METHOD_CONFIGURATION && !/^pmc_[a-zA-Z0-9]+$/.test(env.STRIPE_PAYMENT_METHOD_CONFIGURATION)) throw failure('PAYMENT_CONFIG_INVALID', 'Invalid payment method configuration.', 503);
  return { secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, accountId: env.STRIPE_ACCOUNT_ID, productId: env.STRIPE_PRODUCT_ID, baseUrl: url.href.replace(/\/$/, ''), live, paymentMethodConfiguration: env.STRIPE_PAYMENT_METHOD_CONFIGURATION || null };
}
function audToCents(value) {
  const cents = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 10 || !Number.isSafeInteger(cents) || cents > 99999999 || Math.abs(value * 100 - cents) > 0.000001) throw failure('INVALID_AMOUNT', 'The quote is outside supported AUD payment limits. Contact support@plsfx.ai.');
  return cents;
}
function safeCheckoutUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && !u.port && !u.username && !u.password ? u.href : null; } catch (_) { return null; }
}
function createStripeService({ config = stripeConfig(), stripe = new Stripe(config.secretKey, { apiVersion: '2026-11-18.endive', maxNetworkRetries: 2, timeout: 20000 }), store = createCheckoutStore(), orders = defaultOrders, promos = defaultPromos, quote, notifications = {}, now = () => Date.now() } = {}) {
  const save = intent => { intent.updatedAt = now(); store.saveIntent(intent); };
  const returnUrl = i => `${config.baseUrl}/checkout/stripe-return?checkoutId=${i.id}&token=${i.returnToken}`;
  const response = i => ({ success: true, checkoutId: i.id, checkoutUrl: ['paid', 'review_required'].includes(i.status) ? returnUrl(i) : safeCheckoutUrl(i.checkoutUrl) });
  async function verifyAccount(newCharge = false) {
    const account = await stripe.accounts.retrieve();
    if (account.id !== config.accountId) throw failure('MERCHANT_MISMATCH', 'Payment merchant configuration does not match.', 503);
    if (newCharge) {
      const product = await stripe.products.retrieve(config.productId);
      if (!account.charges_enabled || !product.active || product.livemode !== config.live) throw failure('PAYMENTS_UNAVAILABLE', 'Payments are not yet enabled for this environment.', 503);
    }
  }
  function validateInput(input) {
    const allowed = ['storedAs', 'uploadToken', 'fullName', 'company', 'email', 'quotedGrandTotal', 'promoCode'];
    if (!input || Object.keys(input).some(k => !allowed.includes(k))) throw failure('INVALID_INPUT', 'Unexpected checkout fields. Use secure hosted Checkout.');
    for (const k of ['fullName', 'company', 'email']) if (typeof input[k] !== 'string' || !input[k].trim() || input[k].length > (k === 'email' ? 254 : 200)) throw failure('INVALID_INPUT', 'Name, company and valid email are required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || !Number.isFinite(input.quotedGrandTotal)) throw failure('INVALID_INPUT', 'A valid email and quoted total are required.');
    if (input.promoCode && (typeof input.promoCode !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.promoCode.trim()))) throw failure('INVALID_PROMO', 'Invalid promotion code.');
    return { fullName: input.fullName.trim(), company: input.company.trim(), email: input.email.trim().toLowerCase(), promoCode: String(input.promoCode || '').trim().toUpperCase(), quotedGrandTotal: input.quotedGrandTotal };
  }
  async function createCheckout(input) {
    const customer = validateInput(input);
    const upload = store.verifyUpload(input.storedAs, input.uploadToken);
    return store.lockIntent(upload.checkoutId, async () => {
      let intent = store.getIntent(upload.checkoutId);
      const binding = digest(JSON.stringify({ ...customer, sourceSha256: upload.sourceSha256 }));
      if (intent) {
        if (intent.binding !== binding) throw failure('CHECKOUT_CONFLICT', 'This upload already has a checkout with different details. Resume it or upload a new file.', 409);
        if (['paid', 'review_required'].includes(intent.status)) return response(intent);
        if (intent.status === 'expired' || intent.status === 'failed') throw failure('CHECKOUT_EXPIRED', 'This checkout has ended. Please upload your file again.', 410);
        if (intent.sessionId) {
          await verifyAccount(); await applySession(intent, await retrieve(intent.sessionId));
          if (intent.status === 'expired' || intent.status === 'failed') throw failure('CHECKOUT_EXPIRED', 'This checkout has ended. Please upload your file again.', 410);
          if (intent.status === 'processing') throw failure('PAYMENT_PROCESSING', 'Your payment is processing. Check the payment status page or contact support@plsfx.ai.', 409);
          return response(intent);
        }
        if (now() > intent.createdAt + 25 * 60000) throw failure('RECONCILIATION_REQUIRED', 'An earlier checkout attempt needs confirmation. Contact support@plsfx.ai.', 409);
      } else {
        store.assertSource(upload);
        const promotion = customer.promoCode ? promos.validatePromoCode(customer.promoCode, customer.email) : null;
        if (promotion && !promotion.valid) throw failure('PROMO_CODE_INVALID', promotion.reason);
        const priced = await quote(store.sourcePath(upload.storedAs), promotion ? { type: promotion.discountType, value: promotion.discountValue } : null);
        store.assertSource(upload);
        if (priced.grandTotal !== customer.quotedGrandTotal) throw failure('PRICE_MISMATCH', 'The quote has changed. Refresh the quote before paying.', 409);
        intent = { id: upload.checkoutId, status: 'creating', createdAt: now(), ...customer, ...priced, amountCents: audToCents(priced.grandTotal), currency: 'aud', pricingVersion: KEY_VERSION,
          storedAs: upload.storedAs, originalName: upload.originalName, sourceSha256: upload.sourceSha256, fileSizeBytes: upload.fileSizeBytes, binding,
          returnToken: crypto.randomBytes(32).toString('hex'), accountId: config.accountId, productId: config.productId, live: config.live,
          promoSingleUse: !!promotion?.singleUse, expiresAt: Math.floor(now() / 1000) + 3600,
          integrationIdentifier: 'plsfx_checkout_' + Array.from(crypto.randomBytes(8), x => String.fromCharCode(97 + x % 26)).join(''), notices: {} };
        save(intent);
      }
      await verifyAccount(true);
      if (intent.accountId !== config.accountId || intent.productId !== config.productId || intent.live !== config.live) throw failure('MERCHANT_MISMATCH', 'Checkout environment changed. Contact support@plsfx.ai.', 409);
      store.reservePromo(intent); store.assertSource(intent);
      intent.createAttemptedAt ||= now(); save(intent);
      const metadata = { checkout_id: intent.id, source_sha256: intent.sourceSha256, pricing_version: intent.pricingVersion };
      const params = { mode: 'payment', ui_mode: 'hosted_page', customer_email: intent.email, client_reference_id: intent.id,
        success_url: returnUrl(intent), cancel_url: returnUrl(intent), expires_at: intent.expiresAt,
        integration_identifier: intent.integrationIdentifier, automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false },
        line_items: [{ quantity: 1, price_data: { currency: 'aud', product: intent.productId, unit_amount: intent.amountCents, tax_behavior: 'inclusive' } }], metadata,
        payment_intent_data: { metadata }, ...(config.paymentMethodConfiguration ? { payment_method_configuration: config.paymentMethodConfiguration } : {}) };
      const session = await stripe.checkout.sessions.create(params, { idempotencyKey: `plsfx-checkout-${intent.id}` });
      if (!/^cs_/.test(session.id) || !safeCheckoutUrl(session.url)) throw failure('INVALID_SESSION', 'Could not open secure checkout. Contact support@plsfx.ai.', 502);
      intent.sessionId = session.id; intent.checkoutUrl = session.url; intent.status = 'open'; save(intent);
      return response(intent);
    });
  }
  const retrieve = id => stripe.checkout.sessions.retrieve(id, { expand: ['line_items.data.price.product', 'payment_intent'] });
  function verifySession(intent, session) {
    const item = session.line_items?.data?.[0];
    const product = typeof item?.price?.product === 'string' ? item.price.product : item?.price?.product?.id;
    if (intent.accountId !== config.accountId || intent.live !== config.live || session.livemode !== config.live || session.mode !== 'payment' || session.client_reference_id !== intent.id || session.metadata?.checkout_id !== intent.id || session.metadata?.source_sha256 !== intent.sourceSha256 || session.metadata?.pricing_version !== intent.pricingVersion || session.currency !== 'aud' || session.amount_total !== intent.amountCents || session.amount_subtotal !== intent.amountCents || session.line_items?.has_more || session.line_items?.data?.length !== 1 || item.quantity !== 1 || item.price?.currency !== 'aud' || item.price?.unit_amount !== intent.amountCents || product !== intent.productId || (intent.sessionId && session.id !== intent.sessionId)) {
      throw failure('SESSION_MISMATCH', 'Payment does not match its verified checkout.', 409);
    }
  }
  async function sendNotifications(intent, order, keys = order.paymentReviewRequired ? ['paymentIssue', 'admin'] : ['confirmation', 'admin', 'pending']) {
    let failed = false;
    for (const key of keys) {
      const attempt = intent.notices[key] || {};
      if (['sent', 'manual_review'].includes(attempt.status)) continue;
      if (attempt.firstAttemptAt && now() - attempt.firstAttemptAt > 23 * HOUR) { intent.notices[key] = { ...attempt, status: 'manual_review' }; save(intent); console.error('Stripe notification requires manual review:', intent.id, key); continue; }
      const idempotencyKey = `plsfx-${intent.id}-${key}`;
      intent.notices[key] = { ...attempt, firstAttemptAt: attempt.firstAttemptAt || now(), lastAttemptAt: now(), status: 'attempting' }; save(intent);
      try {
        const result = await notifications[key]?.(order, idempotencyKey);
        if (!result?.success) throw Error('Notification was not accepted');
        intent.notices[key].status = 'sent'; save(intent);
      } catch (_) { intent.notices[key].status = 'retry'; save(intent); failed = true; }
    }
    if (failed) throw failure('NOTIFICATION_RETRY', 'Payment recorded; notification delivery will retry.', 503);
  }
  async function applySession(intent, session) {
    verifySession(intent, session);
    intent.sessionId = session.id;
    if (session.payment_status === 'paid') {
      const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (!/^pi_/.test(pi || '') || session.status !== 'complete') throw failure('PAYMENT_UNVERIFIED', 'Payment is not complete.', 409);
      let issue = null; try { store.assertSource(intent); } catch (e) { issue = e.message; }
      // Persist first. An interrupted mapping update will find this same order on replay.
      let order = orders.createPaidOrderOnce(intent.id, {
        fullName: intent.fullName, company: intent.company, email: intent.email, originalName: intent.originalName, storedAs: intent.storedAs,
        grandTotal: intent.grandTotal, amountCents: intent.amountCents, currency: 'aud', uniqueFormulaTotal: intent.uniqueFormulaTotal, fscoreDist: intent.fscoreDist,
        fileSizeBytes: intent.fileSizeBytes, sourceSha256: intent.sourceSha256, pricingVersion: intent.pricingVersion, promoCode: intent.promoCode || null,
        transactionId: pi, payment: { provider: 'stripe', status: 'paid', sessionId: session.id, paymentIntentId: pi, accountId: intent.accountId, live: intent.live, verifiedAt: new Date(now()).toISOString() },
        status: issue ? 'payment_review_required' : 'pending_review', held: !!issue, heldReason: issue, paymentReviewRequired: !!issue,
      });
      if (issue && !order.piiScrubbedAt && order.status !== 'review_complete' && !order.paymentReviewRequired) order = orders.updateOrder(order.orderId, { held: true, heldReason: issue, paymentReviewRequired: true, ...(order.status === 'in_review' ? {} : { status: 'payment_review_required' }) });
      intent.orderId = order.orderId; intent.paidAt ||= now(); intent.status = order.paymentReviewRequired ? 'review_required' : 'paid'; save(intent);
      if (intent.promoCode && intent.email && !intent.promoClaimed) { promos.claimUsage(intent.promoCode, intent.email, order.orderId); intent.promoClaimed = true; save(intent); }
      // A paid single-use reservation is retained as an additional crash-safe guard.
      await sendNotifications(intent, order);
    } else if (!intent.orderId) {
      if (session.payment_status === 'no_payment_required') throw failure('PAYMENT_UNVERIFIED', 'A positive paid total is required.', 409);
      const failedPi = typeof session.payment_intent === 'object' && ['canceled', 'requires_payment_method'].includes(session.payment_intent?.status) && session.status === 'complete';
      intent.status = session.status === 'expired' ? 'expired' : failedPi ? 'failed' : session.status === 'complete' ? 'processing' : 'open';
      if (safeCheckoutUrl(session.url)) intent.checkoutUrl = session.url;
      save(intent);
      if (['expired', 'failed'].includes(intent.status)) store.releasePromo(intent);
      if (intent.status === 'failed') await sendNotifications(intent, intent, ['failure']);
    }
    return intent;
  }
  async function handleWebhook(body, signature) {
    let event;
    try { event = stripe.webhooks.constructEvent(body, signature, config.webhookSecret); }
    catch (_) { throw failure('INVALID_SIGNATURE', 'Invalid Stripe webhook signature.', 400); }
    if (event.livemode !== config.live || (event.account && event.account !== config.accountId)) throw failure('EVENT_ENVIRONMENT_MISMATCH', 'Wrong payment environment.', 400);
    if (!['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed'].includes(event.type)) return { received: true };
    const id = event.data.object.metadata?.checkout_id;
    // Unrelated account activity is acknowledged without creating customer orders.
    if (!id) return { received: true };
    return store.lockIntent(id, async () => {
      const intent = store.getIntent(id); if (!intent) throw failure('UNKNOWN_CHECKOUT', 'Checkout record is unavailable.', 503);
      await verifyAccount();
      await applySession(intent, await retrieve(event.data.object.id));
      intent.lastEventId = event.id; save(intent); return { received: true };
    });
  }
  async function reconcile(id) {
    return store.lockIntent(id, async () => {
      const intent = store.getIntent(id); if (!intent) throw failure('UNKNOWN_CHECKOUT', 'Checkout not found.', 404);
      await verifyAccount();
      if (!intent.sessionId) {
        if (now() < (intent.expiresAt * 1000 + 10 * 60000)) return intent;
        if (intent.createAttemptedAt) {
          const matches = []; let starting_after;
          do {
            const page = await stripe.checkout.sessions.list({ limit: 100, created: { gte: Math.floor(intent.createAttemptedAt / 1000) - 60, lte: intent.expiresAt + 60 }, ...(starting_after ? { starting_after } : {}) });
            matches.push(...page.data.filter(s => s.client_reference_id === id));
            if (!page.has_more) break;
            if (!page.data.length) throw failure('RECONCILIATION_REQUIRED', 'Incomplete session reconciliation.', 503);
            starting_after = page.data[page.data.length - 1].id;
          } while (true);
          if (matches.length > 1) throw failure('RECONCILIATION_REQUIRED', 'Multiple remote sessions require operator review.', 409);
          if (matches.length === 1) intent.sessionId = matches[0].id;
        }
        if (!intent.sessionId) { intent.status = 'expired'; save(intent); store.releasePromo(intent); return intent; }
      }
      return applySession(intent, await retrieve(intent.sessionId));
    });
  }
  function status(id, token) {
    const i = store.getIntent(id);
    if (!i || !matchesToken(token, digest(i.returnToken))) throw failure('STATUS_ACCESS_DENIED', 'Invalid payment status link.', 403);
    return { success: true, checkoutId: id, status: i.status, orderId: i.orderId || null,
      ...(i.status === 'open' && now() < i.expiresAt * 1000 && safeCheckoutUrl(i.checkoutUrl) ? { resumeUrl: safeCheckoutUrl(i.checkoutUrl) } : {}) };
  }
  function pendingReconciliation() {
    return store.listIntents().map(i => {
      const keys = i.status === 'failed' ? ['failure'] : i.status === 'review_required' ? ['paymentIssue', 'admin'] : ['confirmation', 'admin', 'pending'];
      const manualReviewNotices = keys.filter(k => i.notices?.[k]?.status === 'manual_review');
      const needsReconciliation = i.status !== 'expired' && (['creating', 'open', 'processing', 'review_required'].includes(i.status) || keys.some(k => !['sent', 'manual_review'].includes(i.notices?.[k]?.status)));
      return { checkoutId: i.id, status: i.status, updatedAt: i.updatedAt, orderId: i.orderId || null, needsReconciliation, manualReviewNotices };
    }).filter(i => i.needsReconciliation || i.manualReviewNotices.length);
  }
  async function reconcilePending() {
    const results = [];
    for (const i of pendingReconciliation().filter(i => i.needsReconciliation)) { try { const next = await reconcile(i.checkoutId); results.push({ checkoutId: i.checkoutId, status: next.status }); } catch (e) { results.push({ checkoutId: i.checkoutId, error: e.code || 'RETRY' }); } }
    return results;
  }
  return { createCheckout, handleWebhook, reconcile, status, pendingReconciliation, reconcilePending, store };
}
module.exports = { stripeConfig, audToCents, safeCheckoutUrl, createStripeService };
