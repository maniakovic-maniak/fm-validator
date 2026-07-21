// lookup-exact-match-check.js — sourced from "Excel for Auditors"
// (Jelen & Dowell) — fm-validator book-mining finding L1: VLOOKUP/MATCH
// calls missing the exact-match parameter silently fall back to
// approximate matching, which requires the lookup column to be sorted
// and can return a plausible-looking but wrong result with no visible
// error.
//
// VLOOKUP/HLOOKUP: the 4th argument (range_lookup) must be FALSE or 0 for
// an exact match; omitting it or passing TRUE/1 means approximate match.
// MATCH: the 3rd argument (match_type) must be exactly 0 for an exact
// match; omitting it defaults to 1 (next-smallest match), and -1 means
// next-largest.

const LOOKUP_CALL_RE = /\b(VLOOKUP|HLOOKUP|MATCH)\s*\(/gi;

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

function isExactMatchArg(fnName, arg) {
  // FIX (found via real testing against The Bend): FALSE() — the
  // zero-argument function form — is functionally identical to the bare
  // FALSE keyword in Excel, but a strict string-equality check doesn't
  // recognize it, producing false positives on genuinely correct
  // exact-match VLOOKUP calls that happen to use this valid syntax
  // variant. Strip a trailing "()" before comparing.
  const v = (arg || '').trim().toUpperCase().replace(/\(\)$/, '');
  if (fnName === 'MATCH') return v === '0';
  return v === 'FALSE' || v === '0'; // VLOOKUP/HLOOKUP
}

function checkLookupExactMatch(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = cell.formula;
        if (!formula) return;
        LOOKUP_CALL_RE.lastIndex = 0;
        let match;
        while ((match = LOOKUP_CALL_RE.exec(formula)) !== null) {
          const fnName = match[1].toUpperCase();
          const openParenIndex = formula.indexOf('(', match.index);
          const extent = extractCallExtent(formula, openParenIndex);
          if (!extent) continue;
          const args = splitTopLevelArgs(extent.argsText);

          const requiredArgIndex = fnName === 'MATCH' ? 2 : 3; // 0-indexed: 3rd or 4th argument
          const hasArg = args.length > requiredArgIndex;
          const exact = hasArg && isExactMatchArg(fnName, args[requiredArgIndex]);
          if (!exact) {
            findings.push({
              sheet: ws.name,
              cell: cell.address,
              function: fnName,
              formula: formula.length > 150 ? formula.slice(0, 150) + '…' : formula,
              note: `${ws.name}!${cell.address} calls ${fnName}() ${hasArg ? `with a non-exact ${fnName === 'MATCH' ? 'match_type' : 'range_lookup'} argument (${args[requiredArgIndex]})` : `without an explicit ${fnName === 'MATCH' ? 'match_type' : 'range_lookup'} argument`} — this silently falls back to approximate matching, which requires the lookup column to be sorted and can return a plausible but wrong value with no visible error.`,
            });
          }
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags VLOOKUP()/HLOOKUP() calls without an explicit FALSE/0 range_lookup argument, and MATCH() calls without an explicit 0 match_type argument — both silently default to approximate matching, a common, well-known source of silent lookup errors.',
  };
}

module.exports = { checkLookupExactMatch };
