'use strict';
// placeholder-text-check.js - an output row whose only content is a "to be provided" style note.
//
// Found by an independent review of a licence model: FinancialRatios!AP129 reads "Formulae to be provided by ESO"
// with AQ:AT129 blank, and OutputSummary row 112 shows that text and then zeros from blank references. The ratio
// is part of the output but was never built, and a blank behaves as zero downstream, so nothing looks wrong.
//
// A cell counts only when (1) its text is a placeholder phrase, and (2) its row holds no other number or formula
// while a nearby row (within two rows) does, so the note stands in for a missing calculation. A "TBC" in a notes
// column beside a finished row is ignored. A zero does not count as content (Patch 35). Documentation sheets (cover, notes, readme, change log) are skipped.

const PLACEHOLDER_RE = /\b(to be (provided|confirmed|completed|determined|updated|added|populated|advised|supplied|inserted|calculated|developed|agreed)|tbc|tbd|todo|to-do|placeholder|coming soon|not yet (provided|available|populated|built|completed|defined)|(formula|formulae|formulas|calculation)s? (to be|not (yet )?)|insert (formula|here)|under (development|construction)|xxx+)\b/i;
const SKIP_SHEET_RE = /(^|\b)(notes?|read ?me|instructions?|change ?log|legend|version|disclaimer|cover|guide|help|glossary|about)(\b|$)/i;

function cellText(cell) {
  const v = cell.value;
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    if (typeof v.result === 'string') return v.result;
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
  }
  return null;
}
// Patch 35: a zero is not content. In the ESO scenario archive the note sits in the first period and the other periods
// hold 0 (a blank read as zero), so a row of a note plus zeros is as unfinished as a row of a note alone.
function isNumberOrFormula(cell) {
  const v = cell.value;
  if (typeof v === 'number') return v !== 0;
  if (v && typeof v === 'object' && (v.formula || v.sharedFormula)) return !(v.result === 0);
  return false;
}

function checkPlaceholderText(workbook) {
  const findings = [];
  let mentionsIgnored = 0;

  workbook.eachSheet(ws => {
    if (SKIP_SHEET_RE.test(ws.name)) return;
    const rowHasContent = new Map();            // row -> count of number/formula cells
    const candidates = [];                      // {row, cell, text}
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      let n = 0;
      row.eachCell({ includeEmpty: false }, cell => {
        if (isNumberOrFormula(cell)) {
          // a formula that just echoes the placeholder text counts as the text, not as content
          const t = cellText(cell);
          if (t && PLACEHOLDER_RE.test(t)) { candidates.push({ row: rowNum, cell, text: t, echo: true }); return; }
          n++;
          return;
        }
        const t = cellText(cell);
        if (t && t.length <= 200 && PLACEHOLDER_RE.test(t)) candidates.push({ row: rowNum, cell, text: t, echo: false });
      });
      rowHasContent.set(rowNum, n);
    });
    for (const c of candidates) {
      if ((rowHasContent.get(c.row) || 0) > 0) { mentionsIgnored++; continue; }
      let near = 0;
      for (let r = Math.max(1, c.row - 2); r <= c.row + 2; r++) if (r !== c.row) near += (rowHasContent.get(r) || 0) >= 3 ? 1 : 0;
      if (near === 0) { mentionsIgnored++; continue; }
      findings.push({
        sheet: ws.name, cell: c.cell.address, text: c.text.slice(0, 120), echo: c.echo,
        note: `${ws.name}!${c.cell.address} reads "${c.text.slice(0, 120)}" and the rest of its row holds no number or formula, while the rows beside it do. The calculation looks unfinished; anything that reads this row sees a blank, which behaves as zero.`,
      });
    }
  });

  const bySheet = {};
  for (const f of findings) bySheet[f.sheet] = (bySheet[f.sheet] || 0) + 1;
  return {
    applicable: true,
    flaggedCount: findings.length,
    bySheet,
    mentionsIgnored,
    findings,
    note: 'Flags a placeholder note ("to be provided", TBC, TODO and similar) that stands alone in its row next to finished rows. A note on a row that also holds numbers, and documentation sheets, are not flagged.',
  };
}

module.exports = { checkPlaceholderText };
