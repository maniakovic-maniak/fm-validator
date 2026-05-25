const checklist = require('../config/checklist.json');

function runTier1(parsed) {
  const results = [];

  for (const rule of checklist.tier1) {
    if (rule.type === 'sheet_exists') {
      const missing = rule.sheets.filter(
        s => !parsed.sheetNames.map(n => n.trim()).includes(s)
      );
      results.push({
        id: rule.id,
        label: rule.label,
        status: missing.length === 0 ? 'pass' : 'fail',
        fixable: rule.fixable,
        fix_instruction: rule.fix_instruction,
        reason: missing.length === 0 ? null : `Missing: ${missing.join(', ')}`
      });
    }

    if (rule.type === 'sheet_empty') {
      const sheet = parsed.sheets[rule.sheet];
      const isEmpty = !sheet || sheet.length === 0;
      results.push({
        id: rule.id,
        label: rule.label,
        sheet: rule.sheet,
        status: isEmpty ? 'pass' : 'fail',
        fixable: rule.fixable,
        fix_instruction: rule.fix_instruction,
        reason: isEmpty ? null : `Sheet "${rule.sheet}" has content — review required`
      });
    }

    if (rule.type === 'no_formula_errors') {
      const raw = parsed._raw;
      if (raw) {
        const ERRORS = ['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NULL!', '#NUM!'];
        for (const sheetName of parsed.sheetNames) {
          const sheet = raw.Sheets[sheetName];
          if (!sheet) continue;
          for (const [addr, cell] of Object.entries(sheet)) {
            if (addr.startsWith('!')) continue;
            if (cell && cell.w && ERRORS.some(e => String(cell.w).includes(e))) {
              results.push({
                id: `${rule.id}-${sheetName}-${addr}`,
                label: `Formula error in ${sheetName} ${addr}`,
                sheet: sheetName,
                cell: addr,
                type: 'formula_error',
                status: 'fail',
                fixable: true,
                fix_instruction: 'Replace error with 0',
                reason: `${cell.w} in ${sheetName} cell ${addr}`
              });
            }
          }
        }
      }
    }
  }

  return results;
}

module.exports = { runTier1 };
