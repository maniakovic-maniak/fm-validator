// pmt-sign-convention-check.js — sourced from "Mastering Advanced Excel
// Formulas and Functions" (Harjit Suman) — fm-validator book-mining
// finding L18: PMT()/IPMT()/PPMT()'s pv argument sign convention must be
// consistent across a model. Excel's PMT-family functions return a
// value whose sign is the opposite of the pv argument's sign (positive
// pv → negative payment, or vice versa) — either convention is valid on
// its own, but MIXING them within one model means the resulting payment
// values have inconsistent signs and cannot be safely summed together
// (a mix of positive and negative "debt service" figures produces a
// silently wrong total).
//
// Distinct from sign-convention-check.js, which compares the sign of
// LABELLED VALUES; this compares the sign of a FORMULA ARGUMENT
// (textual — does the pv argument start with a negation), since the
// underlying question here is about how the function is being CALLED,
// not what a nearby label says.

const PMT_FAMILY_RE = /\b(PMT|IPMT|PPMT)\s*\(/gi;

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

function isNegatedArg(arg) {
  const v = (arg || '').trim();
  // Covers "-B5", "-1*B5", "(-B5)" style negations; a bare positive
  // reference or literal is left un-negated. Deliberately simple —
  // doesn't try to evaluate whether B5 ITSELF might independently hold
  // a negative number, since that's outside what formula text alone can
  // tell us; this is about how the function call itself is structured.
  return /^-/.test(v) || /^\(\s*-/.test(v);
}

function checkPmtSignConsistency(workbook) {
  const instances = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        PMT_FAMILY_RE.lastIndex = 0;
        let match;
        while ((match = PMT_FAMILY_RE.exec(formula)) !== null) {
          const fnName = match[1].toUpperCase();
          const openParenIndex = formula.indexOf('(', match.index);
          const extent = extractCallExtent(formula, openParenIndex);
          if (!extent) continue;
          const args = splitTopLevelArgs(extent.argsText);
          const pvIndex = fnName === 'PMT' ? 2 : 3; // PMT(rate,nper,pv,...) vs IPMT/PPMT(rate,per,nper,pv,...)
          if (args.length <= pvIndex) continue;
          instances.push({
            sheet: ws.name, cell: cell.address, function: fnName,
            pvArg: args[pvIndex], isNegative: isNegatedArg(args[pvIndex]),
          });
        }
      });
    });
  });

  const positives = instances.filter(i => !i.isNegative);
  const negatives = instances.filter(i => i.isNegative);

  if (instances.length === 0) {
    return { applicable: false, flaggedCount: 0, findings: [], note: 'No PMT()/IPMT()/PPMT() calls found in this model.' };
  }
  if (positives.length === 0 || negatives.length === 0) {
    return { applicable: true, flaggedCount: 0, findings: [], instanceCount: instances.length, note: `All ${instances.length} PMT()/IPMT()/PPMT() call(s) use a consistent pv-argument sign convention.` };
  }

  const sample = [...positives.slice(0, 3), ...negatives.slice(0, 3)]
    .map(i => `${i.sheet}!${i.cell} (${i.function}, pv=${i.pvArg})`);

  return {
    applicable: true,
    flaggedCount: 1,
    findings: [{
      positiveCount: positives.length,
      negativeCount: negatives.length,
      sample,
      note: `PMT()/IPMT()/PPMT() calls use an inconsistent pv-argument sign convention: ${positives.length} call(s) use a positive pv, ${negatives.length} call(s) use a negated pv, e.g. ${sample.join(', ')}. Either convention is valid on its own, but mixing them means the resulting payment values have inconsistent signs and cannot be safely summed together — a mix of positive and negative "debt service" figures would silently misstate a total.`,
    }],
    note: `${instances.length} PMT()/IPMT()/PPMT() call(s) found, split ${positives.length} positive-pv / ${negatives.length} negative-pv — an internal sign-convention inconsistency.`,
  };
}

module.exports = { checkPmtSignConsistency };
