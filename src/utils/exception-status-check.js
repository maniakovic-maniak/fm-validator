// exception-status-check.js
//
// Found via an independent review: multiple check/reconciliation rows
// on this model literally evaluate to the text "EXCEPTION" across
// many periods (e.g. Financial Statements!H53:N53, H55:N55), with no
// visible gate preventing the report's investor-facing summary from
// being generated regardless. A row of check cells reporting
// EXCEPTION in every period it's evaluated is a genuine, direct
// self-disclosure that a reconciliation is failing, distinct from
// (and complementary to) the model-status-flag check (T0-RSN-006),
// which looks for a "status"-labelled cell rather than a check-row's
// own literal cached result.
//
// PREVALENCE TESTED before finalizing: zero matches on three other
// real test files for the literal cached value "EXCEPTION" — this is
// not a broad or generic pattern that would create noise.

function checkExceptionStatusRows(workbook) {
  const groups = new Map(); // "sheet!row" -> { sheet, rowNum, label, cells: [...] }

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      let label = null;
      row.eachCell({ includeEmpty: false }, cell => {
        const v = cell.value;
        const raw = (v && typeof v === 'object' && 'result' in v) ? v.result : v;
        if (typeof raw !== 'string' || raw.trim().toUpperCase() !== 'EXCEPTION') {
          if (!label && typeof v === 'string' && v.trim() && isNaN(parseFloat(v)) && v.trim().toUpperCase() !== 'EXCEPTION') label = v;
          return;
        }
        const key = `${ws.name}!row${rowNum}`;
        if (!groups.has(key)) groups.set(key, { sheet: ws.name, rowNum, label, cells: [] });
        groups.get(key).cells.push(cell.address);
      });
      // Backfill the label after the row scan, since the label cell
      // often sits to the left of the EXCEPTION values and may not
      // have been seen yet on first pass through eachCell.
      const key = `${ws.name}!row${rowNum}`;
      if (groups.has(key) && !groups.get(key).label && label) groups.get(key).label = label;
    });
  });

  const findings = [];
  for (const [, g] of groups) {
    findings.push({
      sheet: g.sheet, rowNum: g.rowNum, label: g.label || '(unlabelled)',
      sampleCell: g.cells[0], instanceCount: g.cells.length,
      note: `${g.sheet}!${g.cells[0]}${g.label ? ` ("${g.label}")` : ''} (and ${g.cells.length - 1} other period(s) on the same row) literally evaluates to "EXCEPTION" — a direct, explicit self-disclosure that this check/reconciliation is currently failing, not a value requiring interpretation. Confirm whether the report's investor-facing summary or verdict is gated on this check passing, since nothing in this workbook appears to block on it.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} check/reconciliation row(s) literally evaluate to "EXCEPTION" across one or more periods.`
      : 'No check/reconciliation row was found reporting a literal "EXCEPTION" status.',
  };
}

module.exports = { checkExceptionStatusRows };
