// data-validation-presence-check.js — L24 (fm-validator book-mining:
// ICAEW's "How to Review a Spreadsheet"): whether input cells carry
// Data Validation rules is a genuine governance signal, but its
// ABSENCE is common and normal — most models don't use it — so this is
// framed purely as an informational observation, never as an assertion
// that something is wrong. No severity implying a defect; no "fail"
// framing for an absence that is entirely typical.
//
// Input cells are identified via the FAST-standard / this project's own
// documented convention: blue font colour marking a hardcoded input,
// distinct from a black-font formula cell.

const BLUE_FONT_RE = /^FF0000FF$|^FF0070C0$/i; // standard blue, and Excel's "blue, accent" variant

function isBlueFont(cell) {
  const argb = cell.font && cell.font.color && cell.font.color.argb;
  return typeof argb === 'string' && BLUE_FONT_RE.test(argb);
}

function checkDataValidationPresence(workbook) {
  let inputCells = 0;
  let withValidation = 0;
  const examplesWithout = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.formula) return; // only plain input-looking cells are this check's concern
        if (typeof cell.value !== 'number') return;
        if (!isBlueFont(cell)) return;
        inputCells++;
        if (cell.dataValidation) {
          withValidation++;
        } else if (examplesWithout.length < 5) {
          examplesWithout.push(`${ws.name}!${cell.address}`);
        }
      });
    });
  });

  if (inputCells === 0) {
    return { applicable: false, flaggedCount: 0, inputCells: 0, withValidation: 0, note: 'No blue-font input cells identified — this project\'s input-colour convention was not detected, so this check cannot assess Data Validation coverage.' };
  }

  return {
    applicable: true,
    flaggedCount: 0, // purely informational — never a pass/fail finding
    inputCells,
    withValidation,
    coverageFraction: Math.round((withValidation / inputCells) * 1000) / 1000,
    examplesWithout,
    note: `${withValidation} of ${inputCells} identified input cell(s) (${Math.round((withValidation / inputCells) * 100)}%) carry a Data Validation rule. This is informational only — most models do not use Data Validation at all, and its absence is not itself a defect.`,
  };
}

module.exports = { checkDataValidationPresence };
