// zero-rate-multiplier-check.js - Patch 51.
//
// Found in two Partner Reviews of the ESO licence model (B4-F002, then B4-RoRE-002): 'RoRE ranges' row 52, labelled
// "Corporation tax rate", holds the constant 0 in every period (AP52:AT52), and other formulas use it as a multiplier,
// for example AP91 = AP$62*(1-AP$52). Post-tax incentives are therefore taxed at 0%. The reviewer's wording was "no visible
// source links"; the real position is a hard-typed zero that nothing checks.
//
// A zero rate can be intended (a scenario with no tax, a placeholder before the rate is agreed), so this is raised as a Query,
// never as a confirmed defect. It fires only when ALL of these hold:
//   1. a text label names a rate that scales money: tax, discount, inflation, interest, WACC, cost of equity/debt, escalation
//   2. the same row holds at least MIN_SERIES constant numbers to the right of the label and every one of them is exactly 0
//   3. at least one formula uses one of those cells as a multiplier or divisor: (1-x), (1+x), *x, x*, /x
// Base and reference rates are left to zero-base-rate-check.js. Computed rates ("effective ...") are skipped.
//
// Cost: one pass over the cells to find labels; formulas are only analysed when the workbook has a candidate row, and each
// formula costs one precompiled regular-expression test first.

const RATE_TERMS = [
  /\b(?:corporat\w*|income|company|statutory|marginal)\s+tax\s+rate\b/i,
  /\btax\s+rate\b/i,
  /\bdiscount\s+rate\b/i,
  /\binflation\s+rate\b/i,
  /\binterest\s+rate\b/i,
  /\bwacc\b/i,
  /\bcost\s+of\s+(?:equity|debt|capital)\b/i,
  /\bescalation\s+rate\b/i,
  /\bgrowth\s+rate\b/i,
];
const SKIP_TERMS = /\b(?:effective|base\s+rate|reference\s+rate|average|avg|mean|implied|computed|calculated)\b/i;
const MIN_SERIES = 3;
const MAX_LABEL_COL = 8;
const MAX_FINDINGS = 20;

function textOf(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
  return null;
}
function colNum(letters) { let n = 0; for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function isFormula(v) { return !!v && typeof v === 'object' && (v.formula !== undefined || v.sharedFormula !== undefined); }
function formulaText(v) { return typeof v.formula === 'string' ? v.formula : null; }
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// A1-style references in a formula, with an optional sheet prefix. Returns [{sheet|null, col, row, start, end}]
const REF_RE = /(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))?!?\$?([A-Z]{1,3})\$?(\d{1,7})(?![A-Za-z0-9_(])/g;
function refsIn(formula) {
  const out = [];
  const re = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d{1,7})(?![A-Za-z0-9_(])/g;
  let m;
  while ((m = re.exec(formula)) !== null) {
    out.push({ sheet: m[1] ? m[1].replace(/''/g, "'") : (m[2] || null), col: m[3], row: +m[4], start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

// Is the reference at [start,end) used to scale something? (1-x) (1+x) *x x* /x x/
function usedAsScaler(formula, ref) {
  const before = formula.slice(Math.max(0, ref.start - 12), ref.start).replace(/\s+/g, '');
  const after = formula.slice(ref.end, ref.end + 4).replace(/\s+/g, '');
  if (/\(1[-+]$/.test(before)) return '(1 - rate)';
  if (/[*]$/.test(before) || /^[*]/.test(after)) return 'multiplier';
  if (/[/]$/.test(before)) return 'divisor';
  return null;
}

function checkZeroRateMultipliers(workbook) {
  const candidates = []; // { sheet, row, label, labelCell, cols:[colNums], cells:[addr] }
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      let label = null, labelCell = null;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (label || colNumber > MAX_LABEL_COL) return;
        const t = textOf(cell.value);
        if (t && t.length <= 80 && !SKIP_TERMS.test(t) && RATE_TERMS.some(re => re.test(t))) { label = t.trim(); labelCell = cell; }
      });
      if (!label) return;
      const consts = [];
      let nonZero = false;
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber <= labelCell.col) return;
        const v = cell.value;
        if (typeof v === 'number') { if (v === 0) consts.push(cell.address); else nonZero = true; }
      });
      if (nonZero || consts.length < MIN_SERIES) return;
      candidates.push({ sheet: ws.name, row: rowNum, label, labelCell: labelCell.address, cells: consts });
    });
  });
  if (candidates.length === 0) return { applicable: true, flaggedCount: 0, findings: [], note: 'No labelled rate row of constant zeros found.' };

  // Which cells are rate cells: sheet|COL|ROW
  const rateCell = new Map();
  for (const c of candidates) for (const a of c.cells) {
    const m = /^([A-Z]{1,3})(\d+)$/.exec(a);
    rateCell.set(`${c.sheet}|${m[1]}|${m[2]}`, c);
  }
  const rows = [...new Set(candidates.map(c => c.row))];
  const prefilter = new RegExp('[A-Z]{1,3}\\$?(?:' + rows.map(r => esc(String(r))).join('|') + ')(?![0-9])');
  const users = new Map(); // candidate -> { count, sample:[{cell, how}] }
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        if (!isFormula(cell.value)) return;
        const f = formulaText(cell.value);
        if (!f || !prefilter.test(f)) return;
        for (const ref of refsIn(f)) {
          const sheet = ref.sheet || ws.name;
          const cand = rateCell.get(`${sheet}|${ref.col}|${ref.row}`);
          if (!cand) continue;
          const how = usedAsScaler(f, ref);
          if (!how) continue;
          if (!users.has(cand)) users.set(cand, { count: 0, sample: [], hows: new Set() });
          const u = users.get(cand);
          u.count++; u.hows.add(how);
          if (u.sample.length < 3) u.sample.push(`${ws.name}!${cell.address}`);
          break; // one use per formula cell is enough
        }
      });
    });
  });

  const findings = [];
  for (const c of candidates) {
    const u = users.get(c);
    if (!u) continue;
    const first = c.cells[0], last = c.cells[c.cells.length - 1];
    findings.push({
      sheet: c.sheet, cell: first, label: c.label, labelCell: c.labelCell, range: `${first}:${last}`, zeroCount: c.cells.length,
      userCount: u.count, userSample: u.sample, uses: [...u.hows],
      note: `${c.sheet}!${c.labelCell} "${c.label}" is the constant 0 in all ${c.cells.length} period cells (${first}:${last}), and ${u.count} formula cell(s) use it as a ${[...u.hows].join(' / ')}, for example ${u.sample.join(', ')}. Every result scaled by this rate is calculated as if the rate were 0%. If a zero rate is intended (a scenario with no tax, say) this is fine; if the rate was meant to come from an input or a schedule, it has not been linked.`,
    });
    if (findings.length >= MAX_FINDINGS) break;
  }
  return { applicable: true, flaggedCount: findings.length, findings, note: findings.length ? `${findings.length} labelled rate row(s) are all-zero constants used as multipliers.` : 'Labelled rate rows of zeros were found but no formula uses them as a multiplier or divisor.' };
}

module.exports = { checkZeroRateMultipliers, usedAsScaler, refsIn };
