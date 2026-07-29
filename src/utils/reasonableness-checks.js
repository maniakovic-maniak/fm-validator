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

const { findLabeledValues, cellText } = require('./find-labeled-value');

function pct(v) { return `${(v * 100).toFixed(1)}%`; }
// FIX: found via investigating a real flagged report — this
// unconditionally divided by 1e6, assuming the input is always in raw
// dollars. Confirmed directly: a real model's own "A$m" unit label
// shows its terminal-value and NPV figures (255.31, 180.67) are
// already expressed in millions, so dividing by a million again
// produced a misleading "$0.0M" for genuinely material figures. Full
// unit-detection (scanning for a nearby "$m"/"$000s" label) would be a
// larger, separate change; this is a safe, conservative heuristic
// instead — if treating the value as raw dollars would round to a
// near-zero, uninformative display for a value that isn't actually
// zero, it's far more likely already expressed in millions, so show it
// as-is rather than dividing again.
function money(v) {
  if (v !== 0 && Math.abs(v / 1e6) < 0.05) return `$${v.toFixed(1)}M`;
  return `$${(v / 1e6).toFixed(1)}M`;
}

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
  // FIX: found via two separate real instances on the same report —
  // when every candidate has a unique value (no genuine frequency-
  // based mode to find at all), the old code silently fell through to
  // "whichever candidate came first in iteration order", which is
  // arbitrary and not a meaningful selection. Confirmed directly: a
  // real model had a clean, exact "Terminal value" label (255.31)
  // competing against a long, unrelated row-description sentence that
  // merely contains the phrase "terminal value" within a much longer
  // methodology note (-3,185,000) — the long sentence won purely by
  // iteration order, not because it was the right match. When there's
  // no genuine tie to resolve by frequency, prefer the candidate whose
  // own label text is shortest — closer to an exact match of the
  // search term, rather than the term being buried inside a much
  // longer, unrelated sentence.
  if (bestCount === 1) {
    return candidates.reduce((shortest, c) =>
      (c.labelText || '').length < (shortest.labelText || '').length ? c : shortest
    );
  }
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
  // FIX: found via investigating a real flagged report — this used to
  // search ['project npv', 'enterprise value', 'total npv'] all at
  // once and let pickModalCandidate's frequency-based selection sort
  // out which candidate to use. That works well when the same metric
  // is genuinely labelled in multiple places (the intended case), but
  // silently degenerates to "whichever candidate happened to be listed
  // first in the search-terms array" when every candidate has a unique
  // value, since there's no genuine mode to find. Confirmed directly:
  // a real model had both a genuine "Project NPV" label (180.67) and
  // an unrelated "Enterprise value" label (278.50) — "Enterprise
  // value" won purely because it was listed first in the array, not
  // because it was the right match, producing a nonsensical -1,143,634%
  // concentration ratio downstream. Switched to the same sequential-
  // priority pattern the terminal-value search above already uses:
  // try the precise terms first, only fall back to the broader
  // "enterprise value" proxy if nothing precise is found at all.
  let npv = findLabeledValues(workbook, ['project npv', 'total npv']);
  if (npv.length === 0) npv = findLabeledValues(workbook, ['enterprise value']);

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

// ── Model status / readiness flag ────────────────────────────────────────
// Found via investigating a real forensic audit review's "REVIEW
// REQUIRED" claim. Traced why Tier 2 never caught it, despite the
// row-extraction fixes elsewhere in this project: Familiarisation's
// key_sheets selection is prompt-driven, explicitly defined as "sheets
// that appear to contain the core financial logic" — a genuine,
// high-value self-disclosure on a summary/dashboard sheet (not a core
// calculation sheet by that definition) can be missed entirely, since
// the sheet itself is never sent to Tier 2 at all, regardless of what
// survives row-selection within it. A dedicated, deterministic check
// that scans every sheet in the workbook — not just whichever ones
// Tier 2 happens to review — is more reliable here than a prompt
// change, matching this project's established pattern of building a
// Tier 0 check for anything that can be reliably pattern-matched.
// FIX: found via checking this same defect against a newer version of
// the same model. The status wording changed from "REVIEW REQUIRED"
// to a longer, compound phrase — "TECHNICALLY RECONCILED — OWNER
// DECISIONS OUTSTANDING" — at the exact same cell, same formula
// source. The old exact-match logic against a fixed phrase list could
// never catch this, since the full string doesn't equal any single
// listed phrase. Switched matching from exact-equality to substring,
// and added "outstanding" — a status containing this word inherently
// signals something isn't finished regardless of the surrounding
// wording, a more durable signal than trying to enumerate every
// possible caveat phrase a model author might choose to use.
const CONCERNING_STATUS_TERMS = [
  'review required', 'not ready', 'draft', 'incomplete', 'pending review',
  'tbc', 'to be confirmed', 'not for reliance', 'work in progress', 'wip',
  'do not rely', 'not final', 'unconfirmed', 'outstanding',
];
const STATUS_LABEL_RE = /\bstatus\b/i;

function checkModelStatusFlag(workbook) {
  const found = [];
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const label = cellText(cell.value);
        if (!label || !STATUS_LABEL_RE.test(label)) return;
        // Look rightward a short distance for the actual status value —
        // same "label, then nearby value" shape as findLabeledValues,
        // but searching for a concerning TEXT value, not a number.
        for (let c = colNum + 1; c <= colNum + 4; c++) {
          const valCell = row.getCell(c);
          const raw = valCell.formula ? valCell.result : valCell.value;
          const valText = cellText(raw);
          if (!valText) continue;
          const matched = CONCERNING_STATUS_TERMS.find(t => valText.toLowerCase().includes(t));
          if (matched) {
            found.push({ sheet: ws.name, labelCell: cell.address, valueCell: valCell.address, label: label.slice(0, 60), value: valText });
          }
          break; // first non-empty cell right of the label — that's the status value, whatever it says
        }
      });
    });
  });

  if (found.length === 0) {
    return { applicable: true, found: false,
      note: 'No explicit model-status or readiness flag (e.g. a cell labelled "status" reading "review required", "draft", "not for reliance", or similar) was found anywhere in this workbook.' };
  }
  return { applicable: true, found: true, flags: found,
    note: `This model contains its own explicit status/readiness flag: ${found.map(f => `${f.sheet}!${f.valueCell} ("${f.label}" = "${f.value}")`).join('; ')} — the model itself discloses it is not yet in a final, reliance-ready state.` };
}

// ── NPV sign consistency across calculation methods ──────────────────────
// Found via investigating why a confirmed, real defect (Project NPV
// +$510m vs Project XNPV -$263m — opposite signs for what should be
// the same underlying project value) still wasn't caught by Tier 2,
// even after fixing every row-extraction gap on the sheet it lives
// on. Traced to the same architectural cause as the model-status-flag
// gap above: the sheet (VALUATIONS) simply isn't consistently
// selected as a key sheet by Familiarisation, so no row-level fix
// within it can help reliably. A dedicated, deterministic check that
// scans every sheet directly — independent of Tier 2's sheet
// selection — is the more reliable fix here, matching the same
// reasoning as checkModelStatusFlag.
//
// Groups every "NPV"/"XNPV"-labelled value by its base label (the
// label with "NPV"/"XNPV" itself stripped out — e.g. "Project NPV"
// and "Project XNPV" both reduce to "project"), then flags a group
// where one value is positive and another is negative. Verified this
// grouping is safe across three other real files before building:
// unrelated NPV-adjacent labels ("Years for NPV", "Option NPV") have
// distinct base names and are never compared against each other, and
// a genuinely different metric being negative (e.g. "Option NPV")
// isn't flagged, since nothing else shares its base name to compare against.
const NPV_STRIP_RE = /\b(x?npv)\b/gi;

function checkNpvSignConsistency(workbook) {
  const candidates = findLabeledValues(workbook, ['npv']);
  const groups = new Map();
  for (const c of candidates) {
    const base = c.labelText.replace(NPV_STRIP_RE, '').replace(/[@().]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!base) continue; // a bare "NPV" label with nothing else has no group to compare within
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(c);
  }

  const flagged = [];
  for (const [base, items] of groups) {
    const positives = items.filter(i => i.value > 0);
    const negatives = items.filter(i => i.value < 0);
    if (positives.length > 0 && negatives.length > 0) {
      flagged.push({ base, items: items.map(i => ({ label: i.labelText, value: i.value, location: `${i.sheet}!${i.valueCell}` })) });
    }
  }

  if (flagged.length === 0) {
    return { applicable: true, found: false,
      note: 'No sign inconsistency found among NPV/XNPV-labelled values grouped by their shared base metric.' };
  }
  const descriptions = flagged.map(f =>
    f.items.map(i => `${i.label} = ${i.value.toFixed(1)} at ${i.location}`).join(' vs. ')
  );
  return { applicable: true, found: true, flagged,
    note: `Opposite-sign NPV values were found for what appears to be the same underlying metric: ${descriptions.join('; ')}. Two calculation methods for the same project value disagreeing on sign (not just magnitude) is a strong indicator one of them has a genuine formula or sign-convention error.` };
}

// ── Negative periodic debt yield ──────────────────────────────────────
// Found via investigating why a confirmed real defect (a periodic
// "Debt yield" row showing -7.6% in one period, invisible in a
// +21.5% summary statistic) still wasn't caught. Same architectural
// cause as the checks above: the sheet isn't consistently reviewed by
// Tier 2. Debt yield (NOI / total debt) should never be negative for
// a model with genuinely positive operating income — a negative value
// is either a real operating loss in that period or a formula error,
// either way worth surfacing directly.
//
// Uses its own search logic rather than the shared findLabeledRowSeries
// utility: that function correctly stops at the first non-numeric
// cell it finds (a genuine label), but this model's layout has a unit
// label ("%") immediately to the right of the metric label, with the
// real numeric series starting several columns further right —
// confirmed directly this caused the shared utility to capture only 1
// value instead of the full periodic series. Tolerates a short run of
// non-numeric cells (units, descriptions) before giving up, rather
// than stopping at the very first one.
function findPeriodicSeriesTolerant(workbook, labelTerms, opts = {}) {
  const maxDistance = opts.maxDistance || 60;
  const toleratedGap = opts.toleratedGap || 6;
  const terms = labelTerms.map(t => t.toLowerCase());
  const results = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const text = cellText(cell.value).toLowerCase();
        if (!text) return;
        const matchedTerm = terms.find(t => text.includes(t));
        if (!matchedTerm) return;
        const series = [];
        let nonNumericRun = 0;
        for (let c = colNum + 1; c <= colNum + maxDistance; c++) {
          const valCell = row.getCell(c);
          const raw = valCell.formula ? valCell.result : valCell.value;
          if (typeof raw === 'number') {
            series.push({ cell: valCell.address, value: raw });
            nonNumericRun = 0;
          } else {
            nonNumericRun++;
            if (nonNumericRun >= toleratedGap && series.length === 0) break; // nothing numeric found yet within tolerance — give up
            if (nonNumericRun >= 3 && series.length > 0) break; // series had already started, then genuinely ended
          }
        }
        if (series.length > 1) { // a single value isn't a genuine periodic series
          results.push({ sheet: ws.name, labelCell: cell.address, labelText: cellText(cell.value).slice(0, 80), series });
        }
      });
    });
  });

  return results;
}

function checkDebtYieldNegative(workbook) {
  const results = findPeriodicSeriesTolerant(workbook, ['debt yield']);
  const flagged = [];
  for (const r of results) {
    const negatives = r.series.filter(s => s.value < 0);
    if (negatives.length > 0) {
      flagged.push({ sheet: r.sheet, label: r.labelText, negativeCells: negatives.map(n => `${r.sheet}!${n.cell} = ${(n.value * 100).toFixed(1)}%`) });
    }
  }

  if (flagged.length === 0) {
    return { applicable: true, found: false,
      note: 'No periodic debt-yield series with a negative value was found.' };
  }
  return { applicable: true, found: true, flagged,
    note: `The periodic debt yield series shows a negative value in at least one period: ${flagged.map(f => f.negativeCells.join(', ')).join('; ')}. Debt yield (NOI over total debt) going negative implies a genuine operating loss in that period, or a formula error — either way worth reviewing directly, since summary "average/minimum" statistics for this metric may not reflect it.`,
  };
}

module.exports = { checkWaccOverride, checkTerminalValueConcentration, checkOutputReasonableness, checkRevenuePerUnitMetric, checkTerminalValueCrossCheck, checkModelStatusFlag, checkNpvSignConsistency, checkValuationMethodDivergence, checkDebtYieldNegative };

// ── Valuation-method divergence (DCF vs. direct/income capitalisation) ──
// Found via investigating why a confirmed real defect (Completed
// property value $679.6m vs Property DCF value $242.6m — a 2.8x, $437m
// gap between two valuation methods for the same asset) still wasn't
// caught by Tier 2. Same architectural cause as the other two
// dedicated checks above: VALUATIONS isn't consistently selected as a
// key sheet by Familiarisation, so no row-level fix within it can help
// reliably — a dedicated, deterministic check is needed here too.
//
// Comparing a DCF-method value against a direct/income-capitalisation-
// method value for the same asset is a standard real estate valuation
// cross-check, not specific to this one model — but the exact label
// pattern used here ("DCF value", "property value") did not appear on
// any of three other real test files, so cross-model false-positive
// risk could not be directly verified the way the NPV check's could.
// The threshold is set deliberately conservative (50%, roughly double)
// as a result — this is meant to catch a genuinely severe divergence
// like the one confirmed here (2.8x), not flag every ordinary
// difference between two legitimate valuation methods.
const DCF_VALUE_TERMS = ['dcf value', 'dcf valuation'];
const DIRECT_VALUE_TERMS = ['property value', 'capitalisation value', 'capitalization value', 'income capitalisation value'];
const VALUATION_DIVERGENCE_THRESHOLD = 0.5; // 50% — deliberately conservative, see note above

function checkValuationMethodDivergence(workbook) {
  const dcfCandidates = findLabeledValues(workbook, DCF_VALUE_TERMS);
  const directCandidates = findLabeledValues(workbook, DIRECT_VALUE_TERMS);

  if (dcfCandidates.length === 0 || directCandidates.length === 0) {
    return { applicable: true, found: false,
      note: 'No pair of DCF-method and direct/income-capitalisation-method valuation figures for the same asset was found to cross-check against each other.' };
  }

  const dcf = pickModalCandidate(dcfCandidates);
  const direct = pickModalCandidate(directCandidates);
  if (dcf.value === 0 || direct.value === 0) {
    return { applicable: true, found: false,
      note: 'A DCF-method and a direct-method valuation figure were found, but one is zero — a percentage divergence is not meaningful here.' };
  }

  const divergence = Math.abs(direct.value - dcf.value) / Math.max(Math.abs(direct.value), Math.abs(dcf.value));
  if (divergence < VALUATION_DIVERGENCE_THRESHOLD) {
    return { applicable: true, found: false,
      note: `A DCF-method valuation (${dcf.labelText} = ${dcf.value.toFixed(1)}) and a direct-method valuation (${direct.labelText} = ${direct.value.toFixed(1)}) were found and diverge by ${(divergence * 100).toFixed(0)}% — within the disclosed review threshold.` };
  }
  return { applicable: true, found: true,
    dcf: { label: dcf.labelText, value: dcf.value, location: `${dcf.sheet}!${dcf.valueCell}` },
    direct: { label: direct.labelText, value: direct.value, location: `${direct.sheet}!${direct.valueCell}` },
    divergencePct: divergence * 100,
    note: `${direct.labelText} (${direct.value.toFixed(1)} at ${direct.sheet}!${direct.valueCell}) and ${dcf.labelText} (${dcf.value.toFixed(1)} at ${dcf.sheet}!${dcf.valueCell}) diverge by ${(divergence * 100).toFixed(0)}% — two independent valuation methods for what appears to be the same asset disagreeing this materially warrants review of which one (if either) is reliable.`,
  };
}
