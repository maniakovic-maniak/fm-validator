'use strict';
// volatile-timestamp.js - Patch 35. A cell that is just NOW() or TODAY(), used to date a run.
//
// A Partner Review of a licence model noted that the scenario archive stamps each run with NOW(). That value changes on
// every recalculation and on every open, so it records when the workbook was last calculated, not when the scenario was
// run, unless a macro pastes it as a value. The saved value shows the date of the last save, which an archive reader will
// take as the run date.
//
// Only a cell whose whole formula is NOW() or TODAY() is reported. A NOW() inside a calculation is a different question
// and is left to the volatile-function count.

const { fullFormula } = require('./formula-store');
const { makeReader, parseRef } = require('./path-checks-common');

function checkVolatileTimestamps(workbook, cellScoreIndex) {
  const rd = makeReader(workbook);
  const records = [];
  for (const key of Object.keys(cellScoreIndex)) {
    const f = fullFormula(cellScoreIndex, key, cellScoreIndex[key]);
    if (!f || !/^=?\s*(NOW|TODAY)\s*\(\s*\)\s*$/i.test(f)) continue;
    const bang = key.lastIndexOf('!'); const sheet = key.slice(0, bang), cell = key.slice(bang + 1), p = parseRef(cell);
    const saved = p ? rd.value(sheet, p.r1, p.c1) : null;
    const savedText = saved instanceof Date && !isNaN(saved) ? saved.toISOString().slice(0, 10) : null;
    records.push({
      sheet, cell, verdict: 'query', saved: savedText,
      text: `${sheet}!${cell} is ${/TODAY/i.test(f) ? 'TODAY()' : 'NOW()'}${savedText ? ` and last held ${savedText}` : ''}. It changes on every recalculation, so it dates the last calculation, not the run, unless a macro pastes it as a value.`,
    });
  }
  return { applicable: records.length > 0, records, tested: records.length, counts: { query: records.length }, notCompleted: 0 };
}

module.exports = { checkVolatileTimestamps };
