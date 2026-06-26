// sheet-resolver.js
// Fuzzy sheet name matching — four-level matching strategy.
// Used by validator-tier1.js and report-tab.js.
//
// Returns the matched actual sheet name, or null if no match found.
//
// Matching levels (in order):
//   1. Exact match
//   2. Case-insensitive exact
//   3. Normalized (strip spaces, dashes, underscores, dots)
//   4. Starts-with / contains match (normalized)

function normalize(name) {
  // Blank or whitespace-only sheet names must not match anything
  if (typeof name === 'string' && name.trim() === '') return '__BLANK__';
  return String(name || '')
    .toLowerCase()
    .replace(/[\s\-_\.]+/g, '')
    .trim();
}

function resolveSheetName(target, sheetNames) {
  if (!target || !sheetNames || sheetNames.length === 0) return null;

  // Level 1 — exact match
  const exact = sheetNames.find(n => n === target);
  if (exact) return exact;

  // Level 2 — case-insensitive exact
  const lower = target.toLowerCase();
  const caseInsensitive = sheetNames.find(n => n.toLowerCase() === lower);
  if (caseInsensitive) return caseInsensitive;

  // Level 3 — normalized (strip spaces, dashes, underscores, dots)
  const normTarget = normalize(target);
  const normalized = sheetNames.find(n => normalize(n) === normTarget);
  if (normalized) return normalized;

  // Level 4 — starts-with or contains (normalized)
  const startsWith = sheetNames.find(n =>
    normalize(n).startsWith(normTarget) ||
    normTarget.startsWith(normalize(n))
  );
  if (startsWith) return startsWith;

  // No match
  return null;
}

// Resolve multiple targets at once — returns array of matched names (or null per entry)
function resolveSheetNames(targets, sheetNames) {
  return targets.map(t => resolveSheetName(t, sheetNames));
}

// Check if any of the candidate names matches a sheet in the workbook
// Returns the first match found, or null
function resolveAny(candidates, sheetNames) {
  for (const candidate of candidates) {
    const match = resolveSheetName(candidate, sheetNames);
    if (match) return match;
  }
  return null;
}

module.exports = { resolveSheetName, resolveSheetNames, resolveAny };
