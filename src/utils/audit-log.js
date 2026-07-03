const fs   = require('fs');
const path = require('path');

const LOG_DIR  = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'audit.log');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

/**
 * Append-only, one-JSON-object-per-line audit log — separate from console
 * output, survives process restarts, and is what a client/bank security
 * review would actually ask to see. Rotate at the OS level (logrotate),
 * not in-app — see deployment runbook.
 */
function logAuditEvent(event) {
  const entry = {
    ts: new Date().toISOString(),
    ...event
  };
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Never let logging failure break the request — surface to console instead
    console.error('   \u26a0\ufe0f  Audit log write failed:', err.message);
  }
}

/** Extracts the real client IP, respecting a trusted reverse proxy (Nginx). */
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
}

module.exports = { logAuditEvent, getClientIp, LOG_FILE };
