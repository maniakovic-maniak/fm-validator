const checklist = require('../config/checklist.json');
const { scanFormulaErrors } = require('./parser');

function runTier1(parsed) {
  const results = [];

  for (const rule of checklist.tier1) {

    // ── Flexible sheet existence check ──────────────────────────────────────
    if (rule.type === 'sheet_exists_flexible') {
      const sheetNamesClean = parsed.sheetNames.map(n => n.trim());
      const known = rule.sheets_known || [];
      const matched = sheetNamesClean.filter(name =>
        known.some(k =>
          name.toLowerCase().includes(k.toLowerCase()) ||
          k.toLowerCase().includes(name.toLowerCase())
        )
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
      const missing = (rule.sheets || []).filter(
        s => !parsed.sheetNames.map(n => n.trim()).includes(s)
      );
      results.push({
        id: rule.id, label: rule.label, severity: rule.severity || 'high',
        status: missing.length === 0 ? 'pass' : 'fail',
        fixable: rule.fixable, fix_instruction: rule.fix_instruction,
        reason: missing.length === 0 ? null : `Missing: ${missing.join(', ')}`
      });
    }

    // ── Sheet must be empty (e.g. Model Issues tab) ──────────────────────────
    if (rule.type === 'sheet_empty') {
      const sheet = parsed.sheets[rule.sheet];
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
      const sheetName = rule.sheet;
      const keyword = (rule.keyword || '').toLowerCase();
      const ws = parsed._raw && parsed._type === 'exceljs'
        ? parsed._raw.getWorksheet(sheetName)
        : null;

      if (ws) {
        let found = false;
        ws.eachRow({ includeEmpty: false }, (row) => {
          const firstCell = row.getCell(1);
          const label = firstCell.text ? firstCell.text.toLowerCase() : '';
          if (keyword && !label.includes(keyword)) return;
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
        if (!found) {
          results.push({
            id: rule.id, label: rule.label, severity: rule.severity || 'high',
            status: 'pass', fixable: false,
            fix_instruction: rule.fix_instruction, reason: null
          });
        }
      } else {
        // Sheet not found — pass silently (not all models have AFS)
        results.push({
          id: rule.id, label: rule.label, severity: rule.severity || 'high',
          status: 'pass', fixable: false,
          fix_instruction: rule.fix_instruction,
          reason: null
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
      const sheetNamesClean = parsed.sheetNames.map(n => n.trim().toLowerCase());
      const flagSheets = ['timing', 'flags', 'timeline', 'inputs', 'assumptions'];
      const found = flagSheets.some(s => sheetNamesClean.includes(s));
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
          if (!flagSheets.includes(name.trim().toLowerCase())) continue;
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

  return results;
}

module.exports = { runTier1 };
