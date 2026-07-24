// finding-history.js — P1/P2/P3 framework renewal, Tier 2 item 2.
//
// The gap this closes: the report only ever showed Open P1/P2/P3 counts.
// A client who fixes issues and re-runs the pipeline had no way to
// confirm what was actually resolved versus what simply wasn't flagged
// this time for an unrelated reason — a plain count comparison (18 -> 12)
// can't distinguish "6 fixed, 0 new" from "10 fixed, 4 new".
//
// GRANULARITY, deliberate: fingerprints are built at the INDIVIDUAL
// AFFECTED-CELL level, not the whole-check level — "T0-DAISYCHAIN-001"
// fixing 6 of its 18 cells while 12 remain open is a real, different
// situation from fixing all 18, and cell-level fingerprinting is the
// only way to tell them apart. This depends directly on Tier 2 item 1's
// structured affected_cells — before that existed, there was nothing
// reliable to fingerprint at all.
//
// PERSISTENCE: a small JSON file per model, stored locally alongside the
// existing audit.log convention (same LOG_DIR pattern already
// established in audit-log.js) — no new database, no Drive round-trip
// needed to read the previous run's OWN history (only the CURRENT run's
// findings are needed to update it).
//
// REGRESSED is tracked as genuinely distinct from "still open": a
// fingerprint that was marked closed in some PAST run and reappears now
// is flagged as a regression — a materially different, more concerning
// signal than an item that was simply never fixed in the first place.

const fs = require('fs');
const path = require('path');

const HISTORY_DIR = path.join(__dirname, '..', '..', 'logs', 'finding-history');
if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

function historyFilePath(modelKey) {
  const safe = String(modelKey).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(HISTORY_DIR, `${safe}.json`);
}

function loadHistory(modelKey) {
  const p = historyFilePath(modelKey);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error('   \u26a0\ufe0f  Finding-history read failed, starting fresh for this model:', e.message);
    return {};
  }
}

function saveHistory(modelKey, history) {
  try {
    fs.writeFileSync(historyFilePath(modelKey), JSON.stringify(history, null, 2));
  } catch (e) {
    console.error('   \u26a0\ufe0f  Finding-history write failed (cross-run stats for this run are still valid, just won\'t persist for next time):', e.message);
  }
}

/** Builds this run's fingerprints from the assembled findings array.
 * Fingerprint = "{root_cause_id}::{affected_cell}" for cell-level
 * granularity; falls back to the bare root_cause_id (or id) alone for a
 * check with no affected_cells at all (a genuinely check-level finding,
 * not one with individual cell instances to distinguish). */
function currentFingerprints(findings) {
  const fingerprints = new Map();
  for (const f of findings) {
    const rootCauseId = f.root_cause_id || f.id;
    if (!rootCauseId) continue;
    const cells = Array.isArray(f.affected_cells) && f.affected_cells.length > 0 ? f.affected_cells : [null];
    for (const cell of cells) {
      const fp = cell ? `${rootCauseId}::${cell}` : rootCauseId;
      // Later cells with the same fingerprint simply overwrite with the
      // same info — a genuine duplicate within one run's own findings
      // would be unusual, but this keeps the map well-defined either way.
      fingerprints.set(fp, {
        rootCauseId, cell,
        label: f.label || f.reason || rootCauseId,
        priority: f.priority || null,
        recordType: f.record_type || null,
      });
    }
  }
  return fingerprints;
}

/** Compares this run's findings against the stored history for this
 * model, returning { closed, new, regressed, stillOpen, updatedHistory }.
 * Does NOT save — call saveHistory(modelKey, updatedHistory) separately,
 * after confirming the run completed successfully. */
function computeCrossRunStats(findings, history) {
  const current = currentFingerprints(findings);
  const nowIso = new Date().toISOString();

  const closed = [];
  const newOnes = [];
  const regressed = [];
  const stillOpen = [];
  const updatedHistory = { ...history };

  for (const [fp, info] of current.entries()) {
    const priorEntry = history[fp];
    if (!priorEntry) {
      newOnes.push({ fingerprint: fp, ...info });
      updatedHistory[fp] = { status: 'open', ...info, firstSeen: nowIso, lastSeen: nowIso, timesClosed: 0 };
    } else if (priorEntry.status === 'closed') {
      regressed.push({ fingerprint: fp, ...info, previouslyClosedAt: priorEntry.closedAt || null, timesClosed: priorEntry.timesClosed || 0 });
      updatedHistory[fp] = { ...priorEntry, status: 'open', ...info, lastSeen: nowIso, reopenedAt: nowIso };
    } else {
      stillOpen.push({ fingerprint: fp, ...info });
      updatedHistory[fp] = { ...priorEntry, status: 'open', ...info, lastSeen: nowIso };
    }
  }

  for (const [fp, priorEntry] of Object.entries(history)) {
    if (priorEntry.status === 'open' && !current.has(fp)) {
      closed.push({ fingerprint: fp, ...priorEntry });
      updatedHistory[fp] = { ...priorEntry, status: 'closed', closedAt: nowIso, timesClosed: (priorEntry.timesClosed || 0) + 1 };
    }
  }

  // FIX: found via a real bug-scan run. The caller previously inferred
  // "is this a first run" from the current run's own finding counts
  // (new > 0, everything else 0) — but a genuine first run on a
  // perfectly clean model has ZERO findings of every kind, which looks
  // identical to a later run where everything happened to get fixed.
  // Derived directly from whether any prior history existed at all,
  // which is the actual, unambiguous signal.
  const isFirstRun = Object.keys(history).length === 0;

  return { closed, new: newOnes, regressed, stillOpen, updatedHistory, isFirstRun };
}

module.exports = { loadHistory, saveHistory, currentFingerprints, computeCrossRunStats, historyFilePath };
