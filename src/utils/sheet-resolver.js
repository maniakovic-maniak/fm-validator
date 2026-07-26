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
//   4. Word-boundary-aware contiguous match (normalized to words, not characters)

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

// FIX: found via a real production run — Level 4 previously matched at
// the CHARACTER level (a plain startsWith on the space-stripped
// string), which destroys word boundaries entirely. "Cons" (still a
// listed Cash Flow alias) silently matched "Construction Timeline",
// "Consolidation", or any other sheet merely character-prefixed by
// those four letters — a real, currently-active instance of exactly
// the false-positive class this project has previously tried to fix
// elsewhere. The same defect was also why a real "Annual Cash Flow"
// sheet failed to match the "Cash Flow" alias in the other direction:
// once spaces are stripped, "annualcashflow" does not character-prefix-
// match "cashflow" at all, even though "Cash Flow" is a genuine,
// meaningful two-word match starting at the sheet name's second word.
// Splits into whole words instead of stripping to one run-on string,
// then checks whether one word-sequence appears as a contiguous run of
// WHOLE words inside the other, in either direction. This is strictly
// safer than the old approach (rejects "Cons" inside "Construction",
// since "cons" is not one of "Construction Timeline"'s whole words —
// "construction" and "timeline" are) while also strictly more capable
// (accepts "Cash Flow" inside "Annual Cash Flow", a whole-word match
// just not located at the very start).
function normalizeToWords(name) {
  if (typeof name === 'string' && name.trim() === '') return null;
  const words = String(name || '')
    .toLowerCase()
    .split(/[\s\-_.]+/)
    .filter(w => w.length > 0);
  return words.length > 0 ? words : null;
}

function isContiguousWordMatch(shorter, longer) {
  if (shorter.length > longer.length) return false;
  for (let i = 0; i <= longer.length - shorter.length; i++) {
    let matched = true;
    for (let j = 0; j < shorter.length; j++) {
      if (longer[i + j] !== shorter[j]) { matched = false; break; }
    }
    if (matched) return true;
  }
  return false;
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

  // Level 4 — word-boundary-aware contiguous match (see FIX note above)
  const targetWords = normalizeToWords(target);
  const wordMatch = targetWords !== null
    ? sheetNames.find(n => {
        const nWords = normalizeToWords(n);
        if (nWords === null) return false;
        return isContiguousWordMatch(targetWords, nWords) || isContiguousWordMatch(nWords, targetWords);
      })
    : undefined;
  if (wordMatch) return wordMatch;

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
