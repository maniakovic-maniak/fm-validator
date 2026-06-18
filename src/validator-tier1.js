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

    // ── Formula errors — grouped by sheet, flag-only, never fix ─────────────
    if (rule.type === 'no_formula_errors') {
      if (parsed._raw && parsed._type === 'exceljs') {
        const errors = scanFormulaErrors(parsed._raw);

        if (errors.length === 0) {
          results.push({
            id: rule.id, label: rule.label, severity: 'critical',
            status: 'pass', fixable: false,
            fix_instruction: rule.fix_instruction, reason: null
          });
        } else {
          // Group by sheet — one finding per sheet, not per cell
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
              sheet,
              cell: data.cells[0] || 'A1',
              type: 'formula_error',
              severity: 'critical',
              status: 'fail',
              fixable: false,
              fix_instruction: 'Investigate and correct at source. Never replace with a hardcoded value or mask with IFERROR. Identify the root cause: broken link, missing reference, division by zero, or lookup failure.',
              reason: `${data.cells.length} formula error(s) in ${sheet}: ${cellList}`
            });
          }
        }
      }
    }

    // ── No negative values (e.g. PP&E) ──────────────────────────────────────
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
      }
    }
  }

  return results;
}

module.exports = { runTier1 };
