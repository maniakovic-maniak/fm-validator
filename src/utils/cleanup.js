const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { getAuth } = require('../auth');
const { logAuditEvent } = require('./audit-log');
const { RUNS_DIR } = require('./run-logger');

// Local disk is a working directory only — files should be deleted the
// moment each request finishes (server.js/index.js already do this on the
// happy path). This sweep is the safety net for crashed/interrupted runs.
const LOCAL_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48h

// Run logs are debugging artefacts, not sensitive client data in the same
// way uploads/reports are — worth keeping longer to review patterns across
// runs (e.g. spotting a recurring Batch 2 truncation before it's reported).
const RUN_LOG_MAX_AGE_MS = (parseInt(process.env.RUN_LOG_RETENTION_DAYS, 10) || 90) * 24 * 60 * 60 * 1000;

// Google Drive is the actual permanent, client-facing store — this is
// where a real retention window needs to be enforced. Longer than the
// local working window since this is the delivered report, not a temp file.
const DRIVE_MAX_AGE_MS = (parseInt(process.env.REPORT_RETENTION_DAYS, 10) || 30) * 24 * 60 * 60 * 1000;

function sweepLocalDir(dirPath, maxAgeMs) {
  if (!fs.existsSync(dirPath)) return { checked: 0, deleted: 0 };
  const now = Date.now();
  let checked = 0, deleted = 0;
  for (const name of fs.readdirSync(dirPath)) {
    if (name === '.gitkeep') continue;
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

async function sweepDriveFolder(folderId) {
  if (!folderId) return { checked: 0, deleted: 0 };
  const auth  = await getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const cutoffIso = new Date(Date.now() - DRIVE_MAX_AGE_MS).toISOString();

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false and createdTime < '${cutoffIso}'`,
    fields: 'files(id, name, createdTime)',
    pageSize: 1000
  });

  const files = res.data.files || [];
  for (const f of files) {
    await drive.files.delete({ fileId: f.id });
  }
  return { checked: files.length, deleted: files.length, names: files.map(f => f.name) };
}

/** Run a full retention sweep — call on a schedule (see cron wiring below). */
async function runRetentionSweep({ uploadsDir, processedDir, folderId }) {
  const uploads   = sweepLocalDir(uploadsDir, LOCAL_MAX_AGE_MS);
  const processed = sweepLocalDir(processedDir, LOCAL_MAX_AGE_MS);
  const runLogs   = sweepLocalDir(RUNS_DIR, RUN_LOG_MAX_AGE_MS);
  let drive = { checked: 0, deleted: 0 };
  try {
    drive = await sweepDriveFolder(folderId);
  } catch (err) {
    console.error('   \u26a0\ufe0f  Drive retention sweep failed:', err.message);
  }

  logAuditEvent({
    event: 'retention_sweep',
    uploadsDeleted:   uploads.deleted,
    processedDeleted: processed.deleted,
    runLogsDeleted:   runLogs.deleted,
    driveDeleted:     drive.deleted,
    driveRetentionDays: DRIVE_MAX_AGE_MS / (24 * 60 * 60 * 1000)
  });

  console.log(`   Retention sweep: uploads ${uploads.deleted}/${uploads.checked} removed, ` +
    `processed ${processed.deleted}/${processed.checked} removed, ` +
    `run logs ${runLogs.deleted}/${runLogs.checked} removed, ` +
    `Drive ${drive.deleted}/${drive.checked} removed (>${(DRIVE_MAX_AGE_MS/86400000).toFixed(0)}d old)`);

  return { uploads, processed, runLogs, drive };
}

module.exports = { runRetentionSweep, sweepLocalDir, sweepDriveFolder };
