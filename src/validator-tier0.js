// Tier 0 — Formula text scanner
// Runs before Tier 1. Pure code — no Claude API calls.
// Reads formula text from exceljs and produces:
//   - Workbook statistics per sheet
//   - F-score per unique formula (KPMG methodology)
//   - Unique Formula Analysis (UFI list)
//   - Formula Map (sheet dependency matrix + edge list)
//   - Risk indicators (IFERROR, OFFSET, external links, hardcodes, #REF!)

// ── F-Score rules (KPMG) ─────────────────────────────────────────────────────
function scoreFormula(formula) {
  if (!formula || typeof formula !== 'string') return 0;
  let score = 0;
  const f = formula;
  const len = f.length;

  // Length scoring
  if (len > 500) score += 3;
  else if (len > 250) score += 2;
  else if (len > 100) score += 1;

  // Nested branching
  const ifCount = (f.match(/\bIF\s*\(|\bIFS\s*\(|\bCHOOSE\s*\(|\bSWITCH\s*\(/gi) || []).length;
  score += ifCount;

  // Lookup functions
  if (/\bXLOOKUP\s*\(|\bINDEX\s*\(|\bMATCH\s*\(|\bVLOOKUP\s*\(|\bHLOOKUP\s*\(/i.test(f)) score += 1;

  // Dynamic references — high risk
  if (/\bOFFSET\s*\(|\bINDIRECT\s*\(/i.test(f)) score += 3;

  // Volatile functions
  if (/\bTODAY\s*\(|\bNOW\s*\(|\bRAND\s*\(|\bRANDBETWEEN\s*\(/i.test(f)) score += 3;

  // External workbook reference
  if (f.includes('[')) score += 5;

  // Hardcoded numeric constants (not 0 or 1 which are structural)
  const hardcodes = f.match(/(?<![A-Z0-9_])[2-9]\d*(?:\.\d+)?(?![A-Z0-9_])/gi) || [];
  if (hardcodes.length > 0) score += 1;

  // Error handling
  if (/\bIFERROR\s*\(|\bIFNA\s*\(|\bISERROR\s*\(/i.test(f)) score += 1;

  // Cross-sheet reference
  if (f.includes('!')) score += 1;

  // Arithmetic/logical operator density
  const ops = (f.match(/[+\-*/<>=&]/g) || []).length;
  if (ops > 10) score += 2;
  else if (ops > 5) score += 1;

  return score;
}

function complexityBand(score) {
  if (score >= 13) return 'Critical';
  if (score >= 8)  return 'High';
  if (score >= 4)  return 'Moderate';
  return 'Low';
}

function complexityExplanation(formula, score, band) {
  const drivers = [];
  const f = formula || '';

  if (f.length > 500) drivers.push('very long formula (>500 chars)');
  else if (f.length > 250) drivers.push('long formula (>250 chars)');
  else if (f.length > 100) drivers.push('moderate length (>100 chars)');

  const ifCount = (f.match(/\bIF\s*\(|\bIFS\s*\(|\bCHOOSE\s*\(|\bSWITCH\s*\(/gi) || []).length;
  if (ifCount > 2) drivers.push(`${ifCount} nested conditional branches`);
  else if (ifCount > 0) drivers.push('conditional branching');

  if (/\bOFFSET\s*\(|\bINDIRECT\s*\(/i.test(f)) drivers.push('dynamic reference (OFFSET/INDIRECT) — difficult to trace');
  if (/\bTODAY\s*\(|\bNOW\s*\(|\bRAND\s*\(/i.test(f)) drivers.push('volatile function — recalculates on every change');
  if (f.includes('[')) drivers.push('external workbook reference — broken-link risk');
  if (/\bIFERROR\s*\(|\bIFNA\s*\(/i.test(f)) drivers.push('error suppression — may hide real defects');
  if (/\bXLOOKUP\s*\(|\bVLOOKUP\s*\(|\bINDEX\s*\(/i.test(f)) drivers.push('lookup function — requires range and error-handling review');

  const ops = (f.match(/[+\-*/<>=&]/g) || []).length;
  if (ops > 10) drivers.push('high operator density');
  else if (ops > 5) drivers.push('moderate operator density');

  if (drivers.length === 0) return 'Low complexity — straightforward formula.';

  const prefix = {
    Critical: 'Critical complexity: ',
    High:     'High complexity: ',
    Moderate: 'Moderate complexity: ',
    Low:      'Low complexity: '
  }[band];

  return prefix + drivers.join(', ') + '.';
}

function classifyFormula(formula) {
  const f = formula || '';
  if (f.includes('[')) return 'Link';
  if (/\bIF\s*\(|\bIFS\s*\(|\bCHOOSE\s*\(|\bSWITCH\s*\(|\bAND\s*\(|\bOR\s*\(|\bNOT\s*\(/i.test(f)) return 'Logic';
  if (/\bXLOOKUP\s*\(|\bVLOOKUP\s*\(|\bHLOOKUP\s*\(|\bINDEX\s*\(|\bMATCH\s*\(/i.test(f)) return 'Lookup';
  if (/\bSUM\s*\(|\bSUMIF\s*\(|\bSUMIFS\s*\(|\bCOUNT\s*\(|\bCOUNTIF\s*\(|\bAVERAGE\s*\(/i.test(f)) return 'Aggregation';
  if (/\bDATE\s*\(|\bEOMONTH\s*\(|\bDAYS\s*\(|\bMONTH\s*\(|\bYEAR\s*\(|\bTODAY\s*\(|\bNOW\s*\(/i.test(f)) return 'Date';
  if (/\bNPV\s*\(|\bIRR\s*\(|\bXNPV\s*\(|\bXIRR\s*\(|\bPV\s*\(|\bFV\s*\(|\bPMT\s*\(/i.test(f)) return 'Valuation';
  if (/DSCR|LLCR|CFADS|debt.serv|interest|repay|drawdown/i.test(f)) return 'Debt';
  if (/tax|deprec|amort/i.test(f)) return 'Tax';
  if (/waterfall|distribut|prefer|hurdle|IRR|promote/i.test(f)) return 'Waterfall';
  if (/[+\-*/<>=]/.test(f)) return 'Arithmetic';
  return 'Other';
}

// Normalize a formula for UFI grouping —
// strip cell address offsets so identical logic patterns share a UFI
function normalizeFormula(formula) {
  if (!formula) return '';
  // Replace cell addresses like A1, $B$23, Sheet1!C4 with placeholders
  return formula
    .replace(/\$?[A-Z]{1,3}\$?[0-9]{1,7}/g, 'CELL')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

// Extract sheet names referenced in a formula
function extractPrecedentSheets(formula, allSheetNames) {
  if (!formula) return [];
  const refs = new Set();

  // Pattern: 'Sheet Name'!  or  SheetName!
  const quotedRefs = formula.match(/'([^']+)'/g) || [];
  quotedRefs.forEach(r => {
    const name = r.replace(/'/g, '');
    if (allSheetNames.includes(name)) refs.add(name);
  });

  const unquotedRefs = formula.match(/([A-Za-z_][A-Za-z0-9_. ]*)\!/g) || [];
  unquotedRefs.forEach(r => {
    const name = r.replace('!', '');
    if (allSheetNames.includes(name)) refs.add(name);
  });

  // External refs contain [
  if (formula.includes('[')) refs.add('[EXTERNAL]');

  return [...refs];
}

// ── Main Tier 0 runner ────────────────────────────────────────────────────────
async function runTier0(parsed) {
  if (!parsed._raw || parsed._type !== 'exceljs') {
    console.log('   ⚠️  Tier 0: no exceljs workbook available — skipping');
    return buildEmptyResult();
  }

  const wb = parsed._raw;
  const allSheetNames = parsed.sheetNames || [];
  const startTime = Date.now();

  console.log('   Scanning formula text across all sheets...');

  // ── Per-sheet statistics ──────────────────────────────────────────────────
  const sheetStats = {};
  // Formula map: target sheet → precedent sheet → link count
  const dependencyMap = {};
  // UFI map: normalized formula → UFI data
  const ufiMap = {};
  // Cell-level index: 'Sheet!Cell' -> { ufi, fscore, band, formulaText }
  const cellScoreIndex = {};
  // Risk accumulators
  let totalFormulaCells = 0;
  let totalValueCells   = 0;
  let totalIferrorCount = 0;
  let totalOffsetCount  = 0;
  let totalRefInFormula = 0;
  let totalExternalLinks = 0;
  let totalHardcodes    = 0;
  const externalLinkCells = [];
  const iferrorCells      = [];
  const offsetCells       = [];
  const refInFormulaCells = [];

  // F-score distribution
  const fscoreDist = { Low: 0, Moderate: 0, High: 0, Critical: 0 };
  let ufiCounter = 0;

  wb.eachSheet((ws, sheetId) => {
    const sheetName = ws.name;
    let formulaCount = 0;
    let valueCount   = 0;
    let iferrorCount = 0;
    let offsetCount  = 0;
    let refCount     = 0;
    let externalCount = 0;
    let hardcodeCount = 0;
    let maxRow = 0;
    let maxCol = 0;

    dependencyMap[sheetName] = dependencyMap[sheetName] || {};

    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum > maxRow) maxRow = rowNum;

      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        if (colNum > maxCol) maxCol = colNum;

        const formula = cell.formula
          ? (typeof cell.formula === 'object' ? cell.formula.formula : cell.formula)
          : null;

        if (formula) {
          formulaCount++;
          totalFormulaCells++;

          // Risk flags
          if (/\bIFERROR\s*\(|\bIFNA\s*\(|\bISERROR\s*\(/i.test(formula)) {
            iferrorCount++;
            totalIferrorCount++;
            if (iferrorCells.length < 20) {
              iferrorCells.push({ sheet: sheetName, cell: cell.address });
            }
          }

          if (/\bOFFSET\s*\(|\bINDIRECT\s*\(/i.test(formula)) {
            offsetCount++;
            totalOffsetCount++;
            if (offsetCells.length < 20) {
              offsetCells.push({ sheet: sheetName, cell: cell.address });
            }
          }

          if (formula.includes('[')) {
            externalCount++;
            totalExternalLinks++;
            externalLinkCells.push({ sheet: sheetName, cell: cell.address, formula: formula.substring(0, 80) });
          }

          if (formula.includes('#REF!') || formula.includes('#REF')) {
            refCount++;
            totalRefInFormula++;
            if (refInFormulaCells.length < 20) {
              refInFormulaCells.push({ sheet: sheetName, cell: cell.address });
            }
          }

          const hardcodes = formula.match(/(?<![A-Z0-9_])[2-9]\d*(?:\.\d+)?(?![A-Z0-9_])/gi) || [];
          if (hardcodes.length > 0) {
            hardcodeCount++;
            totalHardcodes++;
          }

          // Precedent sheet tracking for formula map
          const precedents = extractPrecedentSheets(formula, allSheetNames);
          precedents.forEach(prec => {
            if (prec !== sheetName && prec !== '[EXTERNAL]') {
              dependencyMap[sheetName][prec] = (dependencyMap[sheetName][prec] || 0) + 1;
            }
          });

          // UFI grouping
          const normalized = normalizeFormula(formula);
          if (!ufiMap[normalized]) {
            ufiCounter++;
            const fscore = scoreFormula(formula);
            const band   = complexityBand(fscore);
            const expl   = complexityExplanation(formula, fscore, band);
            fscoreDist[band]++;
            ufiMap[normalized] = {
              ufi:              `UF-${String(ufiCounter).padStart(4, '0')}`,
              sheet:            sheetName,
              cell:             cell.address,
              formulaText:      formula.length > 500 ? formula.substring(0, 500) + '...' : formula,
              fscore,
              band,
              explanation:      expl,
              formulaClass:     classifyFormula(formula),
              externalLinkFlag: formula.includes('['),
              volatileFlag:     /\bOFFSET\s*\(|\bINDIRECT\s*\(|\bTODAY\s*\(|\bNOW\s*\(|\bRAND\s*\(/i.test(formula),
              hardcodeFlag:     hardcodes.length > 0,
              iferrorFlag:      /\bIFERROR\s*\(|\bIFNA\s*\(|\bISERROR\s*\(/i.test(formula),
              crossSheetRefs:   precedents.filter(p => p !== '[EXTERNAL]').length,
              precedentSheets:  precedents.join(', '),
              instanceCount:    1,
              status:           'OK',
              reviewerComment:  ''
            };
          } else {
            ufiMap[normalized].instanceCount++;
          }

          // Cell-level F-score index — maps every individual cell to its
          // formula's F-score, band and UFI. This is what the report builder
          // uses to look up F-score by exact sheet+cell for any finding,
          // since a finding's cell is rarely the UFI's first-seen cell.
          const cellKey = `${sheetName}!${cell.address}`;
          cellScoreIndex[cellKey] = {
            ufi:      ufiMap[normalized].ufi,
            fscore:   ufiMap[normalized].fscore,
            band:     ufiMap[normalized].band,
            formulaText: formula.length > 300 ? formula.substring(0, 300) + '...' : formula
          };

        } else {
          // Value cell
          const v = cell.value;
          if (v !== null && v !== undefined && v !== '') {
            valueCount++;
            totalValueCells++;
          }
        }
      });
    });

    sheetStats[sheetName] = {
      formulaCount,
      valueCount,
      iferrorCount,
      offsetCount,
      refCount,
      externalCount,
      hardcodeCount,
      maxRow,
      maxCol,
      usedRange: `${maxRow} rows × ${maxCol} cols`
    };
  });

  // ── Build formula map edge list ───────────────────────────────────────────
  const edgeList = [];
  for (const [target, precs] of Object.entries(dependencyMap)) {
    for (const [precedent, linkCount] of Object.entries(precs)) {
      // Classify direction
      let direction = 'Normal';
      // Output/dashboard sheets feeding into calculation sheets = forward reference risk
      const outputSheets = ['Dashboard', 'Operational Dashboard', 'Graphs', 'Summary', 'Overview'];
      const calcSheets   = ['IFS', 'AFS', 'Cons', 'Ops', 'Debt', 'D&T', 'Leases'];
      if (outputSheets.some(s => precedent.toLowerCase().includes(s.toLowerCase())) &&
          calcSheets.some(s => target.toLowerCase().includes(s.toLowerCase()))) {
        direction = 'Backward';
      } else if (calcSheets.some(s => precedent.toLowerCase().includes(s.toLowerCase())) &&
                 outputSheets.some(s => target.toLowerCase().includes(s.toLowerCase()))) {
        direction = 'Normal';
      }

      // Dependency risk
      let risk = 'Low';
      if (linkCount > 500) risk = 'High';
      else if (linkCount > 100) risk = 'Moderate';
      if (direction === 'Backward') risk = 'High';

      edgeList.push({
        targetSheet:    target,
        precedentSheet: precedent,
        linkCount,
        direction,
        risk,
        reviewerNote:   ''
      });
    }
  }

  // Sort edge list: risk desc, then link count desc
  const riskOrder = { Critical: 0, High: 1, Moderate: 2, Low: 3 };
  edgeList.sort((a, b) =>
    (riskOrder[a.risk] - riskOrder[b.risk]) || (b.linkCount - a.linkCount)
  );

  // ── Build unique formula list sorted by F-score desc ─────────────────────
  const uniqueFormulas = Object.values(ufiMap)
    .sort((a, b) => b.fscore - a.fscore);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const highCritCount = fscoreDist.High + fscoreDist.Critical;

  console.log(`   Tier 0 complete in ${elapsed}s:`);
  console.log(`   Formula cells: ${totalFormulaCells.toLocaleString()} | Unique formulas: ${uniqueFormulas.length}`);
  console.log(`   IFERROR: ${totalIferrorCount.toLocaleString()} | OFFSET: ${totalOffsetCount.toLocaleString()} | External links: ${totalExternalLinks}`);
  console.log(`   F-score: ${fscoreDist.Low} Low · ${fscoreDist.Moderate} Moderate · ${fscoreDist.High} High · ${fscoreDist.Critical} Critical`);
  if (highCritCount > 0) {
    console.log(`   ⚠️  ${highCritCount} High/Critical complexity formula(s) found`);
  }
  if (totalExternalLinks > 0) {
    console.log(`   ⚠️  ${totalExternalLinks} external workbook link(s) found`);
  }

  return {
    // Cell-level F-score lookup — Sheet!Cell -> { ufi, fscore, band, formulaText }
    cellScoreIndex,
    // Summary statistics
    stats: {
      totalFormulaCells,
      totalValueCells,
      totalIferrorCount,
      totalOffsetCount,
      totalRefInFormula,
      totalExternalLinks,
      totalHardcodes,
      uniqueFormulaCount: uniqueFormulas.length,
      sheetCount:         allSheetNames.length,
      fscoreDist
    },
    // Per-sheet breakdown
    sheetStats,
    // UFI list sorted by F-score
    uniqueFormulas,
    // Sheet dependency edge list
    edgeList,
    // Dependency matrix (target → precedent → count)
    dependencyMap,
    // Risk indicator cell lists
    riskIndicators: {
      externalLinkCells,
      iferrorCells,
      offsetCells,
      refInFormulaCells
    },
    elapsed
  };
}

function buildEmptyResult() {
  return {
    cellScoreIndex: {},
    stats: {
      totalFormulaCells: 0, totalValueCells: 0,
      totalIferrorCount: 0, totalOffsetCount: 0,
      totalRefInFormula: 0, totalExternalLinks: 0,
      totalHardcodes: 0, uniqueFormulaCount: 0,
      sheetCount: 0,
      fscoreDist: { Low: 0, Moderate: 0, High: 0, Critical: 0 }
    },
    sheetStats: {},
    uniqueFormulas: [],
    edgeList: [],
    dependencyMap: {},
    riskIndicators: {
      externalLinkCells: [],
      iferrorCells: [],
      offsetCells: [],
      refInFormulaCells: []
    },
    elapsed: '0.0'
  };
}

module.exports = { runTier0, scoreFormula, complexityBand, complexityExplanation };
