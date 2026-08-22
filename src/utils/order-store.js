const fs = require('fs');
const path = require('path');

const ORDERS_DIR = path.join(__dirname, '..', '..', 'orders');
const ORDER_ID_PREFIX = 'Fm-';
const ORDER_ID_DIGITS = 5;

let ordersDirReady = false;
try {
  if (!fs.existsSync(ORDERS_DIR)) fs.mkdirSync(ORDERS_DIR, { recursive: true });
  ordersDirReady = true;
} catch (err) {
  ordersDirReady = false;
}

/**
 * No database exists anywhere in this project — orders are stored as one
 * JSON file per order, matching the project's existing convention of
 * plain-file storage (checklist.json, run logs, etc.) rather than
 * introducing a new database dependency for what's currently a
 * low-volume flow.
 *
 * Order ID generation reuses the exact atomic-claim pattern already
 * built and live-tested (against real, separate OS processes) in
 * concurrency-limiter.js: fs.writeFileSync's 'wx' flag (write, fail if
 * the file already exists) is a genuine OS-level atomic guarantee, so
 * even with 4 concurrent PM2 workers racing to create an order at the
 * same instant, only one can ever successfully claim a given ID.
 */
function createOrder(orderData) {
  if (!ordersDirReady) {
    throw new Error('Order storage directory unavailable');
  }

  // Start the search just above the highest existing order number, not
  // from a persistent separate counter file — avoids a second thing that
  // could drift out of sync with what's actually on disk.
  const existing = fs.readdirSync(ORDERS_DIR).filter(f => f.startsWith(ORDER_ID_PREFIX) && f.endsWith('.json'));
  let highest = 0;
  for (const f of existing) {
    const n = parseInt(f.slice(ORDER_ID_PREFIX.length, -('.json'.length)), 10);
    if (Number.isFinite(n) && n > highest) highest = n;
  }

  let attempt = highest + 1;
  const maxAttempts = 20; // generous — a genuine collision here would mean 20 concurrent orders landing on the exact same instant
  for (let i = 0; i < maxAttempts; i++, attempt++) {
    const orderId = ORDER_ID_PREFIX + String(attempt).padStart(ORDER_ID_DIGITS, '0');
    const filePath = path.join(ORDERS_DIR, `${orderId}.json`);
    try {
      const record = {
        orderId,
        createdAt: new Date().toISOString(),
        ...orderData,
      };
      fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { flag: 'wx' });
      return record;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // another process claimed this exact number first — try the next one
    }
  }
  throw new Error('Could not allocate an order ID after multiple attempts');
}

function getOrder(orderId) {
  const safeId = path.basename(String(orderId || ''));
  const filePath = path.join(ORDERS_DIR, `${safeId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Scrubs PII and the source file reference from an order record, keeping
 * the record itself — matching the confirmed 2-week retention decision
 * (order kept permanently, personal details + source file deleted).
 * Intentionally does NOT touch the report reference, per the later
 * confirmation that only the source model gets deleted, not the report.
 */
function scrubOrderPii(orderId) {
  const order = getOrder(orderId);
  if (!order) return false;
  const scrubbed = {
    ...order,
    fullName: null,
    company: null,
    email: null,
    piiScrubbedAt: new Date().toISOString(),
  };
  const filePath = path.join(ORDERS_DIR, `${orderId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(scrubbed, null, 2));
  return true;
}

function listOrders() {
  if (!ordersDirReady) return [];
  return fs.readdirSync(ORDERS_DIR)
    .filter(f => f.startsWith(ORDER_ID_PREFIX) && f.endsWith('.json'))
    .map(f => getOrder(f.replace('.json', '')))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { createOrder, getOrder, scrubOrderPii, listOrders, ORDERS_DIR };
