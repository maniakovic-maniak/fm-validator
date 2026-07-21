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

// FIX (partial — found via a real run on a property/development model):
// that file used NEITHER of these two blues for its input cells at all
// — it used a dark blue-grey theme colour (FF44546A), grey, and black
// instead. Broadening to catch grey/black would be unsafe: those are
// also used for ordinary labels and text throughout most models, so
// they carry no reliable "this is an input" signal on their own. Added
// FF1F4E78 (a common "blue, darker 50%" Excel theme variant seen in
// other real models) as a modest, evidence-based addition — but this
// remains a genuine, disclosed limitation: a model using a font-colour
// convention outside this list will correctly report "not applicable"
// rather than a false structural read, which is the safer failure mode.
const BLUE_FONT_RE = /^FF0000FF$|^FF0070C0$|^FF1F4E78$/i;

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
