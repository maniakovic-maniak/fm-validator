'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path'); const os = require('os'); const net = require('net');
const { spawn } = require('child_process'); const { once } = require('events'); const { setTimeout: delay } = require('timers/promises');
const ExcelJS = require('exceljs'); const Stripe = require('stripe');

test('actual Express payment routes with synthetic workbook and blocked outbound transport', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plsfx-http-tests-'));
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  // Startup runs retention: isolate every runtime path, not merely order/payment state.
  const runtime = path.join(temp, 'runtime'); fs.mkdirSync(runtime);
  for (const name of ['server.js', 'package.json', 'src', 'config', 'public', 'scripts']) fs.cpSync(path.join(__dirname, name), path.join(runtime, name), { recursive: true });
  fs.symlinkSync(path.join(__dirname, 'node_modules'), path.join(runtime, 'node_modules'), 'dir');
  const env = { ...process.env, PORT: String(port), ALLOWED_ORIGIN: 'https://plsfx.ai', VALIDATOR_API_KEY: 'synthetic-http-key', ORDER_DATA_DIR: path.join(temp, 'orders'), PAYMENT_DATA_DIR: path.join(temp, 'payments'), PROMO_DATA_DIR: path.join(temp, 'promos'),
    STRIPE_SECRET_KEY: 'sk_test_synthetic_http', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_http', STRIPE_ACCOUNT_ID: 'acct_synthetic_http', STRIPE_PRODUCT_ID: 'prod_synthetic_http', STRIPE_LIVE_MODE: 'false', PUBLIC_CHECKOUT_BASE_URL: 'https://plsfx.ai/fm-validator', STRIPE_RECONCILIATION_ENABLED: 'false', RESEND_API_KEY: '', ANTHROPIC_API_KEY: 'synthetic-unused' };
  const bootstrap = "for(const module of ['http','https'])require(module).request=()=>{throw Error('Outbound transport blocked by HTTP test')};global.fetch=async()=>{throw Error('Outbound fetch blocked by HTTP test')};require('./server.js');";
  const child = spawn(process.execPath, ['-e', bootstrap], { cwd: runtime, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', d => { logs = (logs + d).slice(-14000); });
  const base = `http://127.0.0.1:${port}`;
  const json = (body, headers = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://plsfx.ai', ...headers }, body: JSON.stringify(body) });
  let storedAs;
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) { try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch (_) {} if (child.exitCode !== null) break; await delay(100); }
    assert(ready, 'Synthetic server startup failed: ' + logs);
    await t.test('health and signed raw webhook work on both unprefixed and prefixed paths', async () => {
      const sdk = new Stripe('sk_test_synthetic_http');
      const raw = JSON.stringify({ id: 'evt_synthetic_http', livemode: false, type: 'checkout.session.completed', data: { object: { id: 'cs_synthetic_unrelated', metadata: {} } } });
      const signature = sdk.webhooks.generateTestHeaderString({ payload: raw, secret: env.STRIPE_WEBHOOK_SECRET });
      for (const prefix of ['', '/fm-validator']) {
        assert.equal((await fetch(base + prefix + '/api/health')).status, 200);
        const r = await fetch(base + prefix + '/api/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: raw }); assert.equal(r.status, 200); assert.equal((await r.json()).received, true);
      }
    });
    await t.test('both raw webhook paths reject an invalid signature', async () => {
      for (const prefix of ['', '/fm-validator']) { const r = await fetch(base + prefix + '/api/stripe/webhook', json({ type: 'checkout.session.completed' }, { 'Stripe-Signature': 'invalid' })); assert.equal(r.status, 400); assert.equal((await r.json()).code, 'INVALID_SIGNATURE'); }
    });
    await t.test('legacy payment endpoint fails closed', async () => { const r = await fetch(base + '/fm-validator/api/submit-order', json({ eWayEncryptedPayload: 'synthetic' })); assert.equal(r.status, 410); });
    await t.test('Origin-only cannot trigger audit or retrieve privileged reports', async () => {
      assert.equal((await fetch(base + '/fm-validator/api/validate', json({}))).status, 401);
      assert.equal((await fetch(base + '/api/download-report/Fm-00001', { headers: { Origin: 'https://plsfx.ai' } })).status, 401);
      assert.equal((await fetch(base + '/api/validate', json({ storedAs: 'synthetic.xlsx', orderId: 'Fm-00001' }, { 'x-api-key': env.VALIDATOR_API_KEY }))).status, 402);
    });
    let uploadToken;
    await t.test('verified upload issues capability; actual Tier0 quote preserves A$10 minimum', async () => {
      const wb = new ExcelJS.Workbook(); const inputs = wb.addWorksheet('Inputs'); inputs.getCell('A1').value = 1; inputs.getCell('A2').value = 2; inputs.getCell('B1').value = { formula: 'A1+A2', result: 3 }; const cash = wb.addWorksheet('Cash Flow'); cash.getCell('A1').value = { formula: 'Inputs!B1', result: 3 };
      const bytes = await wb.xlsx.writeBuffer(); const form = new FormData(); form.append('file', new Blob([bytes]), 'stripe-http-synthetic.xlsx');
      const response = await fetch(base + '/fm-validator/api/verify-upload', { method: 'POST', headers: { Origin: 'https://plsfx.ai' }, body: form }); assert.equal(response.status, 200);
      const verified = await response.json(); assert.equal(verified.passed, true, JSON.stringify(verified)); assert.match(verified.uploadToken, /^[a-f0-9]{64}$/); storedAs = verified.storedAs; uploadToken = verified.uploadToken;
      const r = await fetch(base + '/fm-validator/api/unique-formulas', json({ storedAs, uploadToken })); assert.equal(r.status, 200); const quote = await r.json(); assert.equal(quote.status, 'success'); assert.equal(quote.grandTotal, 10); assert(quote.uniqueFormulaTotal > 0);
    });
    await t.test('staged quote requires the correct upload capability', async () => {
      for (const body of [{ storedAs }, { storedAs, uploadToken: 'incorrect' }]) assert.equal((await fetch(base + '/api/unique-formulas', json(body))).status, 403);
    });
    await t.test('checkout rejects client quote mismatch without provider access', async () => {
      const r = await fetch(base + '/api/stripe/checkout', json({ storedAs, uploadToken, fullName: 'Synthetic User', company: 'Fixture Ltd', email: 'fixture@example.invalid', quotedGrandTotal: 1 })); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'PRICE_MISMATCH');
    });
    await t.test('source changes after verification cannot be quoted or charged', async () => {
      fs.appendFileSync(path.join(runtime, 'uploads', storedAs), '\nsynthetic tamper');
      const r = await fetch(base + '/api/unique-formulas', json({ storedAs, uploadToken })); assert.equal(r.status, 409); assert.equal((await r.json()).code, 'SOURCE_UNAVAILABLE');
    });
    await t.test('return page is private and payment status requires its return capability', async () => {
      const r = await fetch(base + '/fm-validator/checkout/stripe-return'); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal(r.headers.get('referrer-policy'), 'no-referrer'); assert(r.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
      const html = await r.text(); assert(html.includes('Resume secure checkout')); assert(html.includes('support@plsfx.ai'));
      const status = await fetch(base + '/fm-validator/api/stripe/checkouts/ci_' + 'a'.repeat(64) + '?token=incorrect'); assert.equal(status.status, 403); assert.equal(status.headers.get('cache-control'), 'no-store');
    });
  } finally {
    child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), delay(2000)]); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
