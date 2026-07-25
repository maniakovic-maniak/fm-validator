// Assumptions and Commercial Reasonableness — Wave 1.
//
// Everything else built this session answers "is the model wired
// correctly?" (formula integrity, linkage integrity). These checks
// answer a genuinely different question: "are the results commercially
// believable?" A model can pass every wiring check and still tell an
// investment committee an implausible margin, IRR, or exit multiple is
// achievable — these checks exist to surface that, honestly and with
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
    rationale: 'sustaining an EBITDA margin above 40% is high relative to typical operating businesses and warrants explicit benchmark support against comparable operations' },
  { terms: ['unlevered irr', 'project irr'], label: 'Unlevered IRR', threshold: 0.20, direction: 'above', unit: 'percent',
    rationale: 'an unlevered IRR above 20% is high and warrants challenge on the underlying assumptions driving it — growth, margin, and exit timing in particular' },
  { terms: ['equity irr'], label: 'Equity IRR', threshold: 0.25, direction: 'above', unit: 'percent',
    rationale: 'an equity IRR above 25% warrants explicit review of the leverage and operating assumptions producing it' },
  { terms: ['exit multiple'], label: 'Exit multiple', threshold: 6.0, direction: 'above', unit: 'multiple',
    rationale: 'an exit multiple above 6.0x EBITDA needs explicit comparable-transaction support, not just a stated assumption — a single-asset or illiquid position deserves particular scrutiny here' },
  // "Yield on cost" alone is ambiguous in this model between a stabilised
  // figure and an exit-year figure — prefer the exit-specific label
  // explicitly rather than let a bare match pick whichever is found first.
  { terms: ['yield on cost (exit)', 'yield on cost'], label: 'Yield on cost (exit)', threshold: 0.50, direction: 'above', unit: 'percent',
    rationale: 'yield on cost above 50% at exit is exceptionally high and warrants challenge' },
  // Added from ICAEW's "How to Review a Spreadsheet" (D6) analytical-
  // review ratio examples. Same disclosed rule-of-thumb discipline as
  // every other entry here — these thresholds vary enormously by
  // industry (a project-finance or mining model's working-capital norms
  // are not a retailer's), so the rationale text says so explicitly
  // rather than implying a universal benchmark.
  { terms: ['receivable days', 'days sales outstanding', 'debtor days'], label: 'Receivable days', threshold: 90, direction: 'above', unit: 'days',
    rationale: 'receivable days above 90 is high for most businesses, though working-capital norms vary substantially by industry — confirm this is consistent with the actual payment terms modelled, not just a rule-of-thumb comparison' },
  { terms: ['depreciation to gross asset value', 'depreciation / gross assets', 'depreciation rate'], label: 'Depreciation to gross asset value', threshold: 0.20, direction: 'above', unit: 'percent',
    rationale: 'an annual depreciation rate above 20% of gross asset value implies a useful life under 5 years, which is short for most fixed-asset categories — confirm this matches the actual asset mix and depreciation policy' },
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
    // FIX (found via real testing against Carlsberg): a percentage
    // figure can legitimately be stored as either a fraction (0.26) or
    // a whole number (26) — confirmed directly on a real file
    // ("Depreciation Rate" on a Graphs sheet, storing 26, almost
    // certainly meaning 26% as a chart-axis source value, not 2600%).
    // Scoped specifically to unit === 'percent' so this can never touch
    // a 'multiple' or 'days' check, where a value like 14 (Exit
    // multiple) is genuinely correct and must NOT be divided by 100.
    const normalizedValue = (check.unit === 'percent' && pick.value > 1) ? pick.value / 100 : pick.value;
    const flagged = check.direction === 'above' ? normalizedValue >= check.threshold : normalizedValue <= check.threshold;
    results.push({
      metric: check.label, value: normalizedValue, location: `${pick.sheet}!${pick.valueCell}`,
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

// ── Revenue-per-unit reasonableness metric existence ────────────────────
// Sourced from a 2026-07-25 gap-analysis review of a real prior model
// review: "No detailed bridge from capacity, event nights, attendance,
// ticket price and ancillary spend to revenue... No implied revenue per
// event-night, per patron, or per available capacity unit." Unlike the
// checks above, there is no universal numeric benchmark here — revenue
// per event-night varies enormously by venue type, location, and scale.
// The real gap this check surfaces is EXISTENCE, not a threshold: does
// the model build any per-unit revenue metric that a reviewer could use
// to sanity-check the overall revenue build against comparable evidence
// at all? A model with zero such metric anywhere gives a reviewer
// nothing to benchmark against, regardless of what the "right" number
// would be.
const REVENUE_PER_UNIT_TERMS = [
  'revenue per event', 'revenue per patron', 'revenue per attendee',
  'revenue per seat', 'revenue per capacity', 'revenue per guest',
  'revenue per visitor', 'revenue per customer', 'revenue per member',
  'revenue per unit', 'revenue per tonne', 'revenue per ticket',
  'average ticket value', 'average spend per', 'yield per event',
  'average revenue per',
];

function checkRevenuePerUnitMetric(workbook) {
  for (const term of REVENUE_PER_UNIT_TERMS) {
    const found = findLabeledValues(workbook, [term]);
    if (found.length > 0) {
      const pick = pickModalCandidate(found);
      return {
        applicable: true, found: true,
        metric: term, location: `${pick.sheet}!${pick.valueCell}`,
        note: `A revenue-per-unit reasonableness metric was found ("${term}" at ${pick.sheet}!${pick.valueCell}) — the revenue build has at least one benchmarkable figure a reviewer can sanity-check against comparable evidence.`,
      };
    }
  }
  return {
    applicable: true, found: false,
    note: 'No revenue-per-unit reasonableness metric (e.g. revenue per event-night, per patron, per capacity unit, per tonne) was found anywhere in this workbook. This is not a numeric threshold check — there is no universal benchmark for what such a figure should be, and the tool has no live comparable-business data feed. The gap is that the revenue build appears to have no benchmarkable per-unit figure at all for a reviewer to sanity-check against market or comparable-operator evidence.',
  };
}

// ── Terminal value alternate cross-check existence ───────────────────────
// Sourced from the same 2026-07-25 gap-analysis review: "No cross-check
// of terminal value against yield on cost, replacement cost, revenue
// multiple or implied buyer return." checkTerminalValueConcentration
// above already measures how much of total NPV depends on the exit
// assumption; this check asks a different question — does the model
// corroborate that exit assumption through a SECOND, independent method,
// or does it rest on a single unchallenged multiple? Deliberately an
// existence check, not a numeric comparison — cross-checking a single
// labelled value against another labelled value with no shared
// mechanical relationship between them (e.g. an EBITDA-multiple exit
// vs. an "implied buyer return" percentage) can't be meaningfully
// verified as arithmetically consistent without knowing the specific
// model's own derivation logic, which this tool does not have.
const TV_CROSS_CHECK_TERMS = [
  'implied buyer return', 'implied purchaser return', 'implied yield',
  'exit yield', 'replacement cost', 'revenue multiple',
  'implied cap rate', 'implied capitalisation rate',
];

function checkTerminalValueCrossCheck(workbook) {
  const tv = findLabeledValues(workbook, ['pv of terminal value', 'terminal value']);
  if (tv.length === 0) {
    return { applicable: false, note: 'No labelled Terminal Value was found — nothing to cross-check.' };
  }

  for (const term of TV_CROSS_CHECK_TERMS) {
    const found = findLabeledValues(workbook, [term]);
    if (found.length > 0) {
      const pick = pickModalCandidate(found);
      return {
        applicable: true, found: true,
        metric: term, location: `${pick.sheet}!${pick.valueCell}`,
        note: `Terminal value has at least one independent cross-check present ("${term}" at ${pick.sheet}!${pick.valueCell}), corroborating the exit assumption through a second method rather than resting on a single unchallenged multiple.`,
      };
    }
  }
  return {
    applicable: true, found: false,
    note: 'A labelled Terminal Value was found, but no independent cross-check (implied buyer return, implied yield, replacement cost, or revenue multiple) was found anywhere in this workbook. Terminal value is often the single largest driver of total return — resting it on one unchallenged exit multiple, with no second method corroborating it, is a real gap even where the multiple itself looks reasonable.',
  };
}

module.exports = { checkWaccOverride, checkTerminalValueConcentration, checkOutputReasonableness, checkRevenuePerUnitMetric, checkTerminalValueCrossCheck };
