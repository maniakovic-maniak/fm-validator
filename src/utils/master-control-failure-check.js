// master-control-failure-check.js
//
// Found via an independent review: the model's own named master
// control cells (Summary!O12 "Balance sheet control", O13 "Sources
// and uses control", O14 "Debt roll-forward control", and others)
// show FAIL, but the review confirmed these reliance-blocking
// failures were not consistently reaching P1 severity, and every
// single finding in the report — including these — was marked
// Investment Blocker = No, since nothing in the pipeline ever sets
// that field. Confirmed directly: investment_grade_blocker is never
// set anywhere in this codebase.
//
// This check gives these findings a direct, dedicated path to
// correct severity and blocker status, rather than depending on
// Tier 2 (an LLM) happening to notice the FAIL value, describe it
// well, and classify it appropriately — the model is already telling
// the reader directly, in its own words, that a named control has
// failed; fm-validator should surface that as unambiguously as the
// model itself does, not filter it through a layer that might soften
// or miss it.
//
// Aggregates by normalized label text (lowercased, hyphens/spaces
// collapsed) so the same control repeated across multiple cells or
// sheets — confirmed on the real file: "Balance sheet control" and
// "Balance-sheet control" both appear, once in Summary spanning 5
// period columns and again as a single cell in DATA MAP — collapses
// to one finding with an instance count, not one per raw cell.
//
// PREVALENCE TESTED before finalizing: zero matches on 3 of 4 other
// real reference files; the fourth (Hidden Gem) has 2 literal "FAIL"
// cells but neither is control/gate-labelled, correctly excluded.

const CONTROL_LABEL_RE = /control|gate|\bcheck\b/i;
const FAIL_VALUES = new Set(['fail']);

function normalizeLabel(label) {
  return label.toLowerCase().replace(/[-\s]+/g, ' ').trim();
}

function checkMasterControlFailure(workbook) {
  const groups = new Map(); // normalizedLabel -> { label, cells: [{sheet, address}] }

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const v = cell.value;
        const raw = (v && typeof v === 'object' && 'result' in v) ? v.result : v;
        if (typeof raw !== 'string' || !FAIL_VALUES.has(raw.trim().toLowerCase())) return;

        // Search both directions — confirmed necessary directly: this
        // model's control labels sit to the RIGHT of the FAIL value
        // (Summary!N12 "Balance sheet control" labels O12's FAIL),
        // the opposite of most other labeled-value patterns in this
        // codebase, which look left. A generic model could plausibly
        // place the label on either side, so this check does not
        // assume one direction the way most of this codebase's other
        // checks reasonably can.
        let label = null;
        for (let c = Math.max(1, colNum - 8); c <= colNum + 4; c++) {
          if (c === colNum) continue;
          const nv = row.getCell(c).value;
          if (typeof nv === 'string' && CONTROL_LABEL_RE.test(nv)) { label = nv.trim(); break; }
        }
        if (!label) return;

        const key = normalizeLabel(label);
        if (!groups.has(key)) groups.set(key, { label, cells: [] });
        groups.get(key).cells.push({ sheet: ws.name, address: cell.address });
      });
    });
  });

  const findings = [];
  for (const [, g] of groups) {
    const sample = g.cells[0];
    findings.push({
      sheet: sample.sheet, cell: sample.address, label: g.label,
      instanceCount: g.cells.length,
      allSheets: [...new Set(g.cells.map(c => c.sheet))],
      note: `${sample.sheet}!${sample.address} ("${g.label}") shows FAIL${g.cells.length > 1 ? ` (and ${g.cells.length - 1} other cell(s) showing the same control result, across ${[...new Set(g.cells.map(c => c.sheet))].join(', ')})` : ''} — this is the model's own explicit, self-labelled assessment that this control has failed, not an inference from values or labels. Confirm this is genuinely reflected as a reliance-blocking, top-priority finding, not filtered down to a lower-confidence classification.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} distinct master control(s) show FAIL according to the model's own self-labelled control cells.`
      : 'No master control cell (labelled control/gate/check) was found showing FAIL.',
  };
}

module.exports = { checkMasterControlFailure };
