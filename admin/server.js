const express = require('express');
const path = require('path');
const { listOrders, getOrder, updateOrder } = require('../src/utils/order-store');
const { getProgress } = require('../src/utils/run-progress');
const { fetch: undiciFetch, Agent } = require('undici');

// Node's built-in global fetch() is backed by its OWN internal undici
// instance, which is NOT the same as this separately-installed undici
// package — confirmed directly: passing a dispatcher built from this
// package's Agent to the global fetch() throws UND_ERR_INVALID_ARG
// immediately. undici's own exported fetch (used below) correctly
// accepts it.
//
// The underlying problem this solves: undici has its OWN hard-coded
// 5-minute headersTimeout, completely separate from and unaffected by
// any AbortController/signal-based timeout. Confirmed directly tonight:
// real runs failed with code UND_ERR_HEADERS_TIMEOUT well before either
// the 30-minute RUN_TIMEOUT_MS or the Anthropic client's own 10-minute
// timeout ever had a chance to fire — undici's internal 5-minute
// ceiling was cutting the connection first, every time.
const longRunningDispatcher = new Agent({
  headersTimeout: 30 * 60 * 1000, // match RUN_TIMEOUT_MS
  bodyTimeout: 30 * 60 * 1000,
});

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
    // Deliberately NOT using the long-running dispatcher here - this
    // reads one small JSON file and should be fast. If it ever isn't,
    // we want that to fail quickly and visibly, not silently wait up to
    // 30 minutes for what's supposed to be a near-instant check.
    const response = await fetch(`${MAIN_APP_URL}/api/run-progress/${req.params.orderId}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the validation pipeline.' });
  }
});

app.get('/api/view-log/:orderId', async (req, res) => {
  try {
    const response = await fetch(`${MAIN_APP_URL}/api/view-log/${req.params.orderId}`);
    if (!response.ok) {
      const data = await response.json();
      return res.status(response.status).json(data);
    }
    const text = await response.text();
    res.type('text/plain').send(text);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the validation pipeline.' });
  }
});

app.get('/api/download-report/:orderId', async (req, res) => {
  try {
    const response = await fetch(`${MAIN_APP_URL}/api/download-report/${req.params.orderId}`);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      const data = await response.json();
      return res.status(response.status).json(data);
    }
    if (contentType.includes('application/json')) {
      // No local copy left - the main app returned the real Drive link
      // instead of a binary file. Redirect the user's own browser there
      // directly, rather than this server trying to fetch and stream
      // Drive's HTML preview page as if it were the actual file.
      const data = await response.json();
      if (data.driveWebViewLink) {
        return res.redirect(data.driveWebViewLink);
      }
      return res.status(502).json({ error: 'Unexpected response from the validation pipeline.' });
    }
    // Binary file - forward the real headers (filename, content-type)
    // from the upstream response, then stream the body through rather
    // than buffering the whole file in memory.
    res.set('Content-Disposition', response.headers.get('content-disposition') || 'attachment');
    res.set('Content-Type', contentType || 'application/octet-stream');
    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the validation pipeline.' });
  }
});

app.post('/api/send-report-email/:orderId', async (req, res) => {
  try {
    const response = await fetch(`${MAIN_APP_URL}/api/send-report-email/${req.params.orderId}`, { method: 'POST' });
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

  // A progress entry only exists between a run's first stage and its
  // own cleanup on exit (success or any failure path) — so if one is
  // still present, this order's pipeline hasn't reached any exit point
  // yet: it's either genuinely still running, or stuck. Either way,
  // dispatching a second, overlapping run against the same order is not
  // safe — confirmed directly tonight: two concurrent runs for the same
  // order wrote to the same shared progress file, producing a visible
  // percentage that jumped backward as each one overwrote the other.
  const existingProgress = getProgress(req.params.orderId);
  if (existingProgress) {
    return res.status(409).json({
      error: `A run is already in progress for this order (currently at stage ${existingProgress.stage}/6: ${existingProgress.label}). If this seems stuck, check the server logs directly before retrying — starting a second run against the same file will corrupt the progress display for both.`,
    });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RUN_TIMEOUT_MS);

    const response = await undiciFetch(`${MAIN_APP_URL}/api/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storedAs: order.storedAs, orderId: req.params.orderId }),
      signal: controller.signal,
      dispatcher: longRunningDispatcher,
    });
    clearTimeout(timer);

    const data = await response.json();

    // Persist whatever run artifacts this response gives us, regardless
    // of outcome — runLogFilename is included on every exit path
    // (success or failure), since viewing a failed run's log is exactly
    // what's been needed all night. reportName only exists on a genuine
    // successful completion (passed/flagged), never on a failure.
    const updates = {};
    if (data.runLogFilename) updates.runLogFilename = data.runLogFilename;
    if (data.reportName) updates.reportName = data.reportName;
    if (Object.keys(updates).length > 0) {
      updateOrder(req.params.orderId, updates);
    }

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
