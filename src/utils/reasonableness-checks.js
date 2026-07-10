// Assumptions and Commercial Reasonableness — Wave 1.
//
// Everything else built this session answers "is the model wired
// correctly?" (formula integrity, linkage integrity). These checks
// answer a genuinely different question: "are the results commercially
// believable?" A model can pass every wiring check and still tell an
// investment committee a single-venue asset will produce a 53% EBITDA
// margin — these checks exist to surface that, honestly and with
// disclosed limits, not to pretend to be a certified external benchmark.
//
// Every threshold used here is a documented, disclosed rule-of-thumb
// trigger for review — not a verified market benchmark. The tool has no
// live external data feed and will not pretend otherwise.

const { findLabeledValues } = require('./find-labeled-value');

function pct(v) { return `${(v * 100).toFixed(1)}%`; }
function money(v) { return `$${(v / 1e6).toFixed(1)}M`; }

/**
 * When a label search returns several candidates, the genuinely correct
 * figure is usually the one that appears identically across multiple
 * sheets (dashboards, summaries, decks all redisplaying the same live
 * number) — a differently-shaped match (a ratio or check cell that
 * coincidentally sits near the same label text) is typically a one-off
 * outlier. Prefer the most frequently repeated value; fall back to the
 * first candidate if every value is unique (nothing to vote on).
 */
function pickModalCandidate(candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const counts = new Map();
  for (const c of candidates) {
    const key = c.value.toFixed(6); // tolerate float noise across sheets
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let bestKey = null, bestCount = 0;
  for (const [key, count] of counts) { if (count > bestCount) { bestKey = key; bestCount = count; } }
  return candidates.find(c => c.value.toFixed(6) === bestKey);
}

// ── WACC override detection ─────────────────────────────────────────────
function checkWaccOverride(workbook) {
  const calculated = findLabeledValues(workbook, ['wacc (calculated)', 'calculated wacc']);
  const override = findLabeledValues(workbook, ['wacc (input override)', 'wacc (override)', 'override wacc', 'input override wacc']);
  const applied = findLabeledValues(workbook, ['applied discount rate', 'discount rate applied']);

  if (calculated.length === 0) {
    return { applicable: false, note: 'No cell labelled as a calculated WACC was found — cannot compare against an applied rate.' };
  }

  const calc = pickModalCandidate(calculated);
  const appliedRate = pickModalCandidate(override) || pickModalCandidate(applied);
  if (!appliedRate) {
    return { applicable: true, mismatch: false, calculated: calc,
      note: 'A calculated WACC was found but no separately labelled override/applied rate — nothing to compare against.' };
  }

  const diff = Math.abs(calc.value - appliedRate.value);
  const mismatch = diff > 0.001; // more than 0.1 percentage points apart

  return {
    applicable: true, mismatch,
    calculatedWacc: calc.value, calculatedLocation: `${calc.sheet}!${calc.valueCell}`,
    appliedRate: appliedRate.value, appliedLocation: `${appliedRate.sheet}!${appliedRate.valueCell}`,
    note: mismatch
      ? `Calculated WACC (${pct(calc.value)} at ${calc.sheet}!${calc.valueCell}) differs from the applied discount rate (${pct(appliedRate.value)} at ${appliedRate.sheet}!${appliedRate.valueCell}). This may be a deliberate, documented override — the issue is whether that rationale is visible to the reader, not that 10% is necessarily wrong.`
      : `Calculated WACC and applied discount rate match (${pct(calc.value)}) — no override in effect.`
  };
}

// ── Terminal value concentration ────────────────────────────────────────
function checkTerminalValueConcentration(workbook, threshold = 0.6) {
  // "Terminal value" alone is ambiguous between the raw/undiscounted
  // headline figure and the properly-discounted present value — only the
  // PV figure is a valid comparable against total NPV (both must be
  // stated in present-value terms, or the ratio is meaningless and can
  // exceed 100%, as an early version of this check confirmed by mistake).
  let tv = findLabeledValues(workbook, ['pv of terminal value']);
  if (tv.length === 0) tv = findLabeledValues(workbook, ['terminal value']);
  const npv = findLabeledValues(workbook, ['project npv', 'enterprise value', 'total npv']);

  if (tv.length === 0 || npv.length === 0) {
    return { applicable: false, note: 'Could not locate both a labelled Terminal Value and a labelled total NPV/Enterprise Value to compare.' };
  }

  const tvPick = pickModalCandidate(tv);
  const npvPick = pickModalCandidate(npv);
  if (!npvPick.value) return { applicable: false, note: 'Total NPV value resolved to zero — cannot compute a meaningful ratio.' };

  const concentration = tvPick.value / npvPick.value;
  const flagged = concentration >= threshold;

  return {
    applicable: true, flagged,
    terminalValue: tvPick.value, terminalValueLocation: `${tvPick.sheet}!${tvPick.valueCell}`,
    totalNpv: npvPick.value, totalNpvLocation: `${npvPick.sheet}!${npvPick.valueCell}`,
    concentrationPct: concentration,
    note: flagged
      ? `PV of terminal value (${money(tvPick.value)}) represents ${pct(concentration)} of total project NPV (${money(npvPick.value)}) — above the ${pct(threshold)} disclosed review trigger used here. A high proportion of return depending on an assumed exit, rather than operating performance during the hold period, warrants explicit sensitivity testing.`
      : `PV of terminal value is ${pct(concentration)} of total NPV — below the ${pct(threshold)} review trigger.`
  };
}

// ── Output reasonableness thresholds — disclosed rule-of-thumb triggers,
//    not verified external benchmarks. Each threshold is stated plainly
//    so a reader can judge whether it's the right bar for this asset. ──
const OUTPUT_CHECKS = [
  { terms: ['ebitda margin'], label: 'EBITDA margin', threshold: 0.40, direction: 'above', unit: 'percent',
    rationale: 'a hospitality/venue-style business sustaining above 40% EBITDA margin is unusual and warrants explicit benchmark support' },
  { terms: ['unlevered irr', 'project irr'], label: 'Unlevered IRR', threshold: 0.20, direction: 'above', unit: 'percent',
    rationale: 'an unlevered IRR above 20% for a single-asset venue development is high and warrants challenge on the underlying assumptions driving it' },
  { terms: ['equity irr'], label: 'Equity IRR', threshold: 0.25, direction: 'above', unit: 'percent',
    rationale: 'an equity IRR above 25% warrants explicit review of the leverage and operating assumptions producing it' },
  { terms: ['exit multiple'], label: 'Exit multiple', threshold: 6.0, direction: 'above', unit: 'multiple',
    rationale: 'a single-asset, illiquid entertainment/venue business trading above 6.0x EBITDA at exit needs explicit comparable-transaction support, not just a stated assumption' },
  // "Yield on cost" alone is ambiguous in this model between a stabilised
  // figure and an exit-year figure — prefer the exit-specific label
  // explicitly rather than let a bare match pick whichever is found first.
  { terms: ['yield on cost (exit)', 'yield on cost'], label: 'Yield on cost (exit)', threshold: 0.50, direction: 'above', unit: 'percent',
    rationale: 'yield on cost above 50% at exit is exceptionally high and warrants challenge' },
];

function checkOutputReasonableness(workbook) {
  const results = [];
  for (const check of OUTPUT_CHECKS) {
    // Try each term in order, most specific first — stop at the first
    // term that actually finds something, rather than pooling every
    // term's candidates together and diluting the modal vote.
    let found = [];
    for (const term of check.terms) {
      found = findLabeledValues(workbook, [term]);
      if (found.length > 0) break;
    }
    if (found.length === 0) continue;
    const pick = pickModalCandidate(found);
    const flagged = check.direction === 'above' ? pick.value >= check.threshold : pick.value <= check.threshold;
    results.push({
      metric: check.label, value: pick.value, location: `${pick.sheet}!${pick.valueCell}`,
      threshold: check.threshold, flagged, rationale: check.rationale, unit: check.unit,
      candidateCount: found.length
    });
  }
  return {
    applicable: results.length > 0,
    results,
    flaggedCount: results.filter(r => r.flagged).length,
    note: 'Thresholds here are disclosed, documented rule-of-thumb review triggers, not verified external market benchmarks — the tool has no live comparable-business data feed. A flagged metric is not automatically wrong; it is a specific, named reason to challenge the assumption producing it.'
  };
}

module.exports = { checkWaccOverride, checkTerminalValueConcentration, checkOutputReasonableness };
