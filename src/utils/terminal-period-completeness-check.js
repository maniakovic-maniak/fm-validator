// terminal-period-completeness-check.js — G2 (Phase D deterministic
// gap-fill). Sourced from "Issues the Audit Missed": terminal periods
// omitting merchandise costs, working-capital movements, and sustaining
// capex — a real, real-world-confirmed failure mode.
//
// ARCHITECTURALLY DISTINCT from L10 (formula-pattern-consistency-check.js):
// L10 catches a formula whose STRUCTURE differs from its row's dominant
// pattern. This catches something L10 cannot: a formula that is
// structurally IDENTICAL across the whole row (so L10 sees nothing wrong
// at all) but resolves to an unexpected zero in the terminal period(s)
// specifically, because an upstream driver silently dropped out. This is
// a VALUE-based anomaly check, not a formula-text check.
//
// KEY DESIGN CHALLENGE, addressed directly: a genuine business wind-down
// (declining terminal-period values) is normal, not a defect — this must
// not be confused with a genuine data/formula gap. The distinguishing
// signal used here: the drop must be SUDDEN, specifically at the
// terminal boundary — the "established" window immediately before the
// terminal period(s) must itself be relatively stable (not already
// trending toward zero), which a legitimate gradual wind-down would
// violate (its established window would ALSO be declining), but a
// genuine omission would not (the established window looks normal right
// up until the cliff).

const { isLikelyRowTotal } = (() => {
  // Reuses the exact row-total detection already proven in
  // formula-pattern-consistency-check.js, rather than re-deriving a
  // second, possibly-inconsistent version of the same logic.
  const ROW_TOTAL_RE = /^(SUM|SUBTOTAL|AVERAGE)\s*\(\s*(?:\d+\s*,\s*)?\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)$/i;
  function isLikelyRowTotal(formula, rowNum) {
    if (!formula) return false;
    const m = ROW_TOTAL_RE.exec(formula.trim());
    if (!m) return false;
    const [, , , r1, , r2] = m;
    return parseInt(r1, 10) === rowNum && parseInt(r2, 10) === rowNum;
  }
  return { isLikelyRowTotal };
})();

const MIN_SERIES_LENGTH = 8;      // need enough periods to establish a real pattern
const TERMINAL_WINDOW = 2;        // check the last 2 periods
const ESTABLISHED_WINDOW = 5;     // periods immediately before the terminal window
const DROP_THRESHOLD_FRACTION = 0.1; // terminal value must fall below 10% of the established average
const STABILITY_FRACTION = 0.5;   // established window's first value must be >= 50% of its last — guards against flagging a genuine gradual wind-down

function checkTerminalPeriodCompleteness(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      const cells = [];
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const formula = cell.formula;
        if (formula && isLikelyRowTotal(formula, rowNum)) return; // exclude a trailing row-total column from the series
        // FIX (found via direct testing, before this shipped): cell.value?.result
        // silently returns undefined for a formula cell whose result is
        // exactly 0 — an ExcelJS quirk where a falsy result is dropped
        // from cell.value entirely (only .formula remains there), while
        // still being correctly available via the separate cell.result
        // property. Confirmed directly: {formula:'A2', result:0} yields
        // cell.value = {formula:'A2'} (no .result at all) but
        // cell.result = 0 correctly. This exact bug would have silently
        // excluded every genuine zero-value period from consideration —
        // precisely the values this check most needs to see, since a
        // terminal-period drop TO zero is the whole signal being
        // detected. find-labeled-value.js already used the correct
        // cell.result form from the start; this file didn't, until now.
        const raw = formula ? cell.result : cell.value;
        if (typeof raw === 'number') {
          cells.push({ colNum, address: cell.address, value: raw, hasFormula: !!formula });
        }
      });

      if (cells.length < MIN_SERIES_LENGTH) return;
      // Focus on genuine CALCULATED time series, not a row of hardcoded/unrelated numbers.
      const formulaFraction = cells.filter(c => c.hasFormula).length / cells.length;
      if (formulaFraction < 0.7) return;

      cells.sort((a, b) => a.colNum - b.colNum);
      const terminal = cells.slice(-TERMINAL_WINDOW);
      const established = cells.slice(-(TERMINAL_WINDOW + ESTABLISHED_WINDOW), -TERMINAL_WINDOW);
      if (established.length < 3) return; // not enough established history to compare against

      const establishedAvg = established.reduce((s, c) => s + Math.abs(c.value), 0) / established.length;
      if (establishedAvg < 1) return; // established period itself near-zero — nothing meaningful to detect a drop from

      // FIX (found via real testing against The Bend, before shipping):
      // a SPARSE row — mostly zero, with a single one-off spike (a
      // common, entirely legitimate pattern for one-time construction/
      // capex line items that only incur cost in one specific period) —
      // could still pass the average-based threshold above purely
      // because of that one spike, even though most of the "established"
      // window was already zero. Confirmed directly: Construction
      // Timeline row 29 was [0,0,0,10000,0] in its established window —
      // average 2000, clearing the threshold, but not a genuine stable
      // series at all. Require every established-period value to be
      // reasonably close to the average, not just the average itself
      // being nonzero — this correctly excludes a spike-among-zeros
      // pattern while still catching a genuinely stable, consistent
      // series that then drops.
      const CONSISTENCY_FRACTION = 0.3;
      const establishedConsistent = established.every(c => Math.abs(c.value) >= establishedAvg * CONSISTENCY_FRACTION);
      if (!establishedConsistent) return;

      // Stability guard: the established window itself must not already be
      // in decline — otherwise this is very plausibly a genuine wind-down,
      // not an omission. FIX (found via the exact test case this guard
      // exists for): the ratio must be LAST-over-FIRST (does the window
      // end lower than it started — i.e. is it declining), not
      // first-over-last, which only ever caught an INCREASING window and
      // let a genuinely declining established window straight through —
      // precisely the false positive this guard was built to prevent.
      const firstEstablished = Math.abs(established[0].value);
      const lastEstablished = Math.abs(established[established.length - 1].value);
      if (firstEstablished > 0 && lastEstablished / firstEstablished < STABILITY_FRACTION) return;

      const terminalAllNearZero = terminal.every(c => Math.abs(c.value) < establishedAvg * DROP_THRESHOLD_FRACTION);
      if (!terminalAllNearZero) return;

      findings.push({
        sheet: ws.name,
        row: rowNum,
        terminalCells: terminal.map(c => c.address),
        establishedAvg: Math.round(establishedAvg * 100) / 100,
        terminalValues: terminal.map(c => c.value),
        note: `${ws.name} row ${rowNum}: the terminal period(s) (${terminal.map(c => c.address).join(', ')}) drop to approximately zero, while the immediately preceding periods averaged ${Math.round(establishedAvg * 100) / 100} and were themselves stable (not already declining) — a sudden, sharp drop specifically at the end of the series, not a gradual wind-down. Confirm whether the terminal period genuinely has zero activity, or an upstream driver (a cost category, a working-capital movement, a capex schedule) silently drops out at that boundary.`,
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a row whose values drop suddenly to near-zero in the last 1-2 periods after a stable, non-declining run of prior periods — a value-based signal distinct from L10\'s formula-pattern check, since a terminal-period omission can be structurally identical to every other period\'s formula while still resolving to an unexpected zero. Requires at least 8 numeric periods, >=70% formula-derived, and a stable (non-declining) established window immediately before the terminal periods, specifically to avoid flagging a genuine gradual business wind-down.',
  };
}

module.exports = { checkTerminalPeriodCompleteness };
