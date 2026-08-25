const express = require('express');
const path = require('path');
const { listOrders, getOrder } = require('../src/utils/order-store');

const app = express();
const PORT = process.env.ADMIN_PORT || 3001;
// The main app's own port — this is a server-to-server call, not a
// browser request, so it never carries an Origin header at all. That
// correctly falls into requireApiKey's existing dev-mode fallback
// (VALIDATOR_API_KEY currently unset). If that variable is ever set in
// the future, this call will need an x-api-key header added.
const MAIN_APP_URL = process.env.MAIN_APP_URL || 'http://localhost:3000';
// Real runs take 10-20+ minutes (confirmed throughout this project's
// testing) — matching the same generous timeout already used for
// nginx's own proxy_read_timeout on this same endpoint.
const RUN_TIMEOUT_MS = 30 * 60 * 1000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * Real order data, read directly from the same order-store.js the main
 * app writes to — no duplicated storage, no separate database. This is
 * a genuinely separate process from the public-facing app (different
 * port, different PM2 process, different nginx auth), but it reads the
 * exact same on-disk records.
 */
app.get('/api/orders', (req, res) => {
  try {
    const orders = listOrders();
    res.json({ orders });
  } catch (err) {
    console.error('   \u26a0\ufe0f  Failed to list orders:', err.message);
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }
  res.json({ order });
});

app.get('/api/run-progress/:orderId', async (req, res) => {
  try {
    const response = await fetch(`${MAIN_APP_URL}/api/run-progress/${req.params.orderId}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the validation pipeline.' });
  }
});

/**
 * The actual pipeline trigger — built as a plain, callable HTTP
 * endpoint specifically so it's usable identically by a human clicking
 * RUN today and, later, an autonomous agent in Phase 2, without needing
 * any rebuild of the trigger mechanism itself.
 */
app.post('/api/run/:orderId', async (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }
  if (!order.storedAs) {
    return res.status(400).json({ error: 'This order has no associated file reference.' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    const response = await fetch(`${MAIN_APP_URL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storedAs: order.storedAs, orderId: req.params.orderId }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`   \u26a0\ufe0f  [${new Date().toISOString()}] Run for ${req.params.orderId} timed out after ${RUN_TIMEOUT_MS / 60000} minutes`);
      return res.status(504).json({ error: 'The validation run timed out. Check the server logs directly for its actual status.' });
    }
    // fetch failed's real reason lives in err.cause (e.g. ECONNRESET,
    // ETIMEDOUT, socket hang up) - err.message alone is just the
    // generic wrapper text "fetch failed" and tells us nothing.
    const causeInfo = err.cause ? ` | cause: ${err.cause.code || err.cause.message || err.cause}` : ' | no err.cause present';
    console.error(`   \u26a0\ufe0f  [${new Date().toISOString()}] Run for ${req.params.orderId} failed:`, err.message, causeInfo);
    res.status(502).json({ error: 'Could not reach the validation pipeline. Please try again.' });
  }
});

app.listen(PORT, () => console.log(`FM Validator Admin running on http://localhost:${PORT}`));
