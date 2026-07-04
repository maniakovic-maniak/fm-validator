const fs   = require('fs');
const path = require('path');

const RUNS_DIR = path.join(__dirname, '..', '..', 'logs', 'runs');
let runsDirReady = false;
try {
  if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
  runsDirReady = true;
} catch (err) {
  // Don't crash app startup over a logging directory — degrade to
  // console-only and let the first startRunLog() call report it.
  runsDirReady = false;
}

/**
 * Captures everything written to stdout/stderr during a pipeline run into
 * its own file — the exact same output you'd see in a terminal, saved for
 * later review. Wraps the underlying write streams rather than console.log
 * itself, so it needs zero changes to any of the many console.log calls
 * scattered across the validator/familiariser/classifier files.
 *
 * KNOWN LIMITATION: this patches the process-wide stdout/stderr streams,
 * so it assumes one pipeline run at a time. Two concurrent uploads would
 * have their output interleaved into both log files. Fine for today's
 * single-operator MVP; needs a per-request context (e.g. AsyncLocalStorage)
 * before this can be trusted under real concurrent multi-client load.
 */
function startRunLog(runLabel) {
  // Capture the real, unpatched write functions FIRST, before anything
  // else touches them — both the patching below and the error handler
  // need this same reference.
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  if (!runsDirReady) {
    origStderrWrite('   \u26a0\ufe0f  Run log directory unavailable — continuing console-only\n');
    return { filename: null, stop: () => {} };
  }

  const safeLabel = String(runLabel || 'run').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 80);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename  = `${timestamp}__${safeLabel}.log`;
  const filepath  = path.join(RUNS_DIR, filename);

  let stream;
  try {
    stream = fs.createWriteStream(filepath, { flags: 'a' });
  } catch (err) {
    origStderrWrite(`   \u26a0\ufe0f  Could not open run log file, continuing console-only: ${err.message}\n`);
    return { filename: null, stop: () => {} };
  }

  // createWriteStream errors (e.g. permission denied, disk full) surface
  // asynchronously via this event, not the try/catch above — without this
  // listener a failure here would silently lose all run output instead of
  // degrading gracefully back to console-only.
  let streamFailed = false;
  stream.on('error', (err) => {
    if (!streamFailed) {
      streamFailed = true;
      origStderrWrite(`   \u26a0\ufe0f  Run log write failed, continuing console-only: ${err.message}\n`);
    }
  });

  process.stdout.write = (chunk, ...args) => {
    if (!streamFailed) { try { stream.write(chunk); } catch (_) {} }
    return origStdoutWrite(chunk, ...args);
  };
  process.stderr.write = (chunk, ...args) => {
    if (!streamFailed) { try { stream.write(chunk); } catch (_) {} }
    return origStderrWrite(chunk, ...args);
  };

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    try { stream.end(); } catch (_) {}
  }

  return { filename, stop };
}

module.exports = { startRunLog, RUNS_DIR };
