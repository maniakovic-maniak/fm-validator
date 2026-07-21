// cell-locking-governance-check.js — L25 (fm-validator book-mining:
// "Excel for Auditors", Jelen & Dowell, reinforced by FAST Standard's
// own Input/Workings separation convention): where sheet protection is
// genuinely enabled, a well-built model locks formula cells and leaves
// only input cells unlocked — a real, checkable governance signal.
//
// Only evaluated when protection is ACTUALLY enabled somewhere in the
// workbook — most models don't use sheet protection at all, and that
// absence is not itself flagged (matching this project's established
// discipline of not treating a normal, common practice as a defect).
// When protection IS enabled, an INCONSISTENCY between locking and
// cell role (an input cell locked, or a formula cell left unlocked) is
// the real signal.

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

function checkCellLockingGovernance(workbook) {
  const protectedSheets = [];
  workbook.eachSheet(ws => {
    if (ws.sheetProtection) protectedSheets.push(ws.name);
  });

  if (protectedSheets.length === 0) {
    return { applicable: false, flaggedCount: 0, findings: [], note: 'No sheet has protection enabled — this check only applies where protection is actually in use.' };
  }

  const findings = [];
  workbook.eachSheet(ws => {
    if (!protectedSheets.includes(ws.name)) return;
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const locked = !cell.protection || cell.protection.locked !== false; // ExcelJS/Excel default is locked=true
        const isInput = !cell.formula && typeof cell.value === 'number' && isBlueFont(cell);
        const isFormula = !!cell.formula;

        if (isInput && locked) {
          findings.push({
            sheet: ws.name, cell: cell.address, issue: 'input-locked',
            note: `${ws.name}!${cell.address} looks like an input cell (blue font, plain value) but is LOCKED under this sheet's protection — a user cannot edit it without first unprotecting the sheet.`,
          });
        } else if (isFormula && !locked) {
          findings.push({
            sheet: ws.name, cell: cell.address, issue: 'formula-unlocked',
            note: `${ws.name}!${cell.address} is a formula cell but is UNLOCKED under this sheet's protection — it can be overwritten even with protection enabled.`,
          });
        }
      });
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    protectedSheets,
    findings,
    note: `Sheet protection is enabled on: ${protectedSheets.join(', ')}. Flags a cell whose lock state is inconsistent with its apparent role — an input cell (blue font) left locked, or a formula cell left unlocked.`,
  };
}

module.exports = { checkCellLockingGovernance };
