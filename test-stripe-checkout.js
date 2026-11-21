'use strict';
// Synthetic fixtures only. All Stripe/Resend transport is replaced; SDK signatures are real.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('fs'); const os = require('os'); const path = require('path'); const crypto = require('crypto');
const { spawn } = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plsfx-payment-tests-'));
process.env.PROMO_DATA_DIR = path.join(root, 'promos');
const Stripe = require('stripe');
const { createCheckoutStore } = require('./src/utils/checkout-store');
const { createOrderStore } = require('./src/utils/order-store');
const { createStripeService, audToCents, stripeConfig, safeCheckoutUrl } = require('./src/utils/stripe-payment');
const { assertPaidSource, requireInternalApiKey } = require('./src/utils/payment-access');
const promos = require('./src/utils/promo-code-store');
const signing = new Stripe('sk_test_synthetic_fixture').webhooks;
const config = { secretKey: 'sk_test_synthetic_fixture', webhookSecret: 'whsec_synthetic_fixture', accountId: 'acct_synthetic', productId: 'prod_synthetic', baseUrl: 'https://plsfx.ai/fm-validator', live: false };
let seq = 0;
function fixture({ total = 827, notices = {} } = {}) {
  const dir = path.join(root, String(++seq)); const uploadsDir = path.join(dir, 'uploads'); fs.mkdirSync(uploadsDir, { recursive: true });
  const store = createCheckoutStore({ dir: path.join(dir, 'state'), uploadsDir });
  const orders = createOrderStore(path.join(dir, 'orders')); const sessions = new Map(); const requests = []; const keys = new Map(); const emails = [];
  let time = Date.now(); let loseResponse = false; let charges = true; let active = true;
  const stripe = { webhooks: signing, accounts: { retrieve: async () => ({ id: config.accountId, charges_enabled: charges }) }, products: { retrieve: async () => ({ id: config.productId, active, livemode: false }) }, checkout: { sessions: {
    create: async (params, options) => {
      requests.push({ params, options });
      let s = keys.get(options.idempotencyKey);
      if (!s) { s = { id: 'cs_test_' + crypto.randomBytes(10).toString('hex'), url: 'https://checkout.stripe.com/c/pay/test_' + seq, mode: 'payment', livemode: false, client_reference_id: params.client_reference_id, metadata: params.metadata,
        amount_total: params.line_items[0].price_data.unit_amount, amount_subtotal: params.line_items[0].price_data.unit_amount, currency: 'aud', payment_status: 'unpaid', status: 'open', payment_intent: null,
        line_items: { data: [{ quantity: 1, price: { ...params.line_items[0].price_data } }], has_more: false }, created: Math.floor(time / 1000) };
        sessions.set(s.id, s); keys.set(options.idempotencyKey, s); }
      if (loseResponse) { loseResponse = false; throw Error('Synthetic lost response'); }
      return structuredClone(s);
    },
    retrieve: async id => { assert(sessions.has(id)); return structuredClone(sessions.get(id)); },
    list: async () => ({ data: [...sessions.values()].map(s => structuredClone(s)), has_more: false }),
  } } };
  const notifications = Object.fromEntries(['confirmation', 'admin', 'pending', 'paymentIssue', 'failure'].map(key => [key, async (order, idempotencyKey) => { emails.push({ key, idempotencyKey, orderId: order.orderId }); return notices[key] ? notices[key](order) : { success: true }; }]));
  const quote = async (_, discount) => {
    const priceTotal = total === 10 ? 0 : 752;
    const discountAmount = discount ? discount.type === 'percent' ? Math.round(priceTotal * discount.value / 100) : discount.value : 0;
    const subtotal = Math.max(0, priceTotal - discountAmount);
    const grandTotal = discount ? Math.max(10, subtotal + Math.round(subtotal * .1)) : total;
    return { grandTotal, priceTotal, discountAmount, gstTotal: Math.round(subtotal * .1), uniqueFormulaTotal: 1, fscoreDist: { Low: 1, Moderate: 0, High: 0, Critical: 0 } };
  };
  const service = createStripeService({ config, stripe, store, orders, promos, quote, notifications, now: () => time });
  function upload(name = 'synthetic.xlsx') { fs.writeFileSync(path.join(uploadsDir, name), 'synthetic-workbook-v1'); return { storedAs: name, uploadToken: store.registerUpload(name, 'Synthetic model.xlsx'), fullName: 'Fixture User', company: 'Fixture Ltd', email: 'fixture@example.invalid', quotedGrandTotal: total }; }
  const input = upload();
  function event(type, session) { const body = Buffer.from(JSON.stringify({ id: 'evt_' + crypto.randomBytes(12).toString('hex'), livemode: false, type, data: { object: { id: session.id, metadata: session.metadata } } })); return [body, signing.generateTestHeaderString({ payload: body.toString(), secret: config.webhookSecret })]; }
  async function pay(created) { const i = store.getIntent(created.checkoutId); const s = sessions.get(i.sessionId); s.payment_status = 'paid'; s.status = 'complete'; s.payment_intent = 'pi_synthetic'; await service.handleWebhook(...event('checkout.session.completed', s)); return orders.getOrder(store.getIntent(i.id).orderId); }
  return { dir, uploadsDir, store, orders, service, stripe, sessions, requests, emails, input, upload, event, pay, setTime: v => { time = v; }, lose: () => { loseResponse = true; }, disable: () => { charges = false; active = false; } };
}
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('AUD conversion is once: 827→82700, A$10→1000, invalid/fractional/outsize totals fail', () => {
  assert.equal(audToCents(827), 82700); assert.equal(audToCents(10), 1000); assert.equal(audToCents(10.12), 1012);
  for (const v of [0, 9.99, NaN, Infinity, '10', 10.001, 1000000]) assert.throws(() => audToCents(v));
});
test('configuration fails closed and supports restricted keys without merchant defaults', () => {
  assert.throws(() => stripeConfig({}));
  const env = { STRIPE_SECRET_KEY: 'rk_test_synthetic', STRIPE_WEBHOOK_SECRET: config.webhookSecret, STRIPE_ACCOUNT_ID: config.accountId, STRIPE_PRODUCT_ID: config.productId, PUBLIC_CHECKOUT_BASE_URL: config.baseUrl };
  assert.equal(stripeConfig(env).live, false);
  assert.throws(() => stripeConfig({ ...env, STRIPE_LIVE_MODE: 'true' }));
  for (const u of ['ftp://localhost', 'https://name:pass@plsfx.ai', 'http://plsfx.ai']) assert.throws(() => stripeConfig({ ...env, PUBLIC_CHECKOUT_BASE_URL: u }));
  assert.equal(safeCheckoutUrl('https://evil.test'), null); assert.equal(safeCheckoutUrl('https://user@checkout.stripe.com'), null);
});
test('upload capability, source hash, card fields and client price are checked before Stripe', async () => {
  const f = fixture();
  await assert.rejects(f.service.createCheckout({ ...f.input, uploadToken: 'wrong' }), { code: 'UPLOAD_ACCESS_DENIED' });
  await assert.rejects(f.service.createCheckout({ ...f.input, cardNumber: 'synthetic' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.service.createCheckout({ ...f.input, quotedGrandTotal: 10 }), { code: 'PRICE_MISMATCH' });
  fs.writeFileSync(path.join(f.uploadsDir, f.input.storedAs), 'changed');
  await assert.rejects(f.service.createCheckout(f.input), { code: 'SOURCE_UNAVAILABLE' }); assert.equal(f.requests.length, 0);
});
test('hosted session uses inclusive server amount and persisted idempotence after a lost response', async () => {
  const f = fixture(); f.lose(); await assert.rejects(f.service.createCheckout(f.input));
  assert.equal(f.orders.listOrders().length, 0);
  const created = await f.service.createCheckout(f.input);
  assert.equal(f.sessions.size, 1); assert.equal(f.requests[0].options.idempotencyKey, f.requests[1].options.idempotencyKey);
  assert.deepEqual(f.requests[0].params, f.requests[1].params);
  const p = f.requests[0].params; assert.equal(p.line_items[0].price_data.unit_amount, 82700); assert.equal(p.line_items[0].price_data.tax_behavior, 'inclusive'); assert.equal(p.automatic_tax.enabled, false); assert.equal(p.adaptive_pricing.enabled, false); assert.equal(p.payment_method_types, undefined);
  const i = f.store.getIntent(created.checkoutId); assert.equal(f.service.status(i.id, i.returnToken).resumeUrl, created.checkoutUrl);
});
test('real Stripe signature verifier rejects changed bytes before provider lookup', async () => {
  const f = fixture(); const created = await f.service.createCheckout(f.input); const i = f.store.getIntent(created.checkoutId);
  const [body, signature] = f.event('checkout.session.completed', f.sessions.get(i.sessionId));
  await assert.rejects(f.service.handleWebhook(Buffer.concat([body, Buffer.from(' ')]), signature), { code: 'INVALID_SIGNATURE' }); assert.equal(f.orders.listOrders().length, 0);
});
test('wrong money, currency, environment, product or source metadata cannot create paid orders', async () => {
  for (const change of [s => s.amount_total++, s => s.currency = 'usd', s => s.livemode = true, s => s.line_items.data[0].price.product = 'prod_wrong', s => s.metadata.source_sha256 = 'wrong']) {
    const f = fixture(); const c = await f.service.createCheckout(f.input); const i = f.store.getIntent(c.checkoutId); const s = f.sessions.get(i.sessionId); change(s);
    await assert.rejects(f.pay(c), { code: 'SESSION_MISMATCH' }); assert.equal(f.orders.listOrders().length, 0);
  }
});
test('unpaid and no-payment-required cannot fulfil; duplicate workers create one manual-review order', async () => {
  const f = fixture(); const c = await f.service.createCheckout(f.input); const i = f.store.getIntent(c.checkoutId); const s = f.sessions.get(i.sessionId);
  await f.service.handleWebhook(...f.event('checkout.session.completed', s)); assert.equal(f.orders.listOrders().length, 0);
  s.payment_status = 'no_payment_required'; await assert.rejects(f.service.handleWebhook(...f.event('checkout.session.completed', s)), { code: 'PAYMENT_UNVERIFIED' });
  s.payment_status = 'paid'; s.status = 'complete'; s.payment_intent = 'pi_synthetic';
  await Promise.all(Array.from({ length: 5 }, () => f.service.handleWebhook(...f.event('checkout.session.completed', s))));
  const order = f.orders.listOrders()[0]; assert.equal(f.orders.listOrders().length, 1); assert.equal(order.status, 'pending_review'); assert.equal(f.emails.length, 3);
  const state = f.store.getIntent(i.id); assert.equal(f.service.status(i.id, state.returnToken).resumeUrl, undefined);
  f.orders.updateOrder(order.orderId, { status: 'in_review' }); await f.service.handleWebhook(...f.event('checkout.session.expired', s)); assert.equal(f.orders.getOrder(order.orderId).status, 'in_review');
});
test('crash after order write before intent mapping recovers the same order', async () => {
  const f = fixture(); const c = await f.service.createCheckout(f.input); const original = f.store.saveIntent; let crash = true;
  f.store.saveIntent = i => { if (i.orderId && crash) { crash = false; throw Error('simulated crash'); } return original(i); };
  await assert.rejects(f.pay(c)); assert.equal(f.orders.listOrders().length, 1);
  const originalId = f.orders.listOrders()[0].orderId; const recovered = await f.pay(c); assert.equal(recovered.orderId, originalId); assert.equal(f.orders.listOrders().length, 1);
});
test('durable order identity rejects a conflicting immutable money/source mapping', async () => {
  const f = fixture(); const c = await f.service.createCheckout(f.input); const order = await f.pay(c);
  assert.throws(() => f.orders.createPaidOrderOnce(c.checkoutId, { ...order, amountCents: 1 }), { code: 'ORDER_BINDING_MISMATCH' });
});
test('disabled new charges or archived product do not block recording an earlier paid session', async () => {
  const f = fixture(); const c = await f.service.createCheckout(f.input); f.disable(); const o = await f.pay(c); assert.equal(o.payment.status, 'paid');
});
test('paid missing source becomes visible held order; customer email failure does not suppress admin', async () => {
  const f = fixture({ notices: { paymentIssue: async () => ({ error: 'synthetic rejection' }) } }); const c = await f.service.createCheckout(f.input); fs.unlinkSync(path.join(f.uploadsDir, f.input.storedAs));
  await assert.rejects(f.pay(c), { code: 'NOTIFICATION_RETRY' });
  const o = f.orders.listOrders()[0]; assert.equal(o.payment.status, 'paid'); assert.equal(o.paymentReviewRequired, true); assert.equal(o.status, 'payment_review_required'); assert(f.emails.some(e => e.key === 'admin'));
  const i = f.store.getIntent(c.checkoutId); assert.equal(f.service.status(i.id, i.returnToken).status, 'review_required'); assert.equal(f.service.status(i.id, i.returnToken).resumeUrl, undefined);
  process.env.STRIPE_ACCOUNT_ID = config.accountId; process.env.STRIPE_LIVE_MODE = 'false';
  assert.throws(() => assertPaidSource(o, o.storedAs, f.uploadsDir), { code: 'PAYMENT_REVIEW_REQUIRED' });
});
test('restored exact source plus explicit admin hold clear recovers same order and notices', async () => {
  const f = fixture(); const c = await f.service.createCheckout(f.input); fs.unlinkSync(path.join(f.uploadsDir, f.input.storedAs)); const held = await f.pay(c);
  fs.writeFileSync(path.join(f.uploadsDir, f.input.storedAs), 'synthetic-workbook-v1');
  assertPaidSource(held, held.storedAs, f.uploadsDir, { allowReviewHold: true });
  f.orders.updateOrder(held.orderId, { held: false, heldReason: null, paymentReviewRequired: false, status: 'pending_review' });
  await f.service.reconcile(c.checkoutId); assert.equal(f.orders.listOrders().length, 1); assert.equal(f.store.getIntent(c.checkoutId).status, 'paid'); assert.equal(f.emails.filter(x => x.key === 'admin').length, 1);
});
test('completed order survives a duplicate payment event after normal source removal', async () => {
  const f = fixture(); const c = await f.service.createCheckout(f.input); const o = await f.pay(c); f.orders.updateOrder(o.orderId, { status: 'review_complete' });
  fs.unlinkSync(path.join(f.uploadsDir, f.input.storedAs)); await f.pay(c);
  assert.equal(f.orders.getOrder(o.orderId).status, 'review_complete'); assert.equal(f.orders.getOrder(o.orderId).paymentReviewRequired, false);
});
test('notification retry uses same keys, preserves paid order, and caps uncertain retries at23h', async () => {
  let fail = true; const f = fixture({ notices: { confirmation: async () => fail ? { error: 'retry' } : { success: true } } }); const c = await f.service.createCheckout(f.input);
  await assert.rejects(f.pay(c), { code: 'NOTIFICATION_RETRY' }); assert.equal(f.orders.listOrders().length, 1); assert(f.service.pendingReconciliation().some(i => i.checkoutId === c.checkoutId));
  fail = false; await f.service.reconcile(c.checkoutId); const calls = f.emails.filter(e => e.key === 'confirmation'); assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey); assert.equal(f.emails.filter(e => e.key === 'admin').length, 1);
  const i = f.store.getIntent(c.checkoutId); i.notices.confirmation = { status: 'retry', firstAttemptAt: Date.now() - 24 * 3600000 }; f.store.saveIntent(i);
  const before = f.emails.length; await f.service.reconcile(i.id); assert.equal(f.emails.length, before); assert.equal(f.store.getIntent(i.id).notices.confirmation.status, 'manual_review');
});
test('delayed failed payment permits new attempt; stale failure after current success cannot downgrade paid', async () => {
  const code = 'DELAYED_' + seq; promos.createPromoCode({ code, discountType: 'percent', discountValue: 10, singleUse: true });
  const f = fixture(); const input = { ...f.input, promoCode: code, quotedGrandTotal: 745 }; const c = await f.service.createCheckout(input); const i = f.store.getIntent(c.checkoutId); const s = f.sessions.get(i.sessionId);
  s.status = 'complete'; s.payment_intent = { id: 'pi_delayed', status: 'processing' }; await f.service.handleWebhook(...f.event('checkout.session.completed', s)); assert.equal(f.store.getIntent(i.id).status, 'processing'); assert.equal(f.orders.listOrders().length, 0);
  s.payment_intent.status = 'requires_payment_method'; await f.service.handleWebhook(...f.event('checkout.session.async_payment_failed', s)); assert.equal(f.store.getIntent(i.id).status, 'failed'); assert.equal(f.emails.filter(e => e.key === 'failure').length, 1);
  const next = { ...f.upload('second.xlsx'), promoCode: code, quotedGrandTotal: 745 }; await f.service.createCheckout(next);
  s.payment_status = 'paid'; s.payment_intent = { id: 'pi_delayed', status: 'succeeded' }; await f.service.handleWebhook(...f.event('checkout.session.async_payment_failed', s)); assert.equal(f.store.getIntent(i.id).status, 'paid');
});
test('single-use promotion reserves across distinct uploads and releases only confirmed expiry', async () => {
  const code = 'ONCE_' + seq; promos.createPromoCode({ code, discountType: 'percent', discountValue: 10, singleUse: true });
  assert.equal(promos.validatePromoCode(code, 'fixture@example.invalid').singleUse, true);
  const f = fixture(); const c = await f.service.createCheckout({ ...f.input, promoCode: code, quotedGrandTotal: 745 });
  const second = { ...f.upload('second.xlsx'), promoCode: code, quotedGrandTotal: 745 };
  await assert.rejects(f.service.createCheckout(second), { code: 'PROMO_RESERVED' });
  const i = f.store.getIntent(c.checkoutId); f.sessions.get(i.sessionId).status = 'expired'; await f.service.reconcile(i.id); await f.service.createCheckout(second);
  assert.equal(f.sessions.size, 2);
});
test('full discount retains A$10 minimum and usage stores email hash', async () => {
  const code = 'FULL_' + seq; promos.createPromoCode({ code, discountType: 'percent', discountValue: 100, singleUse: true });
  const f = fixture(); const c = await f.service.createCheckout({ ...f.input, promoCode: code, quotedGrandTotal: 10 }); await f.pay(c);
  assert.equal(f.requests[0].params.line_items[0].price_data.unit_amount, 1000);
  const files = fs.readdirSync(path.join(process.env.PROMO_DATA_DIR, 'usage')); assert(files.length > 0);
  for (const file of files) assert(!fs.readFileSync(path.join(process.env.PROMO_DATA_DIR, 'usage', file), 'utf8').includes('fixture@example.invalid'));
});
test('abandoned pre-session and uncertain-create intents reconcile without creating new sessions', async () => {
  const f = fixture(); f.lose(); await assert.rejects(f.service.createCheckout(f.input)); const i = f.store.listIntents()[0]; const s = [...f.sessions.values()][0]; s.status = 'expired';
  f.setTime(i.expiresAt * 1000 + 11 * 60000); await f.service.reconcile(i.id); assert.equal(f.store.getIntent(i.id).status, 'expired'); assert.equal(f.requests.length, 1);
  const g = fixture(); g.stripe.accounts.retrieve = async () => { throw Error('pre-session failure'); }; await assert.rejects(g.service.createCheckout(g.input)); const pending = g.store.listIntents()[0]; g.stripe.accounts.retrieve = f.stripe.accounts.retrieve; g.setTime(pending.expiresAt * 1000 + 11 * 60000); await g.service.reconcile(pending.id); assert.equal(g.store.getIntent(pending.id).status, 'expired'); assert.equal(g.requests.length, 0);
});
test('independent OS workers allocate one durable order and preserve concurrent updates', async () => {
  const f = fixture(); const id = 'ci_' + 'a'.repeat(64); const modulePath = require.resolve('./src/utils/order-store');
  const run = n => new Promise((resolve, reject) => { const source = `const s=require(${JSON.stringify(modulePath)}).createOrderStore(${JSON.stringify(path.join(f.dir,'orders'))});const o=s.createPaidOrderOnce(${JSON.stringify(id)},{sourceSha256:'hash',amountCents:1000,currency:'aud',pricingVersion:'pricing-key-v1',payment:{provider:'stripe',status:'paid',sessionId:'cs_test',paymentIntentId:'pi_test',accountId:'acct_test',live:false}});s.updateOrder(o.orderId,{worker${n}:true});`; const child = spawn(process.execPath, ['-e', source], { stdio: ['ignore','ignore','pipe'] }); let err='';child.stderr.on('data', d=>err+=d);child.on('exit', code=>code===0?resolve():reject(Error(err))); });
  await Promise.all([0,1,2,3,4].map(run)); const orders = f.orders.listOrders(); assert.equal(orders.length, 1); for (let n=0;n<5;n++) assert.equal(orders[0]['worker'+n],true);
});
test('internal route auth rejects Origin-only and emulated orders cannot start paid audit', () => {
  process.env.VALIDATOR_API_KEY = 'synthetic-internal-key'; let status; let called = false;
  const res = { status: n => { status=n;return res; }, json: () => {} };
  requireInternalApiKey({headers:{origin:'https://plsfx.ai'}},res,()=>{called=true;}); assert.equal(status,401); assert.equal(called,false);
  requireInternalApiKey({headers:{'x-api-key':process.env.VALIDATOR_API_KEY}},res,()=>{called=true;});assert.equal(called,true);
  assert.throws(()=>assertPaidSource({transactionId:'EMULATED-synthetic'},'synthetic.xlsx','.'),{code:'PAYMENT_REQUIRED'});
});
test('retention protects unresolved sources and scrubs completed duplicated contacts after14days', async () => {
  const { protectPaymentSources } = require('./src/utils/cleanup'); const f = fixture(); const c = await f.service.createCheckout(f.input); const i = f.store.getIntent(c.checkoutId);
  let protectedNames = await protectPaymentSources({store:f.store,orders:f.orders,now:Date.now()+20*86400000}); assert(protectedNames.has(f.input.storedAs));
  const order = await f.pay(c); f.orders.updateOrder(order.orderId,{status:'review_complete',reviewCompletedAt:new Date(Date.now()-15*86400000).toISOString()});
  protectedNames = await protectPaymentSources({store:f.store,orders:f.orders,now:Date.now()+20*86400000}); assert(!protectedNames.has(f.input.storedAs));
  assert.equal(f.orders.getOrder(order.orderId).email,null); assert.equal(f.store.getIntent(i.id).email,null); assert.equal(f.store.getIntent(i.id).amountCents,82700); assert.equal(f.orders.getOrder(order.orderId).payment.status,'paid');
});
