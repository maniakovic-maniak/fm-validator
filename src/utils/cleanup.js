const fs   = require('fs');
const path = require('path');
const { logAuditEvent } = require('./audit-log');
const { RUNS_DIR } = require('./run-logger');
const defaultOrders = require('./order-store');
const { createCheckoutStore } = require('./checkout-store');
const { readJson } = require('./file-state');

// Local disk is a working directory only — files should be deleted the
// moment each request finishes (server.js/index.js already do this on the
// happy path). This sweep is the safety net for crashed/interrupted runs.
const LOCAL_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h

// Run logs are debugging artefacts, not sensitive client data in the same
// way uploads/reports are — worth keeping longer to review patterns across
// runs (e.g. spotting a recurring Batch 2 truncation before it's reported).
const RUN_LOG_MAX_AGE_MS = (parseInt(process.env.RUN_LOG_RETENTION_DAYS, 10) || 90) * 24 * 60 * 60 * 1000;

// Built reports live in processed/ on the server and are the retained
// artefact, so they get the longer REPORT_RETENTION_DAYS window rather than
// the 48h working-file window used for uploads.
const REPORT_MAX_AGE_MS = (parseInt(process.env.REPORT_RETENTION_DAYS, 10) || 30) * 24 * 60 * 60 * 1000;

function sweepLocalDir(dirPath, maxAgeMs, protectedNames = new Set()) {
  if (!fs.existsSync(dirPath)) return { checked: 0, deleted: 0 };
  const now = Date.now();
  let checked = 0, deleted = 0;
  for (const name of fs.readdirSync(dirPath)) {
    if (name === '.gitkeep' || protectedNames.has(name)) continue;
    const full = path.join(dirPath, name);
    try {
      const stat = fs.statSync(full);
      checked++;
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(full);
        deleted++;
      }
    } catch (_) { /* file may have been removed concurrently — ignore */ }
  }
  return { checked, deleted };
}

// Payment outcomes take priority over time-based source deletion. A missed webhook
// must be reconciled, never inferred from elapsed wall time.
async function protectPaymentSources({ store, orders = defaultOrders, now = Date.now() }) {
  const protectedNames = new Set();
  const retentionMs = 14 * 86400000;
  for (const entry of store.listIntents()) {
    await store.lockIntent(entry.id, async () => {
      const intent = store.getIntent(entry.id);
      const order = intent.orderId ? orders.getOrder(intent.orderId) : null;
      const keys = intent.status === 'failed' ? ['failure'] : intent.status === 'review_required' ? ['paymentIssue', 'admin'] : ['confirmation', 'admin', 'pending'];
      const noticesSettled = keys.every(k => ['sent', 'manual_review'].includes(intent.notices?.[k]?.status));
      const completed = order && order.status === 'review_complete' && !order.paymentReviewRequired && !order.held;
      const oldComplete = completed && now - new Date(order.reviewCompletedAt || order.createdAt).getTime() > retentionMs && noticesSettled;
      const oldAbandoned = (intent.status === 'expired' || (intent.status === 'failed' && noticesSettled)) && now - (intent.updatedAt || intent.createdAt) > LOCAL_MAX_AGE_MS;
      if (oldComplete || oldAbandoned) {
        if (order && !order.piiScrubbedAt) orders.scrubOrderPii(order.orderId);
        for (const key of ['fullName', 'company', 'email', 'originalName', 'storedAs']) intent[key] = null;
        intent.piiScrubbedAt ||= new Date(now).toISOString(); store.saveIntent(intent);
      } else if (intent.storedAs) protectedNames.add(intent.storedAs);
    });
  }
  // Protect legacy/manual orders too; do not silently delete pending work.
  for (const order of orders.listOrders()) {
    if (order.storedAs && (!order.piiScrubbedAt || order.status !== 'review_complete')) protectedNames.add(order.storedAs);
  }
  const manifestDir = path.join(store.dir, 'uploads');
  for (const name of fs.readdirSync(manifestDir).filter(n => n.endsWith('.json'))) {
    const file = path.join(manifestDir, name); const upload = readJson(file);
    if (upload.expiresAt >= now) protectedNames.add(upload.storedAs);
    else if (!protectedNames.has(upload.storedAs)) fs.unlinkSync(file);
  }
  return protectedNames;
}

/** Run a full retention sweep — call on a schedule (see cron wiring below). */
async function runRetentionSweep({ uploadsDir, processedDir }) {
  const protectedNames = await protectPaymentSources({ store: createCheckoutStore({ uploadsDir }) });
  const uploads   = sweepLocalDir(uploadsDir, LOCAL_MAX_AGE_MS, protectedNames);
  const processed = sweepLocalDir(processedDir, REPORT_MAX_AGE_MS);
  const runLogs   = sweepLocalDir(RUNS_DIR, RUN_LOG_MAX_AGE_MS);
  logAuditEvent({
    event: 'retention_sweep',
    uploadsDeleted:   uploads.deleted,
    processedDeleted: processed.deleted,
    runLogsDeleted:   runLogs.deleted,
    reportRetentionDays: REPORT_MAX_AGE_MS / (24 * 60 * 60 * 1000)
  });

  console.log(`   Retention sweep: uploads ${uploads.deleted}/${uploads.checked} removed, ` +
    `processed ${processed.deleted}/${processed.checked} removed, ` +
    `run logs ${runLogs.deleted}/${runLogs.checked} removed (reports kept ${(REPORT_MAX_AGE_MS/86400000).toFixed(0)}d)`);

  return { uploads, processed, runLogs };
}

module.exports = { runRetentionSweep, sweepLocalDir, protectPaymentSources };
