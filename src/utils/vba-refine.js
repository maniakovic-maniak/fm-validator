// vba-refine.js - trims false positives out of the macro scanner's findings, deterministically and at no cost.
//
// The scanner (oletools) is tuned for malware triage. On a financial model it over-reports, as an independent
// review of a licence model showed:
//   - ActiveX control handlers (ComboBox1_Change, Label1_Click) are reported as "runs when the file is opened",
//     even when their bodies are empty;
//   - a macro merely NAMED Run, or the words Open / Output in comments and messages, are reported as system calls;
//   - "Base64 Strings" is a heuristic over any long string, not evidence of an external action.
// This module keeps what a reviewer can act on: real open-time triggers with a body, and keywords that occur in
// executable code (not in comments or string literals), with the generic file words kept only when an actual
// file-I/O statement exists.

'use strict';

// Remove ' comments, Rem lines and "string literals" so a keyword is only seen when it is code.
function stripCommentsAndStrings(src) {
  const out = [];
  for (const line of String(src || '').split('\n')) {
    let res = '';
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inStr && line[i + 1] === '"') { i++; continue; }   // escaped quote inside a string
        inStr = !inStr;
        continue;
      }
      if (inStr) continue;
      if (ch === "'") break;                                    // comment to end of line
      res += ch;
    }
    if (/^\s*Rem\b/i.test(res)) res = '';
    out.push(res);
  }
  return out.join('\n');
}

const KEEP_AUTOEXEC_RE = /^(auto_?(open|close|exec|new|exit)|workbook_|worksheet_|document_|thisworkbook|app_)/i;

// Is the body of "Sub <name>" empty once comments, blank lines and Attribute lines are removed?
function subBodyIsEmpty(src, name) {
  const re = new RegExp('(?:Private\\s+|Public\\s+|Friend\\s+)?Sub\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)[^\\n]*\\n([\\s\\S]*?)\\bEnd\\s+Sub\\b', 'i');
  const m = re.exec(String(src || ''));
  if (!m) return false;                                          // sub not found: do not assume it is empty
  const body = stripCommentsAndStrings(m[1])
    .split('\n').map(l => l.trim()).filter(l => l && !/^Attribute\b/i.test(l) && !/^(Dim|Const)\b/i.test(l));
  return body.length === 0;
}

const DROP_SUSPICIOUS = new Set(['base64 strings', 'hex strings', 'dridex strings', 'vba obfuscated strings']);
const WEAK_FILE_WORDS = new Set(['open', 'output', 'input', 'binary', 'append', 'write', 'print', 'put', 'get', 'read', 'close', 'random', 'lock']);
const FILE_IO_STATEMENT_RE = /\bOpen\b[^\n]*\bFor\s+(Input|Output|Append|Binary|Random)\b/i;
const EXTERNAL_CORROBORATION_RE = /\b(Shell|WScript|CreateObject|GetObject|URLDownloadToFile|XMLHTTP|WinHttp|ShellExecute)\b/i;

function keywordInCode(code, keyword) {
  const k = String(keyword || '').trim();
  if (!k) return false;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![A-Za-z0-9_])' + esc + '(?![A-Za-z0-9_])', 'i').test(code);
}

// Returns {findings, dropped:[{category,keyword,why}]} for one extracted module.
function refineModuleFindings(mod) {
  const src = (mod && mod.sourceCode) || '';
  const code = stripCommentsAndStrings(src);
  const kept = [];
  const dropped = [];
  for (const f of (mod && mod.findings) || []) {
    const kw = String(f.keyword || '');
    const kwl = kw.toLowerCase();
    if (f.category === 'AutoExec') {
      if (!KEEP_AUTOEXEC_RE.test(kw)) { dropped.push({ category: f.category, keyword: kw, why: 'ActiveX control event handler, not an open-time trigger' }); continue; }
      if (subBodyIsEmpty(src, kw)) { dropped.push({ category: f.category, keyword: kw, why: 'handler body is empty' }); continue; }
      kept.push(f); continue;
    }
    if (f.category === 'Suspicious') {
      if (DROP_SUSPICIOUS.has(kwl)) { dropped.push({ category: f.category, keyword: kw, why: 'string-pattern heuristic, not an external action' }); continue; }
      if (!keywordInCode(code, kw)) { dropped.push({ category: f.category, keyword: kw, why: 'appears only in a comment or string literal' }); continue; }
      if (WEAK_FILE_WORDS.has(kwl) && !FILE_IO_STATEMENT_RE.test(code)) { dropped.push({ category: f.category, keyword: kw, why: 'generic file word with no file-I/O statement' }); continue; }
      if (kwl === 'run' && !EXTERNAL_CORROBORATION_RE.test(code)) { dropped.push({ category: f.category, keyword: kw, why: 'Run calls a routine inside the workbook (no Shell/CreateObject present)' }); continue; }
      kept.push(f); continue;
    }
    kept.push(f);
  }
  return { findings: kept, dropped };
}

// True when the macro code recalculates inside a loop (a manual iterative solver), the pattern that deserves
// a high severity; plain calculation-mode save/restore around a paste does not.
function hasIterativeSolverPattern(src) {
  const code = stripCommentsAndStrings(src);
  return /\bDo\b(?:\s+(?:While|Until)\b)?[\s\S]{0,3000}?\.Calculate\w*[\s\S]{0,3000}?\bLoop\b/i.test(code)
      || /\bFor\b[\s\S]{0,3000}?\.Calculate\w*[\s\S]{0,3000}?\bNext\b/i.test(code)
      || /Application\.Iteration\s*=\s*True/i.test(code);
}

module.exports = { stripCommentsAndStrings, subBodyIsEmpty, refineModuleFindings, hasIterativeSolverPattern };
