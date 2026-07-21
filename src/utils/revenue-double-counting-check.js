// revenue-double-counting-check.js — G4 (Phase D deterministic
// gap-fill). Sourced from "Issues the Audit Missed."
//
// SCOPE DECISION, made deliberately rather than attempting full
// multi-path graph tracing (which G4 was originally scoped as needing):
// the real, common failure mode is a single revenue SOURCE cell being
// pulled into TWO OR MORE SEPARATE "Total Revenue"-style aggregations —
// e.g. a "Merchandise Revenue" line summed into both a segment total
// AND a group total, where nobody intended the segment total itself to
// be re-summed into the group figure via its own components. This is
// meaningfully more tractable than genuine multi-path-to-a-shared-sink
// detection, and covers the common case directly.
//
// EXPLICITLY NOT double-counting, and not flagged: a "Total Revenue"
// cell that simply LINKS to another "Total Revenue" cell elsewhere (a
// pass-through display/reference, not a re-aggregation) — this check
// only looks at whether a SOURCE COMPONENT is independently re-summed
// into multiple DIFFERENT totals, not at how totals reference each
// other afterward (that's daisy-chain-check.js's territory).

const REVENUE_TOTAL_TERMS = ['total revenue', 'revenue total', 'gross revenue', 'total sales', 'total income'];

function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function numToCol(n) {
  let s = '';
  while (n > 0) { const rem = (n - 1) % 26; s = String.fromCharCode(65 + rem) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function extractCallExtent(formula, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < formula.length; i++) {
    if (formula[i] === '(') depth++;
    else if (formula[i] === ')') {
      depth--;
      if (depth === 0) return { argsText: formula.slice(openParenIndex + 1, i), endIndex: i + 1 };
    }
  }
  return null;
}

function splitTopLevelArgs(argsText) {
  const args = [];
  let depth = 0;
  let current = '';
  for (const ch of argsText) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { args.push(current.trim()); current = ''; }
    else current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// Expands each top-level SUM() argument into individual "Sheet!Cell"
// component addresses — handles a contiguous range (A1:A5) or a bare
// cell (A1); a nested function call as an argument is skipped rather
// than guessed at (matches this project's established discipline).
const RANGE_ARG_RE = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i;
const MAX_RANGE_CELLS = 500;

function expandSumComponents(formula, currentSheet) {
  const m = /\bSUM\s*\(/i.exec(formula);
  if (!m) return null;
  const openParenIndex = formula.indexOf('(', m.index);
  const extent = extractCallExtent(formula, openParenIndex);
  if (!extent) return null;
  // Only handle a formula that IS a single SUM() call, not SUM(...)
  // embedded inside something larger — matches this check's narrow,
  // "skip rather than guess" scope.
  if (extent.endIndex !== formula.length || m.index !== 0) return null;

  const args = splitTopLevelArgs(extent.argsText);
  const components = new Set();
  for (const arg of args) {
    const rm = RANGE_ARG_RE.exec(arg.trim());
    if (!rm) return null; // a non-simple argument (a nested function, an expression) — skip the whole formula rather than guess
    const [, col1, row1, col2, row2] = rm;
    if (col2 && row2) {
      const c1 = colToNum(col1), c2 = colToNum(col2);
      const r1 = parseInt(row1, 10), r2 = parseInt(row2, 10);
      const cLo = Math.min(c1, c2), cHi = Math.max(c1, c2);
      const rLo = Math.min(r1, r2), rHi = Math.max(r1, r2);
      if ((cHi - cLo + 1) * (rHi - rLo + 1) > MAX_RANGE_CELLS) return null;
      for (let c = cLo; c <= cHi; c++) for (let r = rLo; r <= rHi; r++) components.add(`${currentSheet}!${numToCol(c)}${r}`);
    } else {
      components.add(`${currentSheet}!${col1.toUpperCase()}${row1}`);
    }
  }
  return components;
}

function checkRevenueDoubleCounting(workbook) {
  // Find every SUM()-formula cell whose nearby label matches a revenue-
  // total term. Deliberately reuses the same "label within a few cells"
  // heuristic already proven in find-labeled-value.js, applied here to
  // the FORMULA cell itself rather than a value beside a label.
  const totals = [];
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const formula = cell.formula;
        if (!formula) return;
        // Look left along the row for a matching label within 8 cells —
        // the same proximity convention used throughout this project.
        let labelText = null;
        for (let c = colNum - 1; c >= Math.max(1, colNum - 8); c--) {
          const v = row.getCell(c).value;
          if (typeof v === 'string' && v.trim()) {
            const lower = v.toLowerCase();
            if (REVENUE_TOTAL_TERMS.some(t => lower.includes(t))) labelText = v;
            break; // first text cell found, matching or not — same convention as findLabeledValues
          }
        }
        if (!labelText) return;
        const components = expandSumComponents(formula, ws.name);
        if (!components || components.size === 0) return;
        totals.push({ sheet: ws.name, cell: cell.address, labelText, components });
      });
    });
  });

  if (totals.length < 2) {
    return { applicable: totals.length > 0, flaggedCount: 0, findings: [], note: totals.length === 0 ? 'No labelled "Total Revenue"-style SUM() aggregation found.' : 'Only one labelled revenue-total aggregation found — nothing to compare for overlap.' };
  }

  // Reverse index: for each component cell, which revenue-total cells
  // include it?
  const componentOwners = {};
  for (const t of totals) {
    for (const comp of t.components) {
      (componentOwners[comp] = componentOwners[comp] || []).push(t);
    }
  }

  const findings = [];
  const reportedPairs = new Set();
  for (const [comp, owners] of Object.entries(componentOwners)) {
    if (owners.length < 2) continue;
    const pairKey = owners.map(o => `${o.sheet}!${o.cell}`).sort().join('|');
    if (reportedPairs.has(pairKey)) continue; // same set of totals already reported for a different shared component
    reportedPairs.add(pairKey);
    findings.push({
      componentCell: comp,
      totals: owners.map(o => ({ sheet: o.sheet, cell: o.cell, labelText: o.labelText })),
      note: `${comp} is summed into ${owners.length} separate revenue-total aggregations: ${owners.map(o => `${o.sheet}!${o.cell} ("${o.labelText}")`).join(', ')}. If these totals are themselves later combined (e.g. into a group or consolidated figure), this source is counted more than once.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags a revenue source cell that is summed into two or more separately-labelled "Total Revenue"-style aggregations — a real double-counting risk if those totals are later combined. Only simple SUM() formulas (a contiguous range or a plain list of cells) are evaluated; anything more complex is skipped rather than guessed at. Does not flag one total simply linking to another (a pass-through reference, not a re-aggregation).',
  };
}

module.exports = { checkRevenueDoubleCounting };
