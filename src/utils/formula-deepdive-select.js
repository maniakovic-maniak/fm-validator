// Formula Deep Dive — targeted Tier 2 semantic review of the highest-risk
// individual formulas, rather than sampled/pattern-based checking.
//
// Answers "formula text inspection" and "cell-by-cell audit" from the
// Scope and Reliance exclusions the same way: not by reviewing all
// ~15,000+ formula cells (impractical), and not by spreading Tier 2's
// existing sampled batches thinner (diffuse, doesn't target risk), but by
// concentrating individual review exactly where Tier 0's own complexity
// scoring says risk is highest.
//
// OPT-IN by design — this is an additional-cost review beyond the
// standard run, not something that should silently make every run more
// expensive. Callers gate this behind an explicit flag.

const { findNearbyLabel } = require('./cell-label');

const DEFAULT_TOP_N = 40;
const MIN_FSCORE = 4;  // Moderate band or higher — see complexityBand() in validator-tier0.js

/**
 * Select the highest-risk unique formulas for individual deep review.
 * Deterministic, fully testable without any API access.
 *
 * @param {object[]} uniqueFormulas  Tier 0's own ranked formula list
 *   (already deduplicated by normalized pattern via the UFI system).
 * @param {number} topN
 * @param {number} minFscore
 */
function selectHighRiskFormulas(uniqueFormulas, topN = DEFAULT_TOP_N, minFscore = MIN_FSCORE) {
  if (!Array.isArray(uniqueFormulas)) return [];
  return [...uniqueFormulas]
    .filter(uf => (uf.fscore || 0) >= minFscore)
    .sort((a, b) => (b.fscore || 0) - (a.fscore || 0))
    .slice(0, topN);
}

/**
 * Attach the nearby row label to each selected formula, reading directly
 * from the workbook — Tier 0's uniqueFormulas list carries the formula
 * pattern and its risk flags, but not surrounding context, since that
 * wasn't needed for pattern-scoring. Deep review needs it: judging
 * whether logic matches label is the whole point of this check.
 */
function attachLabels(workbook, selectedFormulas) {
  return selectedFormulas.map(uf => {
    let label = '';
    try {
      const ws = workbook.getWorksheet(uf.sheet);
      if (ws) {
        const m = /^([A-Z]+)(\d+)$/.exec(uf.cell || '');
        if (m) {
          const colNum = m[1].split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
          const rowNum = parseInt(m[2], 10);
          const row = ws.getRow(rowNum);
          label = findNearbyLabel(row, colNum).slice(0, 80);
        }
      }
    } catch (_) { /* leave label blank rather than fail the whole selection */ }
    return { ...uf, nearbyLabel: label };
  });
}

/**
 * Build the compact per-formula records actually sent to Claude — only
 * the fields the review task needs, keeping the payload small (this is a
 * genuinely cheap call compared to the main Tier 2 batches; see the
 * token estimate this module also exposes).
 */
function buildReviewItems(labelledFormulas) {
  return labelledFormulas.map(uf => ({
    ufi: uf.ufi,
    sheet: uf.sheet,
    cell: uf.cell,
    fscore: uf.fscore,
    band: uf.band,
    nearbyLabel: uf.nearbyLabel || '(no label found nearby)',
    formulaText: uf.formulaText,
    formulaClass: uf.formulaClass,
    flags: {
      externalLink: !!uf.externalLinkFlag,
      volatile: !!uf.volatileFlag,
      hardcode: !!uf.hardcodeFlag,
      iferror: !!uf.iferrorFlag,
      crossSheetRefs: uf.crossSheetRefs || 0
    }
  }));
}

function estimateInputTokens(reviewItems, staticPromptLength) {
  const payloadChars = JSON.stringify(reviewItems).length;
  return Math.round((payloadChars + staticPromptLength) / 3);
}

module.exports = { selectHighRiskFormulas, attachLabels, buildReviewItems, estimateInputTokens, DEFAULT_TOP_N, MIN_FSCORE };
