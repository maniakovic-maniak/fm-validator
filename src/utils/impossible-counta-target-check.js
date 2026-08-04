// impossible-counta-target-check.js
//
// Found via an independent review (MR-004): DATA MAP!C172, C455,
// C468 and MODEL GUIDE!B11 all test
// COUNTA('URWLD COMPANY INPUTS'!$Q$1:$Q$884)+COUNTA('INPUT
// REGISTER'!$Q$1:$Q$670)=1708. Confirmed directly: the two ranges
// contain at most 884 and 670 cells respectively — 1,554 maximum —
// so a target of 1,708 can never be reached. This control is
// mathematically, permanently FAIL, not just currently failing; no
// amount of populating the input sheets can ever satisfy it.
//
// This check proves impossibility mechanically, from the formula's
// own referenced range sizes — it does not need to know anything
// about the model's actual data or intent, only that the arithmetic
// itself cannot work.

const COUNTA_CHAIN_RE = /((?:COUNTA\([^)]+\)\s*\+\s*)*COUNTA\([^)]+\))\s*=\s*(\d+)/gi;
const COUNTA_TERM_RE = /COUNTA\(([^)]+)\)/gi;

// Parses a single range reference (optionally sheet-qualified) into
// its maximum possible cell count. Returns null if the range can't be
// confidently parsed (e.g. a named range, a whole-column reference,
// or a multi-area union) — those are left alone rather than guessed.
function rangeMaxCells(rangeText) {
  // Strip an optional leading 'Sheet Name'! or SheetName! qualifier.
  const afterSheet = rangeText.replace(/^'[^']+'!|^[A-Za-z0-9_]+!/, '').trim();
  const m = /^\$?([A-Z]{1,3})\$?(\d+):\$?([A-Z]{1,3})\$?(\d+)$/.exec(afterSheet);
  if (!m) return null; // not a simple two-corner range — refuse to guess
  const [, col1, row1, col2, row2] = m;
  const colToNum = (c) => c.split('').reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0);
  const c1 = colToNum(col1), c2 = colToNum(col2);
  const r1 = parseInt(row1, 10), r2 = parseInt(row2, 10);
  if (Number.isNaN(r1) || Number.isNaN(r2)) return null;
  const cols = Math.abs(c2 - c1) + 1;
  const rows = Math.abs(r2 - r1) + 1;
  return cols * rows;
}

function checkImpossibleCountaTarget(workbook) {
  const groups = new Map(); // dedupeKey -> { target, maxSum, rangeDescriptions, cells: [{sheet, address}] }

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula || !/COUNTA/i.test(formula)) return;

        COUNTA_CHAIN_RE.lastIndex = 0;
        let chainMatch;
        while ((chainMatch = COUNTA_CHAIN_RE.exec(formula))) {
          const chainText = chainMatch[1];
          const target = parseInt(chainMatch[2], 10);

          COUNTA_TERM_RE.lastIndex = 0;
          let termMatch;
          let maxSum = 0;
          let allRangesParsed = true;
          const rangeDescriptions = [];
          while ((termMatch = COUNTA_TERM_RE.exec(chainText))) {
            const size = rangeMaxCells(termMatch[1]);
            if (size === null) { allRangesParsed = false; break; }
            maxSum += size;
            rangeDescriptions.push(`${termMatch[1]} (max ${size})`);
          }
          if (!allRangesParsed) continue; // couldn't confidently size every range — skip rather than guess

          if (target > maxSum) {
            const dedupeKey = `${chainText}::${target}`;
            if (!groups.has(dedupeKey)) groups.set(dedupeKey, { target, maxSum, rangeDescriptions, cells: [] });
            groups.get(dedupeKey).cells.push({ sheet: ws.name, address: cell.address });
          }
        }
      });
    });
  });

  const findings = [];
  for (const [, g] of groups) {
    const sample = g.cells[0];
    findings.push({
      sheet: sample.sheet, cell: sample.address,
      target: g.target, maxAchievable: g.maxSum,
      rangeDescriptions: g.rangeDescriptions,
      instanceCount: g.cells.length,
      allSheets: [...new Set(g.cells.map(c => c.sheet))],
      note: `${sample.sheet}!${sample.address} tests whether ${g.rangeDescriptions.join(' + ')} equals ${g.target}${g.cells.length > 1 ? ` (the same test is referenced from ${g.cells.length} cells across ${[...new Set(g.cells.map(c => c.sheet))].join(', ')})` : ''}. The maximum these ranges can ever sum to is ${g.maxSum} — ${g.target} can never be reached, so this control is mathematically, permanently FAIL, not just currently failing. No amount of populating the referenced input sheets can satisfy this test as written.`,
    });
  }

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: findings.length > 0
      ? `${findings.length} control formula(s) test a COUNTA-based sum against a target that mathematically exceeds the referenced ranges' maximum possible size.`
      : 'No COUNTA-based control target was found to be mathematically impossible.',
  };
}

module.exports = { checkImpossibleCountaTarget, rangeMaxCells };
