/**
 * ICAEW Financial Modelling Code — Tier 1 gap-fill handlers
 * ----------------------------------------------------------
 * Six new deterministic Tier 1 test types (T1-013 .. T1-018), written
 * against the ExcelJS API. Wire each into validator-tier1.js's existing
 * switch/dispatch on `rule.type`, alongside the current handlers for
 * no_formula_errors, sheet_exists_flexible, no_circular_references, etc.
 *
 * Each function takes (workbook, rule) and returns the same result shape
 * your existing Tier 1 handlers use — adjust `buildResult(...)` to match
 * whatever helper validator-tier1.js already exports/uses internally.
 * A generic fallback result builder is included at the bottom in case one
 * isn't already shared.
 */

// ---------------------------------------------------------------------
// T1-013 — no_hidden_calc_rows_columns
// ICAEW: "Don't hide things" — hidden rows/columns are easily missed and
// easy to change or delete inadvertently. Exception: hiding fully empty
// columns/rows beyond the used range (navigation aid) is not flagged.
// ---------------------------------------------------------------------
function checkHiddenCalcRowsColumns(workbook, rule) {
  const findings = [];

  workbook.eachSheet((worksheet) => {
    const usedRange = worksheet.dimensions; // { top, left, bottom, right } or similar per ExcelJS version
    if (!usedRange) return;

    // Rows
    worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (!row.hidden) return;
      if (rowNumber > usedRange.bottom) return; // beyond used range — allowed
      const hasContent = rowHasFormulaOrValue(row);
      if (hasContent) {
        findings.push({
          sheet: worksheet.name,
          location: `Row ${rowNumber}`,
          detail: 'Hidden row contains formulas or values within the used range.',
        });
      }
    });

    // Columns
    worksheet.columns?.forEach((col, idx) => {
      const colNumber = idx + 1;
      if (!col.hidden) return;
      if (colNumber > usedRange.right) return; // beyond used range — allowed
      const hasContent = columnHasFormulaOrValue(worksheet, colNumber, usedRange);
      if (hasContent) {
        findings.push({
          sheet: worksheet.name,
          location: `Column ${colLetter(colNumber)}`,
          detail: 'Hidden column contains formulas or values within the used range.',
        });
      }
    });
  });

  return buildResult(rule, findings, {
    passMessage: 'No hidden rows/columns found containing formulas or values within the used range.',
    failMessage: `${findings.length} hidden row(s)/column(s) contain live content.`,
  });
}

function rowHasFormulaOrValue(row) {
  let found = false;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (cell.value !== null && cell.value !== undefined && cell.value !== '') found = true;
  });
  return found;
}

function columnHasFormulaOrValue(worksheet, colNumber, usedRange) {
  let found = false;
  for (let r = usedRange.top; r <= usedRange.bottom; r++) {
    const cell = worksheet.getRow(r).getCell(colNumber);
    if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
      found = true;
      break;
    }
  }
  return found;
}

// ---------------------------------------------------------------------
// T1-014 — no_white_text_hiding
// ICAEW: don't hide items using white text colour or a non-displaying
// text format (e.g. custom number format ";;;").
// ---------------------------------------------------------------------
function checkWhiteTextHiding(workbook, rule) {
  const findings = [];

  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.value === null || cell.value === undefined || cell.value === '') return;

        const numFmt = (cell.numFmt || '').replace(/\s/g, '');
        const isSuppressingFormat = numFmt === ';;;' || numFmt === '";"' || /^;;;?$/.test(numFmt);

        const fontColor = cell.font?.color?.argb; // e.g. 'FFFFFFFF'
        const fillColor = cell.fill?.fgColor?.argb;
        const isWhiteOnMatchingFill =
          fontColor && fillColor && fontColor.slice(-6).toUpperCase() === fillColor.slice(-6).toUpperCase();
        const isWhiteOnWhiteDefault =
          fontColor && fontColor.toUpperCase() === 'FFFFFFFF' && !fillColor; // white font, no explicit fill = default white bg

        if (isSuppressingFormat || isWhiteOnMatchingFill || isWhiteOnWhiteDefault) {
          findings.push({
            sheet: worksheet.name,
            location: `${colLetter(colNumber)}${rowNumber}`,
            detail: isSuppressingFormat
              ? `Number format "${cell.numFmt}" suppresses display of a non-empty value.`
              : 'Font colour matches fill colour (or defaults to white-on-white), hiding a non-empty value.',
          });
        }
      });
    });
  });

  return buildResult(rule, findings, {
    passMessage: 'No cells found using white-on-white or display-suppressing formats to hide content.',
    failMessage: `${findings.length} cell(s) appear to hide content via font/fill colour matching or a suppressing number format.`,
  });
}

// ---------------------------------------------------------------------
// T1-015 — worksheet_names_descriptive
// ICAEW: avoid default names (Sheet1, Sheet2) and mathematical operators
// in worksheet names.
// ---------------------------------------------------------------------
function checkWorksheetNamesDescriptive(workbook, rule) {
  const findings = [];
  const rejectPatterns = (rule.reject_patterns || []).map((p) => new RegExp(p));

  workbook.eachSheet((worksheet) => {
    const name = worksheet.name;
    for (const pattern of rejectPatterns) {
      if (pattern.test(name)) {
        findings.push({
          sheet: name,
          location: 'Sheet name',
          detail: `Worksheet name "${name}" matches discouraged pattern ${pattern}.`,
        });
        break; // one finding per sheet is enough
      }
    }
  });

  return buildResult(rule, findings, {
    passMessage: 'All worksheet names are descriptive and free of mathematical operators.',
    failMessage: `${findings.length} worksheet(s) have non-descriptive names or contain mathematical operators.`,
  });
}

// ---------------------------------------------------------------------
// T1-016 — no_array_formulas
// ICAEW: array (CSE) formulas are hard to audit and fragile to insert/
// delete operations.
// ---------------------------------------------------------------------
function checkNoArrayFormulas(workbook, rule) {
  const findings = [];

  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        // ExcelJS exposes array formulas via cell.formula + cell.type,
        // or via the raw model as formulaType === 'array'.
        const isArrayFormula =
          cell.formulaType === 'array' ||
          (cell.model && cell.model.formulaType === 'array') ||
          (typeof cell.formula === 'string' && cell.formula.startsWith('{') && cell.formula.endsWith('}'));

        if (isArrayFormula) {
          findings.push({
            sheet: worksheet.name,
            location: `${colLetter(colNumber)}${rowNumber}`,
            detail: 'Array (CSE) formula detected.',
          });
        }
      });
    });
  });

  return buildResult(rule, findings, {
    passMessage: 'No array (CSE) formulas found.',
    failMessage: `${findings.length} array formula(s) found.`,
  });
}

// ---------------------------------------------------------------------
// T1-017 — calc_settings_appropriate
// ICAEW: confirm iterative calculation is intentional/documented, and
// "Precision as displayed" should be off — it silently rewrites values.
// ---------------------------------------------------------------------
function checkCalcSettingsAppropriate(workbook, rule) {
  const findings = [];

  // ExcelJS surfaces workbook calc properties via workbook.calcProperties
  // (fullCalcOnLoad, calcMode, etc.) — iterative settings and "precision
  // as displayed" are stored in the workbook's calcPr XML element, which
  // ExcelJS may expose as workbook.properties.calcProperties or require
  // reading workbook.model.calcProperties depending on version. Adjust
  // the property path below to whatever your installed ExcelJS version
  // actually exposes — verify with a quick console.log(workbook.model)
  // against a real file before wiring this in.
  const calcProps = workbook.calcProperties || workbook.model?.calcProperties || {};

  if (calcProps.iterate === true || calcProps.iterate === '1') {
    findings.push({
      sheet: null,
      location: 'Workbook calculation settings',
      detail: 'Iterative calculation is enabled workbook-wide. Confirm this is an intentional, documented circularity, not a workaround for an unresolved circular reference.',
    });
  }

  if (calcProps.fullPrecision === false || calcProps.precisionAsDisplayed === true) {
    findings.push({
      sheet: null,
      location: 'Workbook calculation settings',
      detail: '"Precision as displayed" appears to be enabled. This silently rewrites underlying values to match rounded display and can corrupt historical actuals — should be off.',
    });
  }

  return buildResult(rule, findings, {
    passMessage: 'Iterative calculation and precision-as-displayed settings are off or not flagged as risky.',
    failMessage: `${findings.length} workbook calculation setting(s) require review.`,
  });
}

// ---------------------------------------------------------------------
// T1-018 — input_restrictions_present
// ICAEW: "Consider including restrictions" — data validation should
// exist somewhere in the workbook where input sheets are present.
// ---------------------------------------------------------------------
function checkInputRestrictionsPresent(workbook, rule) {
  let totalValidations = 0;
  let hasInputSheet = false;
  const inputSheetNameHints = /input|assumption/i;

  workbook.eachSheet((worksheet) => {
    if (inputSheetNameHints.test(worksheet.name)) hasInputSheet = true;

    // ExcelJS exposes data validations per-cell via cell.dataValidation,
    // or in some versions via worksheet.dataValidations.model (a map of
    // address -> validation object). Check both.
    if (worksheet.dataValidations?.model) {
      totalValidations += Object.keys(worksheet.dataValidations.model).length;
    } else {
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (cell.dataValidation) totalValidations += 1;
        });
      });
    }
  });

  const findings = [];
  if (hasInputSheet && totalValidations === 0) {
    findings.push({
      sheet: null,
      location: 'Workbook-wide',
      detail: 'Input/Assumption sheet(s) exist but zero data validation rules were found anywhere in the workbook.',
    });
  }

  return buildResult(rule, findings, {
    passMessage: hasInputSheet
      ? `${totalValidations} data validation rule(s) found across the workbook.`
      : 'No dedicated input sheet detected — rule not applicable.',
    failMessage: 'Input sheet(s) present with no data validation anywhere in the workbook.',
  });
}

// ---------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------

function colLetter(colNumber) {
  let letter = '';
  let n = colNumber;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * Generic result builder — replace with whatever shape validator-tier1.js
 * already uses for its other handlers (e.g. { ruleId, status, severity,
 * findings, message }). This is a reasonable default matching the fields
 * visible elsewhere in checklist.json (id, severity, fix_instruction).
 */
function buildResult(rule, findings, { passMessage, failMessage }) {
  const failed = findings.length > 0;
  return {
    ruleId: rule.id,
    label: rule.label,
    severity: rule.severity,
    status: failed ? 'fail' : 'pass',
    message: failed ? failMessage : passMessage,
    findings,
    fixInstruction: failed ? rule.fix_instruction : null,
  };
}

// ---------------------------------------------------------------------
// Dispatch table — merge these into validator-tier1.js's existing switch
// ---------------------------------------------------------------------
module.exports = {
  hidden_rows_columns_present: checkHiddenCalcRowsColumns,
  white_text_hidden_content: checkWhiteTextHiding,
  worksheet_naming_check: checkWorksheetNamesDescriptive,
  array_formula_check: checkNoArrayFormulas,
  workbook_calc_settings_check: checkCalcSettingsAppropriate,
  data_validation_check: checkInputRestrictionsPresent,
};
