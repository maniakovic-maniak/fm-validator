const fs = require('fs');
const path = require('path');

const DEMO_REQUESTS_DIR = path.join(__dirname, '..', '..', 'demo-requests');
const DEMO_REQUEST_ID_PREFIX = 'Demo-';
const DEMO_REQUEST_ID_DIGITS = 5;

let dirReady = false;
try {
  if (!fs.existsSync(DEMO_REQUESTS_DIR)) fs.mkdirSync(DEMO_REQUESTS_DIR, { recursive: true });
  dirReady = true;
} catch (err) {
  dirReady = false;
}

/**
 * Same file-based, no-database convention as order-store.js, and the
 * same atomic-claim pattern for ID generation (fs.writeFileSync's 'wx'
 * flag) - kept as its own, separate store rather than folded into
 * orders/, since a demo request was never a paid order and doesn't need
 * most of an order's fields (payment, file upload, pipeline results).
 */
function createDemoRequest(data) {
  if (!dirReady) {
    throw new Error('Demo request storage directory unavailable');
  }

  const existing = fs.readdirSync(DEMO_REQUESTS_DIR).filter(f => f.startsWith(DEMO_REQUEST_ID_PREFIX) && f.endsWith('.json'));
  let highest = 0;
  for (const f of existing) {
    const n = parseInt(f.slice(DEMO_REQUEST_ID_PREFIX.length, -('.json'.length)), 10);
    if (Number.isFinite(n) && n > highest) highest = n;
  }

  let attempt = highest + 1;
  const maxAttempts = 20;
  for (let i = 0; i < maxAttempts; i++, attempt++) {
    const id = DEMO_REQUEST_ID_PREFIX + String(attempt).padStart(DEMO_REQUEST_ID_DIGITS, '0');
    const filePath = path.join(DEMO_REQUESTS_DIR, `${id}.json`);
    try {
      const record = {
        id,
        createdAt: new Date().toISOString(),
        ...data,
      };
      fs.writeFileSync(filePath, JSON.stringify(record, null, 2), { flag: 'wx' });
      return record;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  throw new Error('Could not allocate a demo request ID after multiple attempts');
}

function listDemoRequests() {
  if (!dirReady) return [];
  return fs.readdirSync(DEMO_REQUESTS_DIR)
    .filter(f => f.startsWith(DEMO_REQUEST_ID_PREFIX) && f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(DEMO_REQUESTS_DIR, f), 'utf8'));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { createDemoRequest, listDemoRequests, DEMO_REQUESTS_DIR };
