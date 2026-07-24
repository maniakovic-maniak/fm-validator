const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

/**
 * Validator Runner - Executes checklist validations on Excel files
 */

class ValidatorRunner {
  constructor(checklistPath = null) {
    this.checklistPath = checklistPath || path.join(__dirname, '../checklists/checklist.json');
    this.checklist = this.loadChecklist();
  }

  loadChecklist() {
    try {
      const content = fs.readFileSync(this.checklistPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error('Failed to load checklist:', error.message);
      throw new Error('Checklist not found or invalid JSON');
    }
  }

  /**
   * Run validation on an Excel file
   * @param {string} filePath - Path to the Excel file
   * @returns {object} Validation results
   */
  async validate(filePath) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);

      const results = {
        timestamp: new Date().toISOString(),
        fileName: path.basename(filePath),
        fileSize: fs.statSync(filePath).size,
        checklist: this.checklist.name,
        status: 'completed',
        results: {
          passed: [],
          failed: [],
          warnings: []
        },
        stats: {
          total: 0,
          passed: 0,
          failed: 0,
          passRate: 0
        }
      };

      // Run Tier 1 (Critical) checks
      if (this.checklist.tier1) {
        this.runTier(workbook, this.checklist.tier1, results, 'tier1');
      }

      // Run Tier 2 (Financial Integrity) checks
      if (this.checklist.tier2) {
        this.runTier(workbook, this.checklist.tier2, results, 'tier2');
      }

      // Calculate statistics
      results.stats.total = results.results.passed.length + results.results.failed.length;
      results.stats.passed = results.results.passed.length;
      results.stats.failed = results.results.failed.length;
      results.stats.passRate = results.stats.total > 0 
        ? Math.round((results.stats.passed / results.stats.total) * 100)
        : 0;

      return results;
    } catch (error) {
      return {
        timestamp: new Date().toISOString(),
        fileName: path.basename(filePath),
        status: 'error',
        error: error.message,
        results: {
          passed: [],
          failed: [],
          warnings: [{ id: 'ERR-001', label: 'Validation Error', message: error.message }]
        },
        stats: {
          total: 0,
          passed: 0,
          failed: 0,
          passRate: 0
        }
      };
    }
  }

  /**
   * Run a tier of checks
   */
  runTier(workbook, tier, results, tierName) {
    tier.forEach(check => {
      const checkResult = this.evaluateCheck(workbook, check);
      
      const resultItem = {
        id: check.id,
        label: check.label,
        description: check.description || '',
        tier: tierName,
        type: check.type,
        fixable: check.fixable || false
      };

      if (checkResult.passed) {
        resultItem.status = 'passed';
        results.results.passed.push(resultItem);
      } else {
        resultItem.status = 'failed';
        resultItem.message = checkResult.message;
        resultItem.details = checkResult.details;
        results.results.failed.push(resultItem);
      }
    });
  }

  /**
   * Evaluate a single check
   */
  evaluateCheck(workbook, check) {
    try {
      switch (check.type) {
        case 'sheet_exists':
          return this.checkSheetsExist(workbook, check);
        case 'no_formula_errors':
          return this.checkNoFormulaErrors(workbook, check);
        case 'sheet_empty':
          return this.checkSheetEmpty(workbook, check);
        default:
          return { passed: true, message: 'Check type not yet implemented' };
      }
    } catch (error) {
      return { passed: false, message: error.message };
    }
  }

  /**
   * Check if required sheets exist
   */
  checkSheetsExist(workbook, check) {
    const missingSheets = [];
    const sheets = check.sheets || [];
    const sheetNames = workbook.worksheets.map(ws => ws.name);

    sheets.forEach(sheetName => {
      if (!sheetNames.includes(sheetName)) {
        missingSheets.push(sheetName);
      }
    });

    return {
      passed: missingSheets.length === 0,
      message: missingSheets.length === 0 
        ? 'All required sheets present'
        : `Missing sheets: ${missingSheets.join(', ')}`,
      details: { missingSheets, requiredSheets: sheets }
    };
  }

  /**
   * Check for Excel formula errors (#REF, #NAME, #VALUE, etc.)
   */
  checkNoFormulaErrors(workbook, check) {
    const errors = [];
    // FIX: was /#NAME?/ -- '?' is a regex quantifier, unescaped it makes
    // the preceding 'E' optional rather than matching a literal '?'
    // character, so this pattern actually matched "#NAM" (with or
    // without a trailing 'E'), not the literal Excel error string
    // "#NAME?". Confirmed real across every bug-scan run this session.
    const errorPatterns = [/#REF!/, /#NAME\?/, /#VALUE!/, /#DIV\/0!/, /#NUM!/, /#N\/A/, /#NULL!/];

    // FIX: found via a real bug-scan run. ExcelJS represents a formula
    // cell that evaluates to an error as an object (e.g.
    // { formula, result: { error: '#DIV/0!' } }), not a plain string —
    // String(cell.value) on such an object previously produced the
    // literal text "[object Object]", so a real formula error in a
    // formula cell was never actually detected here; this check only
    // ever caught an error that happened to be typed as literal text.
    // Mirrors src/parser.js's own established cellErrorValue() helper
    // (kept self-contained here rather than importing across
    // directories, since this module isn't wired into the active
    // pipeline and isn't meant to depend on src/).
    const extractCellText = (cell) => {
      const v = cell.value;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        if (typeof v.error === 'string') return v.error;
        if (v.result && typeof v.result === 'object' && typeof v.result.error === 'string') return v.result.error;
        if (typeof v.result === 'string') return v.result;
        return ''; // some other object shape (e.g. a hyperlink) -- not a formula-error, don't stringify it as "[object Object]"
      }
      return v ? String(v) : '';
    };

    workbook.worksheets.forEach(worksheet => {
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          const cellValue = extractCellText(cell);
          errorPatterns.forEach(pattern => {
            if (pattern.test(cellValue)) {
              errors.push({ sheet: worksheet.name, cell: cell.address, value: cellValue });
            }
          });
        });
      });
    });

    return {
      passed: errors.length === 0,
      message: errors.length === 0 
        ? 'No formula errors detected'
        : `Found ${errors.length} formula error(s)`,
      details: { errors }
    };
  }

  /**
   * Check if a specific sheet is empty
   */
  checkSheetEmpty(workbook, check) {
    const sheetName = check.sheet;
    const worksheet = workbook.getWorksheet(sheetName);

    if (!worksheet) {
      return { passed: true, message: `Sheet "${sheetName}" does not exist` };
    }

    // Count non-empty cells
    let cellCount = 0;
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value) cellCount++;
      });
    });

    return {
      passed: cellCount === 0,
      message: cellCount === 0 
        ? `Sheet "${sheetName}" is empty`
        : `Sheet "${sheetName}" contains ${cellCount} cells with data`,
      details: { sheetName, cellCount }
    };
  }
}

module.exports = ValidatorRunner;
