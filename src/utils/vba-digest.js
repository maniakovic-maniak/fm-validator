/**
 * VBA digest for the Tier 2 reviewer (Patch 14).
 *
 * The reviewer used to be told only the module count and the labels of the Tier 0 VBA findings. That made two rules
 * undecidable (T2-S10-788 "does anything record when SavedResults was last refreshed", T2-S13-004 "are the macros
 * documented"): it could not see what the macros do, and a count of 31 modules mostly meant empty sheet stubs.
 *
 * This reads the extracted macro source and reports FACTS only, no judgement:
 *   - which modules have real code and which are empty stubs (Sheet1, ThisWorkbook with no procedures);
 *   - for each real module: its procedures and five behaviour flags, found on code with comments and string literals
 *     removed so that a word in a caption or a comment is not mistaken for code.
 */
'use strict';

const PROC_RE = /^\s*(?:(?:Public|Private|Friend)\s+)?(?:Static\s+)?(Sub|Function)\s+([A-Za-z_]\w*)/i;
const SKIP_LINE_RE = /^\s*(Attribute\s|Option\s|VERSION\s|BEGIN\b|END\s*$|MultiUse\b|Dim\s|Public\s+\w+\s+As\b|Private\s+\w+\s+As\b|End\s+(Sub|Function|If|With|Select)\b|Exit\s+(Sub|Function))/i;

// Removes comments and string literals from one VBA line, keeping the code shape.
function stripLine(line) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '"') { if (line[i + 1] === '"') { i++; } else { inStr = false; out += '""'; } }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "'") break;
    out += ch;
  }
  if (/^\s*Rem\b/i.test(out)) return '';
  return out;
}

const WRITES_VALUES = /\.(Value2?|Formula|FormulaR1C1)\s*=|PasteSpecial|xlPasteValues|\.Copy\b[^\n]*Destination\s*:?=/i;
const SETS_CALC = /Application\.(Calculation|Iteration|MaxIterations|MaxChange)\b|\b(Application\.)?Calculate(Full|FullRebuild)?\b|\.Calculate\b/i;
// Any use of the clock (Application.Wait (Now + ...) is a pause, not a record).
const USES_CLOCK = /\b(Now|Date|Time|Timer|FileDateTime)\b/i;
// A date or time actually being RECORDED: put into a cell value, a formula or a caption, or formatted for output.
// Strings are already removed, so a word in a message cannot match.
const RECORDS_CLOCK = /(\.(Value2?|Formula|Caption|Text)\s*=\s*[^\n]*\b(Now|Date|Time)\b)|(\bFormat\s*\(\s*(Now|Date|Time)\b)/i;
const MESSAGE = /\b(MsgBox|InputBox)\b|Application\.StatusBar\s*=\s*[^F]|\.Caption\s*=/i;

function digestModule(mod) {
  const raw = String(mod.sourceCode || '').split(/\r?\n/);
  const procedures = [];
  let codeLines = 0;
  const flags = { writesValues: false, setsCalculation: false, recordsDateOrTime: false, usesClock: false, showsMessage: false };
  for (const line of raw) {
    const code = stripLine(line);
    if (!code.trim()) continue;
    const p = PROC_RE.exec(code);
    if (p) procedures.push(p[2]);
    if (SKIP_LINE_RE.test(code) || p) continue;
    codeLines++;
    if (WRITES_VALUES.test(code)) flags.writesValues = true;
    if (SETS_CALC.test(code)) flags.setsCalculation = true;
    if (USES_CLOCK.test(code)) flags.usesClock = true;
    if (RECORDS_CLOCK.test(code) && !/Application\.Wait/i.test(code)) flags.recordsDateOrTime = true;
    if (MESSAGE.test(code)) flags.showsMessage = true;
  }
  return { name: mod.name, type: mod.moduleType || null, lineCount: mod.lineCount || raw.length, codeLines, procedures, ...flags };
}

// A real module has at least one procedure with at least two lines of working code.
function isSubstantive(d) { return d.procedures.length > 0 && d.codeLines >= 2; }

/**
 * @param {Array<object>} modules  the extraction's modules (name, moduleType, lineCount, sourceCode)
 * @returns {{moduleCount, substantiveCount, emptyCount, modules, anyWritesTimestamp, anyShowsMessage, anySetsCalculation, anyWritesValues, note}}
 */
function buildVbaDigest(modules) {
  const all = (Array.isArray(modules) ? modules : []).map(digestModule);
  const real = all.filter(isSubstantive);
  const emptyNames = all.filter(d => !isSubstantive(d)).map(d => d.name);
  return {
    moduleCount: all.length,
    substantiveCount: real.length,
    emptyCount: emptyNames.length,
    emptyModuleExamples: emptyNames.slice(0, 5),
    modules: real.slice(0, 40).map(d => ({
      name: d.name, type: d.type, codeLines: d.codeLines, procedures: d.procedures.slice(0, 12),
      writesValues: d.writesValues, setsCalculation: d.setsCalculation, recordsDateOrTime: d.recordsDateOrTime, usesClock: d.usesClock, showsMessage: d.showsMessage,
    })),
    anyWritesValues: real.some(d => d.writesValues),
    anySetsCalculation: real.some(d => d.setsCalculation),
    anyRecordsDateOrTime: real.some(d => d.recordsDateOrTime),
    anyShowsMessage: real.some(d => d.showsMessage),
    note: 'Facts read from the macro source with comments and text strings removed. A module with no procedure, or under two lines of working code, is counted as empty (typical for sheet and ThisWorkbook code stubs).',
  };
}

module.exports = { buildVbaDigest, digestModule, isSubstantive, stripLine };
