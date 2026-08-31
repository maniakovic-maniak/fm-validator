// Found via an independent audit of a real production run, then verified
// directly against the actual source file: 26 of 31 "P1" findings in one
// real report were the exact same single root-cause error - one genuine
// #VALUE! at Cover!C3 (a standard CELL("filename") display formula that
// only resolves after a file's first save), propagating to 25 other
// sheets whose own error cell was simply `=Cover!C3` - a direct,
// no-op reference, not an independent defect.
//
// Confirmed directly: TaxTrigger!F4, MOD!F4, Input!F4, and 22 other
// sheets' error cells are literally just `=Cover!C3` - the same pattern,
// repeated. Treating each as its own independent P1 doesn't match what a
// human reviewer would report: one root cause, with a note about where
// else it surfaces.
//
// This traces that pattern: for a set of cells that all show a formula
// error, does this cell's formula reduce to nothing but a direct
// reference to another cell that's ALSO in the error set? If so, this
// cell is a downstream consumer, not a root cause - its error explains
// nothing new beyond what the root cause already explains.
//
// Deliberately narrow scope: only detects the single-cell-reference
// case (`=Cover!C3`, `=$C$3`, etc.) - not multi-cell formulas that merely
// include a reference to an errored cell among other logic (e.g.
// `=Cover!C3+A1`), since those genuinely may have their own, independent
// defect even if one input happens to also be broken.

const SIMPLE_REFERENCE_PATTERN = /^\s*(?:'([^']+)'|([A-Za-z0-9_&]+))?!?\$?([A-Z]{1,3})\$?(\d+)\s*$/;

/**
 * Parses a formula that's nothing but a direct cell reference, resolving
 * an unqualified reference against the cell's own sheet.
 * Returns { sheet, cell } or null if the formula isn't a simple reference.
 */
function parseSimpleReference(formula, ownSheet) {
  if (!formula) return null;
  const m = SIMPLE_REFERENCE_PATTERN.exec(formula);
  if (!m) return null;
  const sheet = m[1] || m[2] || ownSheet;
  const cell = m[3] + m[4];
  return { sheet, cell };
}

/**
 * Given a flat list of { sheet, cell, error, formula } (scanFormulaErrors'
 * own output shape), groups them into root causes and their downstream
 * consumers.
 *
 * Returns an array of groups: { sheet, cell, error, downstream: [{sheet,
 * cell}, ...] } - one entry per genuine root cause, with every cell that
 * traces back to it (directly or through a short chain of simple
 * references) listed under `downstream` instead of appearing as its own
 * separate entry.
 */
function groupErrorsByRootCause(errorFindings) {
  const byLocation = new Map();
  errorFindings.forEach(f => byLocation.set(`${f.sheet}!${f.cell}`, f));

  // Resolve each cell to its ultimate root cause by following simple
  // reference chains (capped to avoid any pathological/circular case).
  function resolveRoot(sheet, cell, depth = 0) {
    const key = `${sheet}!${cell}`;
    const finding = byLocation.get(key);
    if (!finding || depth > 20) return { sheet, cell };
    const ref = parseSimpleReference(finding.formula, sheet);
    if (ref && byLocation.has(`${ref.sheet}!${ref.cell}`) && `${ref.sheet}!${ref.cell}` !== key) {
      return resolveRoot(ref.sheet, ref.cell, depth + 1);
    }
    return { sheet, cell };
  }

  const roots = new Map(); // "sheet!cell" -> { sheet, cell, error, downstream: [] }
  errorFindings.forEach(f => {
    const root = resolveRoot(f.sheet, f.cell);
    const rootKey = `${root.sheet}!${root.cell}`;
    const isRootItself = (rootKey === `${f.sheet}!${f.cell}`);

    if (!roots.has(rootKey)) {
      const rootFinding = byLocation.get(rootKey) || f;
      roots.set(rootKey, { sheet: root.sheet, cell: root.cell, error: rootFinding.error, downstream: [] });
    }
    if (!isRootItself) {
      roots.get(rootKey).downstream.push({ sheet: f.sheet, cell: f.cell, error: f.error });
    }
  });

  return Array.from(roots.values());
}

module.exports = { groupErrorsByRootCause, parseSimpleReference };
