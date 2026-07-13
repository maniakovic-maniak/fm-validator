const checklist = require('../config/checklist.json');
const { resolveSheetName, resolveAny } = require('./utils/sheet-resolver');
const { scanFormulaErrors } = require('./parser');

// Safe keyword match for sheet-name checks — short/ambiguous keywords need
// a word boundary or they false-match inside unrelated longer names.
// Confirmed real: 'Cons' (from T1-002's sheets_known list) matching
// 'Construction Timeline' on a real production file — the same bug found
// and fixed in validator-tier0.js, validator-tier2.js, classifier.js, and
// utils/sheet-linkage.js this session. This instance is more consequential
// than the others: T1-002 is a fatal gate (minimum sheet structure
// present), so a false match here could in principle let a genuinely
// malformed or wrong file pass a check specifically designed to catch it,
// rather than just contributing noise to one finding.
function sheetNameMatchesKeyword(sheetName, keyword) {
  const kwLower = keyword.toLowerCase();
  if (kwLower.length <= 6) {
    const re = new RegExp('(?<![a-z0-9])' + kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i');
    return re.test(sheetName);
  }
  return sheetName.toLowerCase().includes(kwLower) || kwLower.includes(sheetName.toLowerCase());
}

function runTier1(parsed) {
  const results = [];

  for (const rule of checklist.tier1) {

    // ── Flexible sheet existence check ──────────────────────────────────────
    if (rule.type === 'sheet_exists_flexible') {
      const sheetNamesClean = parsed.sheetNames.map(n => n.trim());
      const known = rule.sheets_known || [];
      const matched = sheetNamesClean.filter(name =>
        known.some(k => sheetNameMatchesKeyword(name, k))
      );
      const minCount = rule.sheets_minimum_count || 2;
      const passed = matched.length >= minCount;
      results.push({
        id: rule.id, label: rule.label, severity: rule.severity || 'high',
        status: passed ? 'pass' : 'fail',
        fixable: rule.fixable, fix_instruction: rule.fix_instruction,
        reason: passed ? null : `Only ${matched.length} recognisable financial sheet(s) found. Sheets: ${sheetNamesClean.join(', ')}`
      });
    }

    // ── Exact sheet existence check ──────────────────────────────────────────
    if (rule.type === 'sheet_exists') {
      // Pass if ANY of the listed sheets exists (OR logic — at least one must be present)
      const found = (rule.sheets || []).find(s => resolveSheetName(s, parsed.sheetNames));
      results.push({
        id: rule.id, label: rule.label, severity: rule.severity || 'high',
        status: found ? 'pass' : 'fail',
        fixable: rule.fixable, fix_instruction: rule.fix_instruction,
        reason: found ? null : `None of the expected sheets found: ${(rule.sheets||[]).join(', ')}`
      });
    }

    // ── Sheet must be empty (e.g. Model Issues tab) ──────────────────────────
    if (rule.type === 'sheet_empty') {
      const resolvedSheet = resolveSheetName(rule.sheet, parsed.sheetNames);
      const sheet = resolvedSheet ? parsed.sheets[resolvedSheet] : null;
      const isEmpty = !sheet || sheet.length === 0;
      results.push({
        id: rule.id, label: rule.label, sheet: rule.sheet,
        severity: rule.severity || 'high',
        status: isEmpty ? 'pass' : 'fail',
        fixable: rule.fixable, fix_instruction: rule.fix_instruction,
        reason: isEmpty ? null : `Sheet "${rule.sheet}" has content — review and resolve all items`
      });
    }

    // ── Formula errors — grouped by sheet, flag-only ─────────────────────────
    if (rule.type === 'no_formula_errors') {
      if (parsed._raw && parsed._type === 'exceljs') {
        const errors = scanFormulaErrors(parsed._raw);
        if (errors.length === 0) {
          results.push({
            id: rule.id, label: rule.label, severity: rule.severity || 'fatal',
            status: 'pass', fixable: false,
            fix_instruction: rule.fix_instruction, reason: null
          });
        } else {
          const bySheet = {};
          errors.forEach(({ sheet, cell, error }) => {
            if (!bySheet[sheet]) bySheet[sheet] = { cells: [], errors: new Set() };
            bySheet[sheet].cells.push(cell);
            bySheet[sheet].errors.add(error);
          });
          for (const [sheet, data] of Object.entries(bySheet)) {
            const cellList = data.cells.slice(0, 5).join(', ') +
              (data.cells.length > 5 ? ` (+${data.cells.length - 5} more)` : '');
            results.push({
              id: `${rule.id}-${sheet}`,
              label: `Formula errors in ${sheet}: ${[...data.errors].join(', ')}`,
              sheet, cell: data.cells[0] || 'A1',
              type: 'formula_error', severity: rule.severity || 'fatal',
              status: 'fail', fixable: false,
              fix_instruction: rule.fix_instruction,
              reason: `${data.cells.length} formula error(s) in ${sheet}: ${cellList}`
            });
          }
        }
      }
    }

    // ── No negative values (e.g. PP&E, Cash) ────────────────────────────────
    if (rule.type === 'no_negative_values') {
      // rule.sheet may be a single string (legacy) or an array of
      // candidate aliases, tried in order — same reasoning as
      // sheet_exists_flexible and the deep-accounting fix in
      // validator-tier2.js: a single hardcoded name like 'AFS' doesn't
      // generalise beyond mining-style models.
      const sheetCandidates = Array.isArray(rule.sheet) ? rule.sheet : [rule.sheet];
      let resolvedNegSheet = null;
      for (const candidate of sheetCandidates) {
        resolvedNegSheet = resolveSheetName(candidate, parsed.sheetNames);
        if (resolvedNegSheet) break;
      }
      const sheetName = resolvedNegSheet || sheetCandidates[0];
      const keyword = (rule.keyword || '').toLowerCase();
      const ws = parsed._raw && parsed._type === 'exceljs' && resolvedNegSheet
        ? parsed._raw.getWorksheet(resolvedNegSheet)
        : null;

      if (ws) {
        let found = false;
        let anyRowMatchedKeyword = false;
        ws.eachRow({ includeEmpty: false }, (row) => {
          const firstCell = row.getCell(1);
          const label = firstCell.text ? firstCell.text.toLowerCase() : '';
          if (keyword && !label.includes(keyword)) return;
          anyRowMatchedKeyword = true;
          row.eachCell({ includeEmpty: false }, (cell, colNum) => {
            if (colNum === 1) return;
            const val = typeof cell.value === 'number' ? cell.value
              : (cell.value && typeof cell.value === 'object' && typeof cell.value.result === 'number')
                ? cell.value.result : null;
            if (val !== null && val < 0 && !found) {
              results.push({
                id: `${rule.id}-${sheetName}-${cell.address}`,
                label: `Negative ${rule.keyword} value in ${sheetName} ${cell.address}`,
                sheet: sheetName, cell: cell.address,
                severity: rule.severity || 'high',
                status: 'fail', fixable: false,
                fix_instruction: rule.fix_instruction,
                reason: `Negative value ${val} found in ${sheetName} cell ${cell.address}`
              });
              found = true;
            }
          });
        });
        if (!found && anyRowMatchedKeyword) {
          results.push({
            id: rule.id, label: rule.label, severity: rule.severity || 'high',
            status: 'pass', fixable: false,
            fix_instruction: rule.fix_instruction, reason: null
          });
        } else if (!found && !anyRowMatchedKeyword) {
          // The sheet resolved, but no row's first-column label contained
          // the target keyword — this check found nothing to evaluate,
          // which is a materially different (and much weaker) outcome
          // than "checked every matching row and found no negative
          // values". Reporting 'pass' here has exactly the same
          // false-assurance problem as the unresolved-sheet case above.
          results.push({
            id: rule.id, label: rule.label, severity: rule.severity || 'high',
            status: 'uncertain', fixable: false,
            fix_instruction: rule.fix_instruction,
            reason: `Found "${sheetName}" but no row labelled with "${rule.keyword}" in column A — this check requires manual verification.`
          });
        }
      } else {
        // None of the candidate sheet names could be found — this check
        // genuinely could not run, and that is a materially different
        // outcome from "checked, found nothing negative". Reporting
        // 'pass' here would tell a reader this fatal-severity gate was
        // verified clean when in fact zero verification occurred —
        // confirmed as a live, false-assurance issue on a real report.
        // 'uncertain' preserves the original intent (don't hard-reject a
        // valid model just because it uses different sheet naming)
        // without fabricating a check that never happened.
        results.push({
          id: rule.id, label: rule.label, severity: rule.severity || 'high',
          status: 'uncertain', fixable: false,
          fix_instruction: rule.fix_instruction,
          reason: `Could not locate a sheet matching any of: ${sheetCandidates.join(', ')}. This check requires manual verification that no negative ${rule.keyword || 'value'} exists anywhere it should not.`
        });
      }
    }

    // ── No external workbook links ───────────────────────────────────────────
    // exceljs does not expose external link data directly from cell values.
    // We scan for cell values containing '[' which is the Excel external ref marker.
    // This is a best-effort check — formula text inspection required for full coverage.
    if (rule.type === 'no_external_links') {
      if (parsed._raw && parsed._type === 'exceljs') {
        const externalRefs = [];
        parsed._raw.eachSheet(ws => {
          ws.eachRow({ includeEmpty: false }, row => {
            row.eachCell({ includeEmpty: false }, cell => {
              if (cell.formula && typeof cell.formula === 'string' && cell.formula.includes('[')) {
                externalRefs.push({ sheet: ws.name, cell: cell.address, formula: cell.formula.substring(0, 60) });
              }
            });
          });
        });
        if (externalRefs.length === 0) {
          results.push({
            id: rule.id, label: rule.label, severity: rule.severity || 'fatal',
            status: 'pass', fixable: false, fix_instruction: rule.fix_instruction, reason: null
          });
        } else {
          const bySheet = {};
          externalRefs.forEach(({ sheet, cell }) => {
            if (!bySheet[sheet]) bySheet[sheet] = [];
            bySheet[sheet].push(cell);
          });
          for (const [sheet, cells] of Object.entries(bySheet)) {
            const cellList = cells.slice(0, 3).join(', ') + (cells.length > 3 ? ` (+${cells.length - 3} more)` : '');
            results.push({
              id: `${rule.id}-${sheet}`,
              label: `External workbook links found in ${sheet}`,
              sheet, cell: cells[0] || 'A1',
              severity: rule.severity || 'fatal',
              status: 'fail', fixable: false,
              fix_instruction: rule.fix_instruction,
              reason: `${cells.length} external link(s) in ${sheet}: ${cellList}`
            });
          }
        }
      } else {
        // Cannot check without exceljs — return uncertain
        results.push({
          id: rule.id, label: rule.label, severity: rule.severity || 'fatal',
          status: 'uncertain', fixable: false, fix_instruction: rule.fix_instruction,
          reason: 'External link detection requires exceljs workbook. Cannot verify from current parser state.'
        });
      }
    }


    // ── Workbook opens without repair warnings ────────────────────────────────
    // exceljs will throw during parse if the file is corrupt.
    // If we reach this point the workbook opened cleanly.
    // Return pass with a note that this is a best-effort check.
    if (rule.type === 'workbook_opens_clean') {
      results.push({
        id: rule.id, label: rule.label, severity: rule.severity || 'fatal',
        status: 'pass', fixable: false,
        fix_instruction: rule.fix_instruction,
        reason: 'Workbook opened without errors — no corruption detected by parser. Note: Excel repair warnings can only be fully verified by opening the file in Excel directly.'
      });
    }

    // ── No circular references ────────────────────────────────────────────────
    // exceljs does not expose circular reference detection directly.
    // Return uncertain with guidance for manual verification.
    if (rule.type === 'no_circular_references') {
      results.push({
        id: rule.id, label: rule.label, severity: rule.severity || 'fatal',
        status: 'uncertain', fixable: false,
        fix_instruction: rule.fix_instruction,
        reason: 'Circular reference detection requires Excel formula evaluation. Manual verification required: open the file in Excel and check Formulas → Error Checking → Circular References. Intentional circular references must be documented on the Inputs sheet.'
      });
    }

    // ── Actuals forecast flags exclusive (T1-012) ─────────────────────────────
    // Same logic as actuals_forecast_separated but checks for mutual exclusivity
    if (rule.type === 'actuals_forecast_flags_exclusive') {
      const flagSheets = ['timing', 'flags', 'timeline', 'inputs', 'assumptions'];
      const foundFlagSheet = resolveAny(flagSheets, parsed.sheetNames);
      const found = !!foundFlagSheet;
      if (!found) {
        results.push({
          id: rule.id, label: rule.label, severity: rule.severity || 'fatal',
          status: 'uncertain', fixable: false,
          fix_instruction: rule.fix_instruction,
          reason: 'No Timing or flag sheet found. Mutual exclusivity of actual/forecast flags cannot be verified automatically — manual inspection required.'
        });
      } else {
        results.push({
          id: rule.id, label: rule.label, severity: rule.severity || 'fatal',
          status: 'uncertain', fixable: false,
          fix_instruction: rule.fix_instruction,
          reason: 'Flag sheet exists but mutual exclusivity of actual/forecast flags requires formula inspection. Verify in Excel that no column is flagged as both actual and forecast.'
        });
      }
    }

    // ── Actuals and forecast separated by flags ──────────────────────────────
    // Check for a Timing or flag sheet with an actual/forecast switch row.
    // This is a presence check — full verification requires formula inspection.
    if (rule.type === 'actuals_forecast_separated') {
      const sheetNamesClean = parsed.sheetNames.map(n => n.trim().toLowerCase());
      const flagSheets = ['timing', 'flags', 'timeline', 'inputs', 'assumptions'];
      const found = flagSheets.some(s => sheetNamesClean.includes(s));

      if (!found) {
        results.push({
          id: rule.id, label: rule.label, severity: rule.severity || 'fatal',
          status: 'fail', fixable: false, fix_instruction: rule.fix_instruction,
          reason: 'No Timing, Flags, or Inputs sheet found. Actuals/forecast separation cannot be verified.'
        });
      } else {
        // Check if any of the candidate sheets have a row mentioning actual/forecast
        let hasFlag = false;
        for (const name of parsed.sheetNames) {
          if (!resolveAny(flagSheets, [name])) continue;
          const rows = parsed.sheets[name] || [];
          for (const row of rows.slice(0, 30)) {
            const vals = Object.values(row).map(v => String(v || '').toLowerCase());
            if (vals.some(v => v.includes('actual') || v.includes('forecast') || v.includes('flag'))) {
              hasFlag = true;
              break;
            }
          }
          if (hasFlag) break;
        }
        results.push({
          id: rule.id, label: rule.label, severity: rule.severity || 'fatal',
          status: hasFlag ? 'pass' : 'uncertain', fixable: false,
          fix_instruction: rule.fix_instruction,
          reason: hasFlag ? null : 'Timing sheet exists but no actual/forecast flag row detected in first 30 rows. Manual verification required.'
        });
      }
    }

  }

  // ── Deterministic root-cause attribution ──────────────────────────────────
  // Tier 1 checks are mechanical, so their root cause maps directly from the
  // rule type — no LLM judgement needed. Keeps the Issue Log's Root Cause
  // column complete for every finding, not just Tier 2's.
  const ROOT_CAUSE_BY_TYPE = {
    no_formula_errors:          'Broken reference / formula error',
    sheet_exists:               'Missing model structure',
    sheet_exists_flexible:      'Missing model structure',
    sheet_empty:                'Unresolved prior review items',
    no_negative_values:         'Sign or balance error',
    no_external_links:          'External dependency',
    workbook_opens_clean:       'File integrity issue',
    no_circular_references:     'Circular reference',
    actuals_forecast_separated: 'Period flag misconfiguration'
  };
  const typeById = Object.fromEntries(checklist.tier1.map(r => [r.id, r.type]));
  for (const r of results) {
    if (r.status !== 'pass' && !r.root_cause) {
      // Failure ids may carry a per-sheet suffix (e.g. T1-001-Graphs) —
      // match on the base rule id.
      const baseId = (r.id || '').split('-').slice(0, 2).join('-');
      r.root_cause = ROOT_CAUSE_BY_TYPE[typeById[baseId]] || 'Structural check failure';
    }
  }

  return results;
}

module.exports = { runTier1 };
