// release-gate-coverage-check.js
//
// Found via an independent review (MR-003): DATA MAP!C173, the
// external-release status formula, tests only $C$155:$C$172 (18
// cells) plus Summary!$O$12:$O$14 — but the same DATA MAP sheet
// contains 66 total status-like cells (OK/PASS/FAIL/EXCEPTION/NOT
// TESTED) spanning rows 155 to 497. The 48 outside the tested range
// include C464 ("NOT TESTED — LEGACY AUDIT MODULE REMOVED") and
// several hardcoded "OK" strings. The workbook could display
// INVESTOR READY while later controls remain untested or failed,
// entirely outside the gate's own precedent chain.
//
// This check does not attempt full transitive dependency tracing (a
// much larger undertaking) — it checks DIRECT range coverage: does
// the gate formula's own text reference a range that includes each
// other status-like cell's row on the same sheet. This is exactly
// what the real defect demonstrates: the gap here is a range
// boundary that was never extended as later controls were added, not
// a subtle multi-hop tracing failure.

const STATUS_VALUE_RE = /^(OK|PASS|FAIL|EXCEPTION|NOT TESTED)/i;
// A cell is a plausible "gate" if its formula tests a same-column range
// against an exception/fail-style condition (COUNTIF ... "EXCEPTION*" or
// similar) and produces a status-style result itself.
const GATE_FORMULA_RE = /COUNTIF\(\s*\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)\s*,\s*"(?:EXCEPTION|FAIL)/i;

function checkReleaseGateCoverage(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    // Collect every status-like cell on this sheet, keyed by column.
    const statusCellsByColumn = new Map(); // column letter -> [{row, address, value}]
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const v = cell.value;
        const raw = (v && typeof v === 'object' && 'result' in v) ? v.result : v;
        if (typeof raw !== 'string' || !STATUS_VALUE_RE.test(raw.trim())) return;
        const col = cell.address.replace(/\d+$/, '');
        if (!statusCellsByColumn.has(col)) statusCellsByColumn.set(col, []);
        statusCellsByColumn.get(col).push({ row: rowNum, address: cell.address, value: raw.trim() });
      });
    });

    // Find gate-shaped formulas on this sheet.
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        const m = GATE_FORMULA_RE.exec(formula);
        if (!m) return;
        const [, col1, row1, col2, row2] = m;
        if (col1 !== col2) return; // only handle a same-column range, matching the real pattern
        const testedMin = Math.min(parseInt(row1, 10), parseInt(row2, 10));
        const testedMax = Math.max(parseInt(row1, 10), parseInt(row2, 10));

        const columnStatusCells = statusCellsByColumn.get(col1) || [];
        const uncovered = columnStatusCells.filter(c => c.row < testedMin || c.row > testedMax);
        if (uncovered.length === 0) return;

        findings.push({
          sheet: ws.name, cell: cell.address,
          testedRange: `${col1}${testedMin}:${col1}${testedMax}`,
          uncoveredCount: uncovered.length,
          uncoveredSample: uncovered.slice(0, 5).map(c => `${c.address} ("${c.value}")`),
          note: `${ws.name}!${cell.address} is a release/status gate testing only ${col1}${testedMin}:${col1}${testedMax} for exceptions, but ${uncovered.length} other status-like cell(s) exist in the same column outside that range, including: ${uncovered.slice(0, 5).map(c => `${c.address} ("${c.value}")`).join(', ')}${uncovered.length > 5 ? ', and others' : ''}. A control outside the gate's own tested range can be failed, untested, or excepted with no effect on the gate's own reported status — the workbook could show a clean release status while later controls are silently uncovered.`,
        });
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} release/status gate formula(s) leave other status-like cells on the same sheet outside their tested range.`
      : 'No release/status gate was found with status-like cells outside its own tested range.',
  };
}

module.exports = { checkReleaseGateCoverage };
