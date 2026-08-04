// fixtures-helper.js
//
// Found necessary via a direct conversation about "drop and forget"
// reference-file testing: every check's end-to-end test previously
// hardcoded a fixed list of 5 filenames, so dropping a 6th file into
// a fixtures directory would silently never be tested — not a bug,
// just never built to discover files at all.
//
// This provides dynamic discovery: any .xlsx/.xlsm file placed in
// test-fixtures/ (at the repo root) is automatically picked up by
// every test file using getFixtureFiles() below, with zero code
// changes required per file. A file with no known expected count
// (i.e. one you haven't hand-verified yet) still gets run — it just
// isn't asserted against a specific number, only checked for not
// crashing — so genuinely new files are safe to drop in without
// pre-computing what the "right" answer should be.

const fs = require('fs');
const path = require('path');

const FIXTURE_EXTENSIONS = /\.(xlsx|xlsm)$/i;

// Preferred location: a committed, repo-local fixtures directory.
// Falls back to /mnt/project/ (this development sandbox's mount
// point for the same reference files) so existing tests keep working
// unchanged until the fixtures directory is actually populated on a
// given machine.
function resolveFixturesDir() {
  const repoLocal = path.join(__dirname, 'test-fixtures');
  if (fs.existsSync(repoLocal) && fs.readdirSync(repoLocal).some(f => FIXTURE_EXTENSIONS.test(f))) {
    return repoLocal;
  }
  const sandboxFallback = '/mnt/project';
  if (fs.existsSync(sandboxFallback)) return sandboxFallback;
  return repoLocal; // will simply return zero files below — callers handle this gracefully
}

// Returns every reference file currently available, as
// { path, filename } objects — dynamically discovered, not a fixed
// list. Call this fresh each time (not cached at module load) so a
// file dropped in mid-session during local development is picked up
// without restarting anything.
function getFixtureFiles() {
  const dir = resolveFixturesDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => FIXTURE_EXTENSIONS.test(f))
    .sort()
    .map(f => ({ path: path.join(dir, f), filename: f }));
}

// Looks up a known, hand-verified expected value for a given
// filename from a test's own expectations map (keyed by filename, not
// full path, so it works regardless of which directory the file was
// actually found in). Returns undefined for a filename with no known
// expectation — callers should treat this as "run it, log the result,
// don't assert a specific number" rather than a failure.
function getKnownExpectation(expectations, filename) {
  return expectations[filename];
}

module.exports = { getFixtureFiles, getKnownExpectation, resolveFixturesDir };
