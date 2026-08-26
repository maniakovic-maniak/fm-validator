const fs = require('fs');
const path = require('path');

const PROGRESS_DIR = path.join(__dirname, '..', '..', 'run-progress');

try {
  if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR, { recursive: true });
} catch (_) {
  // non-fatal — progress tracking is a UX nicety, never something a
  // real validation run should fail over
}

const TOTAL_STAGES = 6;
// Same threshold and reasoning as concurrency-limiter.js's stale-slot
// reclaim - comfortably past the admin's own 30-minute RUN_TIMEOUT_MS,
// so a genuinely still-active run (which keeps refreshing updatedAt at
// every stage transition) is never mistaken for a stuck one.
const STALE_PROGRESS_MS = 40 * 60 * 1000;

/**
 * Genuine, stage-based progress — not a simulated/time-estimated
 * percentage. Reuses the pipeline's own existing [N/6] stage markers
 * (already printed to the console at each of these exact points) as
 * the single source of truth, so this can never drift out of sync with
 * what the pipeline is actually doing.
 *
 * Worth being honest about: stage 5 (Tier 2 semantic review) is by far
 * the longest of the six in real wall-clock time, since it's the
 * multi-batch Claude review. A stage-count percentage will visibly
 * reach ~66% quickly, then sit there for most of the actual wait —
 * genuinely accurate, just not evenly paced.
 */
function setProgress(runId, stage, label) {
  if (!runId) return;
  const safeId = path.basename(String(runId));
  try {
    fs.writeFileSync(
      path.join(PROGRESS_DIR, `${safeId}.json`),
      JSON.stringify({ stage, label, percent: Math.round((stage / TOTAL_STAGES) * 100), updatedAt: new Date().toISOString() })
    );
  } catch (_) {
    // non-fatal, same reasoning as above
  }
}

function getProgress(runId) {
  const safeId = path.basename(String(runId || ''));
  const filePath = path.join(PROGRESS_DIR, `${safeId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const updatedAt = new Date(data.updatedAt).getTime();
    if (Number.isFinite(updatedAt) && (Date.now() - updatedAt) > STALE_PROGRESS_MS) {
      console.log(`   \u26a0\ufe0f  Clearing stale progress for ${safeId} (no update since ${data.updatedAt} - likely a crashed or stuck run, not genuinely still active)`);
      fs.unlink(filePath, () => {});
      return null;
    }
    return data;
  } catch (_) {
    return null;
  }
}

function clearProgress(runId) {
  if (!runId) return;
  const safeId = path.basename(String(runId));
  fs.unlink(path.join(PROGRESS_DIR, `${safeId}.json`), () => {});
}

module.exports = { setProgress, getProgress, clearProgress, TOTAL_STAGES };
