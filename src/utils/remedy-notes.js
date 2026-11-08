'use strict';
// remedy-notes.js - Patch 58 (Partner Review Fm-00063). Three fixes were right but incomplete in the reviewer's words:
// a deferred-tax gap may be a deliberate notional or cash tax basis; a call-up cell rewrite across hundreds of formulas is
// too invasive; and "remove the second factor" leaves out which unit convention is authoritative and what must be retested.
// This appends one short qualifying sentence to the fix. Severity, priority and the finding itself are not touched.
const NOTES = {
  'T2-S10-014': 'Before building a deferred tax bridge, check whether the model deliberately uses a notional or cash tax basis (cover notes, the regulatory tax method). If it does, the minimum fix is a written statement on the tax sheet of the basis used and why deferred tax is not modelled; a bridge is needed only where tax expense is reported on an accounting basis.',
  'T2-S13-011': 'Apply this to the key lines only (the outputs and the lines that feed them), or stage the values through named ranges; do not rewrite every cross-sheet formula in the workbook.',
  'T0-DOUBLESCALE-001': 'Before removing the second factor, state which unit convention is authoritative for the inputs (already scaled or not) and list every cell that reads the corrected line so each one is retested. For a ratio, confirm which side should carry the scale.',
};
const MARK = '[Remedy note]';
const baseId = id => String(id || '').replace(/^(T2-S\d+-\d{3}|T1-\d{3})-\d+$/, '$1');

/** Adds the note to corrective_action (or fix_instruction when that is empty). Idempotent. Returns the ids changed. */
function applyRemedyNotes(findings) {
  const changed = [];
  for (const f of findings || []) {
    const note = NOTES[baseId(f.id)];
    if (!note) continue;
    const key = String(f.corrective_action || '').trim() ? 'corrective_action' : 'fix_instruction';
    const cur = String(f[key] || f.fix_instruction || '').trim();
    if (!cur || cur.includes(MARK)) continue;
    f[key] = `${cur} ${MARK} ${note}`;
    changed.push(f.id);
  }
  return changed;
}
module.exports = { applyRemedyNotes, NOTES };
