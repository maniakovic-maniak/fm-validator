const fs   = require('fs');
const path = require('path');

const LOCKS_DIR = path.join(__dirname, '..', '..', 'logs', 'active-runs');
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_VALIDATIONS, 10) || 4;
const POLL_INTERVAL_MS = 2000;
// Stale-lock safety: if a process is killed mid-run (crash, OOM, deploy
// restart) without reaching its release(), the slot file would otherwise
// sit forever and permanently shrink capacity. Any slot older than this
// is treated as abandoned and reclaimed — set well above the longest
// real run seen in production (Bend lender model, ~1136s) with genuine
// margin, not just barely above it.
const STALE_SLOT_MS = 60 * 60 * 1000; // 1 hour

let locksDirReady = false;
try {
  if (!fs.existsSync(LOCKS_DIR)) fs.mkdirSync(LOCKS_DIR, { recursive: true });
  locksDirReady = true;
} catch (err) {
  locksDirReady = false;
}

/**
 * Cross-process concurrency limiter for validation runs.
 *
 * WHY THIS EXISTS: fm-validator runs as MAX_CONCURRENT separate PM2
 * cluster processes, each with its own isolated memory — an in-process
 * counter or queue would only ever see requests handled by that one
 * worker, not the true count across all workers combined. This uses
 * fs.writeFileSync's 'wx' flag (write, fail if the file already
 * exists) — an atomic OS-level syscall property, not something built
 * in userspace — so that even with N separate processes racing to
 * claim the same numbered slot simultaneously, only one can ever
 * succeed. That's what makes this genuinely correct across processes,
 * not just "probably fine in practice."
 *
 * Gates the ENTIRE validation pipeline (upload through completion) as
 * one slot per run, matching how the request was actually framed —
 * "more than 4 runners at once" — and aligning naturally with the 4
 * PM2 cluster workers already in place, rather than trying to gate
 * only the Anthropic-API-calling portion specifically.
 */
async function acquireSlot(runLabel) {
  reclaimStaleSlots();

  const startWait = Date.now();
  let loggedWaiting = false;

  while (true) {
    for (let i = 0; i < MAX_CONCURRENT; i++) {
      const slotPath = path.join(LOCKS_DIR, `slot-${i}.json`);
      try {
        fs.writeFileSync(
          slotPath,
          JSON.stringify({ label: runLabel, claimedAt: new Date().toISOString(), pid: process.pid }),
          { flag: 'wx' }
        );
        if (loggedWaiting) {
          console.log(`   \u2713 Slot ${i} acquired after waiting ${((Date.now() - startWait) / 1000).toFixed(1)}s`);
        }
        let released = false;
        return {
          release: () => {
            if (released) return; // idempotent — safe to call more than once
            released = true;
            try { fs.unlinkSync(slotPath); } catch (_) {}
          },
        };
      } catch (err) {
        if (err.code !== 'EEXIST') {
          // A genuine filesystem error (permissions, disk full) — not
          // "slot taken". Surface it rather than looping forever on
          // something that will never resolve on its own.
          throw err;
        }
        // slot taken by another process — try the next slot number
      }
    }
    if (!loggedWaiting) {
      loggedWaiting = true;
      console.log(`   \u23f3 All ${MAX_CONCURRENT} validation slots in use — queued, waiting for one to free up...`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function reclaimStaleSlots() {
  if (!locksDirReady) return;
  let files;
  try {
    files = fs.readdirSync(LOCKS_DIR);
  } catch (_) {
    return;
  }
  const now = Date.now();
  for (const file of files) {
    const slotPath = path.join(LOCKS_DIR, file);
    try {
      const data = JSON.parse(fs.readFileSync(slotPath, 'utf8'));
      const claimedAt = new Date(data.claimedAt).getTime();
      if (Number.isFinite(claimedAt) && (now - claimedAt) > STALE_SLOT_MS) {
        console.log(`   \u26a0\ufe0f  Reclaiming stale validation slot (held since ${data.claimedAt}, pid ${data.pid} likely crashed or was restarted without releasing it)`);
        fs.unlinkSync(slotPath);
      }
    } catch (_) {
      // Malformed or mid-write slot file — leave it alone rather than
      // risk deleting a genuinely active lock based on a parse error.
    }
  }
}

module.exports = { acquireSlot, MAX_CONCURRENT };
