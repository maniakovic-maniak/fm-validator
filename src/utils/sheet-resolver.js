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
  // FIX: found via a real bug-scan run. Blank/whitespace-only names
  // must never match ANYTHING, including each other — the previous
  // sentinel string '__BLANK__' was itself a matchable value, so two
  // different blank/whitespace-only names (or a whitespace-only target
  // against an actually-blank sheet name) would incorrectly resolve as
  // equal at Level 3/4. Returns null instead; every comparison site
  // below explicitly guards against a null result on either side.
  if (typeof name === 'string' && name.trim() === '') return null;
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
  const normalized = normTarget !== null
    ? sheetNames.find(n => { const nn = normalize(n); return nn !== null && nn === normTarget; })
    : undefined;
  if (normalized) return normalized;

  // Level 4 — starts-with or contains (normalized)
  const startsWith = normTarget !== null
    ? sheetNames.find(n => {
        const nn = normalize(n);
        return nn !== null && (nn.startsWith(normTarget) || normTarget.startsWith(nn));
      })
    : undefined;
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
