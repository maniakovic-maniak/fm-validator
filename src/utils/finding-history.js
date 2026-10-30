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

// FIX: found via a real production run — "Since last run" was keyed on
// the exact, literal filename, so "Financial_Model_The_Bend_12_7_2026.xlsx"
// and "Financial_Model_The_Bend_13_7_2026_Audited.xlsx" (genuinely the
// same underlying model, one day and one audit pass apart) were tracked
// as two completely unrelated models, always showing "First run for
// this model" no matter how many real prior runs existed. Filenames
// change between revisions in normal use — a new date, an "_Audited"
// or "_v2" suffix — so exact matching was never going to hold up.
//
// Strips date-shaped number sequences and a deliberately narrow list of
// common revision/status words, then lowercases and collapses
// whitespace/separators, to get a stable identity that survives routine
// re-naming across revisions of the same file.
//
// Deliberately conservative on the strip list — every entry is a word
// that describes a REVISION STATE (audited, draft, final, validated,
// a version number, a parenthesized copy-number), not a word that could
// be part of a genuinely distinguishing model name. This is a real,
// inherent tradeoff: two DIFFERENT models that happen to share a
// stripped-down base name (e.g. two unrelated "Project A" files from
// different clients) would be incorrectly treated as the same model.
// There is no way to eliminate this risk with filename heuristics alone
// — only content-based or explicitly-provided identity could — but the
// strip list here is narrow enough that this is an edge case, not the
// common case, and it's a better tradeoff than the previous behavior,
// which failed on the ordinary case of a model simply being re-dated.
const DATE_PATTERN_RE = /\b\d{1,4} \d{1,2} \d{1,4}\b/g; // e.g. 12 7 2026, 2026 07 13 (after separators are normalized to spaces below)
const REVISION_WORD_RE = /\b(audited|validated|draft|final|reviewed|approved|updated|revised|checked|copy|backup|old|new|latest|fixed|corrected|amended)\b/gi;
const PAREN_VERSION_RE = /\(\d+\)/g; // (1), (2) -- needs literal parens, checked before separator normalization
const V_VERSION_RE = /\bv\d+\b/gi; // v1, v2 -- needs a real \b, checked after separator normalization
// FIX: found via a real cross-run tracking failure — "Investor Ready
// 12" was treated as a permanently distinct model from "Investor
// Ready v6", since V_VERSION_RE only matches "v" literally followed
// by digits; a bare number with no "v" prefix survived untouched.
// Confirmed directly: normalizeModelIdentity() returned two different
// strings for what is genuinely the same model at two different
// revisions. Deliberately narrower than stripping any trailing
// number: only strips a number directly preceded by a recognized
// stage/version word, keeping the word itself so "Ready 12" and
// "Ready v6" (which already loses its "v6" to V_VERSION_RE above)
// both converge to the same "...ready" identity. A blind trailing-
// number strip would risk collapsing genuinely different models —
// "Building 12" and "Building 13" — into one identity; requiring a
// stage word immediately before the number avoids that.
const STAGE_NUMBER_RE = /\b(ready|version|ver|rev|revision|release|draft|build)\s+\d+\b/gi;

// Patch 15: the upload pipeline appends the upload time in epoch
// milliseconds (12-13 digits) to the stored file name, e.g.
// "...ESO_Licence_Model-1792921491941.xlsm". Left in, every upload of
// the same model looked like a new model, so "since last run" always
// said first run. A 12-13 digit run cannot be a version or a date.
const EPOCH_SUFFIX_RE = /\b\d{12,13}\b/g;

function normalizeModelIdentity(filename) {
  let s = String(filename || '');
  s = s.replace(/\.(xlsx|xlsm|xls|csv)$/i, ''); // drop the file extension first, so it never survives into the identity
  // Paren-form version suffix must be checked BEFORE parens are
  // stripped as plain separators below, since it needs the literal
  // "(1)"/"(2)" shape.
  s = s.replace(PAREN_VERSION_RE, ' ');
  // FIX: found via testing — \b word-boundaries don't behave as
  // expected immediately adjacent to an underscore, since underscore
  // counts as a "word character" in regex (same class as letters and
  // digits), so "_12_7_2026", "_Audited", and "_v2" never actually
  // matched their \b-anchored patterns at all. Separators are
  // normalized to real spaces FIRST, so the boundary-based regexes
  // below then match against genuine word boundaries.
  s = s.replace(/[_\-.()]+/g, ' ');
  s = s.replace(EPOCH_SUFFIX_RE, ' ');
  s = s.replace(DATE_PATTERN_RE, ' ');
  s = s.replace(V_VERSION_RE, ' ');
  s = s.replace(STAGE_NUMBER_RE, '$1');
  s = s.replace(REVISION_WORD_RE, ' ');
  s = s.toLowerCase();
  s = s.replace(/\s+/g, ' ').trim();
  return s || String(filename || '').toLowerCase(); // never return an empty identity — fall back to the raw (lowercased) filename if normalization strips everything
}

function historyFilePath(modelKey) {
  const safe = String(modelKey).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(HISTORY_DIR, `${safe}.json`);
}

function loadHistory(modelKey) {
  const p = historyFilePath(modelKey);
  if (!fs.existsSync(p)) return {};
  try {
    return readRecord(modelKey).entries;
  } catch (e) {
    console.error('   \u26a0\ufe0f  Finding-history read failed, starting fresh for this model:', e.message);
    return {};
  }
}

function saveHistory(modelKey, history) {
  try {
    const rec = fs.existsSync(historyFilePath(modelKey)) ? readRecord(modelKey) : { meta: {} };
    writeRecord(modelKey, { version: 2, meta: rec.meta || {}, entries: history });
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


// ── Status vocabulary (Patch 39) ─────────────────────────────────────────────────────────────────────────────────
// open                       found in the latest run
// not_observed               found before, not found in the latest run. NOT a resolution: a Tier 2 reviewer does not
//                            raise the same item every run, a check may not have run, and an unchanged formula can be
//                            fixed upstream. Old files stored this as "closed"; it is read as not_observed.
// verified_resolved          reserved: set only by markVerification() with evidence from a retest of the original
//                            defect condition and the outputs it touched. Nothing sets it automatically.
// disproven                  reserved: the concern was investigated and shown not to be a defect (with evidence).
// verification_unavailable   reserved: a retest was tried and could not be completed (with the reason).
const STATUS = Object.freeze({ OPEN: 'open', NOT_OBSERVED: 'not_observed', VERIFIED: 'verified_resolved', DISPROVEN: 'disproven', UNAVAILABLE: 'verification_unavailable' });
function normaliseStatus(st) { return st === 'closed' ? STATUS.NOT_OBSERVED : (st || STATUS.OPEN); }
function normaliseEntries(entries) {
  const out = {};
  for (const [fp, e] of Object.entries(entries || {})) {
    if (!e || typeof e !== 'object') continue;
    out[fp] = e.status === 'closed' ? { ...e, status: STATUS.NOT_OBSERVED, legacyClosed: true } : e;     // never promoted to verified
  }
  return out;
}

/** Record a retest result. Needs evidence; refuses anything but the three reserved statuses. Nothing calls this yet. */
function markVerification(entries, fingerprint, { status, evidence } = {}) {
  if (![STATUS.VERIFIED, STATUS.DISPROVEN, STATUS.UNAVAILABLE].includes(status)) throw new Error(`status must be one of ${STATUS.VERIFIED}, ${STATUS.DISPROVEN}, ${STATUS.UNAVAILABLE}`);
  if (!evidence || typeof evidence !== 'object' || !evidence.method || !evidence.detail || !evidence.checkedAt) throw new Error('verification needs evidence with method, detail and checkedAt');
  if (!entries[fingerprint]) throw new Error('unknown fingerprint');
  return { ...entries, [fingerprint]: { ...entries[fingerprint], status, verification: { status, ...evidence } } };
}

// ── The store (Patch 39) ─────────────────────────────────────────────────────────────────────────────────────────
// File v2: { version: 2, meta: { lastRun: { runId, startedAt, recordedAt, priorEntries }, recentRunIds: [] }, entries }
// A v1 file is the entries map itself. It is read as v2 with no meta.
//
// Rules, all enforced by recordRun():
//  * one run id is recorded once. A retry (same order id) REPLACES that run's contribution; it does not advance the
//    baseline a second time, so a failed report build or e-mail that is retried cannot turn "new" into "still open".
//  * a run that started before the recorded baseline and finishes later never overwrites it.
//  * read-modify-write is under a lock file, so two workers on one model cannot lose each other's update.
//  * the file is replaced atomically (temp file, then rename).
const LOCK_WAIT_MS = Number(process.env.FM_HISTORY_LOCK_WAIT_MS) || 5000, LOCK_STALE_MS = 60000, MAX_PRIOR_BYTES = 3 * 1024 * 1024;

function readRecord(modelKey) {
  const p = historyFilePath(modelKey);
  if (!fs.existsSync(p)) return { version: 2, meta: {}, entries: {} };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error('   ⚠️  Finding-history read failed, starting fresh for this model:', e.message); return { version: 2, meta: {}, entries: {}, unreadable: true }; }
  if (raw && raw.version === 2 && raw.entries) return { version: 2, meta: raw.meta || {}, entries: normaliseEntries(raw.entries) };
  return { version: 2, meta: {}, entries: normaliseEntries(raw) };
}

function writeRecord(modelKey, record) {
  const p = historyFilePath(modelKey);
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, p);
}

function sleepMs(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) { const end = Date.now() + ms; while (Date.now() < end) { /* wait */ } } }

function withLock(modelKey, fn) {
  const lock = historyFilePath(modelKey) + '.lock';
  const start = Date.now();
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lock, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') return { locked: false, error: e.message };
      try { if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) { fs.unlinkSync(lock); continue; } } catch (_) { continue; }
      if (Date.now() - start > LOCK_WAIT_MS) return { locked: false, error: 'history is being updated by another run' };
      sleepMs(50);
    }
  }
  try { return { locked: true, value: fn() }; }
  finally { try { fs.closeSync(fd); } catch (_) {} try { fs.unlinkSync(lock); } catch (_) {} }
}

/**
 * Compare this run with the stored baseline and, when it is the newest run of this model, advance the baseline.
 * @param run { runId, startedAt }  startedAt is when this analysis began (ISO string)
 * @returns stats as computeCrossRunStats, plus { baseline: 'advanced'|'replaced_retry'|'not_advanced_older'|'not_saved_busy'|'not_saved_error', recordNote }
 */
function recordRun(modelKey, findings, run = {}) {
  const runId = run.runId ? String(run.runId) : null;
  const startedAt = run.startedAt || new Date().toISOString();
  const attempt = withLock(modelKey, () => {
    const rec = readRecord(modelKey);
    const last = (rec.meta && rec.meta.lastRun) || null;
    const recent = (rec.meta && rec.meta.recentRunIds) || [];
    const commit = (entriesBefore, stats) => {
      const prior = JSON.stringify(entriesBefore).length <= MAX_PRIOR_BYTES ? entriesBefore : null;
      writeRecord(modelKey, { version: 2, meta: { lastRun: { runId, startedAt, recordedAt: new Date().toISOString(), priorEntries: prior }, recentRunIds: [...recent.filter(x => x !== runId), runId].filter(Boolean).slice(-20) }, entries: stats.updatedHistory });
    };
    if (rec.unreadable) { const stats = computeCrossRunStats(findings, {}); commit({}, stats); return Object.assign(stats, { baseline: 'advanced', recordNote: 'The earlier history file could not be read, so this run starts a new baseline.' }); }
    if (runId && last && last.runId === runId) {
      // Retry of the run recorded last: compare with the baseline as it was BEFORE that run, then replace its contribution.
      if (last.priorEntries) {
        const stats = computeCrossRunStats(findings, last.priorEntries);
        commit(last.priorEntries, stats);
        return Object.assign(stats, { baseline: 'replaced_retry', recordNote: 'This run was recorded before (a retry); its earlier entry was replaced, not added to.' });
      }
      const stats = computeCrossRunStats(findings, rec.entries);
      return Object.assign(stats, { baseline: 'not_advanced_retry_no_snapshot', recordNote: 'This run was recorded before (a retry) and the earlier baseline was too large to keep, so the comparison is with the run already recorded; history was not changed.' });
    }
    if (runId && recent.includes(runId)) {
      const stats = computeCrossRunStats(findings, rec.entries);
      return Object.assign(stats, { baseline: 'not_advanced_older', recordNote: 'This run was recorded earlier and a newer run has been recorded since; history was not changed.' });
    }
    if (last && last.startedAt && startedAt < last.startedAt) {
      const stats = computeCrossRunStats(findings, rec.entries);
      return Object.assign(stats, { baseline: 'not_advanced_older', recordNote: 'A newer run of this model was recorded while this one was running, so "since last run" is compared with that newer run and history was not changed.' });
    }
    const stats = computeCrossRunStats(findings, rec.entries);
    commit(rec.entries, stats);
    return Object.assign(stats, { baseline: 'advanced', recordNote: null });
  });
  if (attempt.locked) return attempt.value;
  const stats = computeCrossRunStats(findings, readRecord(modelKey).entries);
  return Object.assign(stats, { baseline: 'not_saved_busy', recordNote: `History was not updated: ${attempt.error}.` });
}

/** Distinct finding count within one of the closed/new/regressed/
 * stillOpen arrays — deduplicates by rootCauseId, since a single
 * grouped finding (e.g. 78 redundant-input cells, or a blank-cell-
 * reference check with hundreds of affected cells) produces one
 * fingerprint PER CELL by design (needed to track a partial fix
 * within a group precisely), not one per finding. A dashboard summary
 * needs "how many distinct issues changed status", not "how many
 * individual cells changed status" — conflating the two is what
 * produced a real, confirmed bug: a report with 165 total findings
 * showing "17609 still open" on its own dashboard. */
function distinctFindingCount(entries) {
  return new Set(entries.map(e => e.rootCauseId)).size;
}

/** Compares this run's findings against the stored history for this
 * model, returning { closed, new, regressed, stillOpen, updatedHistory }.
 * Does NOT save — call saveHistory(modelKey, updatedHistory) separately,
 * after confirming the run completed successfully. */
// FIX: found via a real investigation — a user ran the identical
// model twice with no fixes applied and saw "Since last run: 18
// closed, 19 new". Direct comparison confirmed every single closed
// finding was T2-* (Tier 2/LLM); zero T0/T1 (deterministic, code-
// based) findings changed at all. Tier 2 re-reasons from scratch each
// run and doesn't reliably reproduce the same borderline findings run
// to run — a real, inherent property of LLM-based review, not a bug.
// Blending this into one number misleads a reader into thinking
// genuine progress or regression happened when it may just be
// variance. Splits by whether the finding's own id starts with "T2-"
// (LLM-derived) vs anything else (deterministic Tier 0/Tier 1 code).
function isLlmDerived(rootCauseId) {
  return typeof rootCauseId === 'string' && rootCauseId.startsWith('T2-');
}

function splitDeterministicVsLlm(entries) {
  const deterministic = [];
  const llm = [];
  for (const e of entries) {
    (isLlmDerived(e.rootCauseId) ? llm : deterministic).push(e);
  }
  return { deterministic, llm };
}

function computeCrossRunStats(findings, history) {
  history = normaliseEntries(history);
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
    } else if (priorEntry.status !== 'open') {
      // Anything that was not observed (or, in future, verified resolved) and is now found again has reappeared.
      regressed.push({ fingerprint: fp, ...info, previouslyClosedAt: priorEntry.notObservedAt || priorEntry.closedAt || null, previousStatus: normaliseStatus(priorEntry.status), timesClosed: priorEntry.timesNotObserved || priorEntry.timesClosed || 0 });
      updatedHistory[fp] = { ...priorEntry, status: 'open', ...info, lastSeen: nowIso, reopenedAt: nowIso };
    } else {
      stillOpen.push({ fingerprint: fp, ...info });
      updatedHistory[fp] = { ...priorEntry, status: 'open', ...info, lastSeen: nowIso };
    }
  }

  for (const [fp, priorEntry] of Object.entries(history)) {
    if (priorEntry.status === 'open' && !current.has(fp)) {
      // Not found this run. That is all it means: the model may have been fixed, the reviewer may not have raised it
      // again, or the check may not have run. "closed" in the arrays and counts below is kept as a name for the report
      // fields; the stored status is not_observed and is never read as resolved.
      closed.push({ fingerprint: fp, ...priorEntry });
      updatedHistory[fp] = { ...priorEntry, status: STATUS.NOT_OBSERVED, notObservedAt: nowIso, timesNotObserved: (priorEntry.timesNotObserved || priorEntry.timesClosed || 0) + 1 };
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

  const closedSplit = splitDeterministicVsLlm(closed);
  const newSplit = splitDeterministicVsLlm(newOnes);
  const regressedSplit = splitDeterministicVsLlm(regressed);

  return {
    closed, new: newOnes, regressed, stillOpen, updatedHistory, isFirstRun,
    closedFindingCount: distinctFindingCount(closed),
    newFindingCount: distinctFindingCount(newOnes),
    regressedFindingCount: distinctFindingCount(regressed),
    stillOpenFindingCount: distinctFindingCount(stillOpen),
    // Deterministic (Tier 0/Tier 1, code-based) counts — a reliable
    // signal of genuine progress or regression, since these checks
    // produce the exact same result every time on an unchanged model.
    closedDeterministicCount: distinctFindingCount(closedSplit.deterministic),
    newDeterministicCount: distinctFindingCount(newSplit.deterministic),
    regressedDeterministicCount: distinctFindingCount(regressedSplit.deterministic),
    // LLM (Tier 2) counts — can shift run to run even on an unchanged
    // model, since Tier 2 re-reasons from scratch each time. Reported
    // separately so this variance is never mistaken for genuine
    // progress or regression.
    closedLlmCount: distinctFindingCount(closedSplit.llm),
    newLlmCount: distinctFindingCount(newSplit.llm),
    regressedLlmCount: distinctFindingCount(regressedSplit.llm),
  };
}

module.exports = { loadHistory, saveHistory, readRecord, recordRun, markVerification, STATUS, normaliseStatus, currentFingerprints, computeCrossRunStats, historyFilePath, normalizeModelIdentity };
