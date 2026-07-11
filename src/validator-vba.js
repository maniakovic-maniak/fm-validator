const { spawn } = require('child_process');
const path = require('path');

// Path to the Python extraction script. Deployed alongside the other
// pipeline scripts in src/ — same directory convention as build_report.py.
const EXTRACT_SCRIPT = path.join(__dirname, 'extract_vba.py');

// Hard ceiling on how long extraction is allowed to run. The production
// host (CloudLinux/LVE) kills long-running processes under resource
// pressure — without an explicit bound here, a pathological file (huge or
// deeply obfuscated VBA project) could hang the request indefinitely
// rather than failing cleanly and letting the rest of the pipeline finish.
const EXTRACTION_TIMEOUT_MS = 30000;

/**
 * Run extract_vba.py against a workbook file and return the parsed JSON.
 * Mirrors the promise-wrapped subprocess pattern used elsewhere in the
 * pipeline for Python calls (build_report.py invocation).
 */
function runExtraction(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [EXTRACT_SCRIPT, filePath]);

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(`VBA extraction timed out after ${EXTRACTION_TIMEOUT_MS / 1000}s and was killed`));
    }, EXTRACTION_TIMEOUT_MS);

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not start VBA extraction subprocess: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!stdout.trim()) {
        reject(new Error(`VBA extraction produced no output (exit code ${code}). stderr: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`Could not parse VBA extraction output as JSON: ${e.message}. Raw (truncated): ${stdout.slice(0, 300)}`));
      }
    });
  });
}

/**
 * Wave 2 — VBA/macro review engine.
 *
 * Runs the Python extraction+risk-scan layer and shapes the result into the
 * same {applicable, note, findings} contract runFormulaDeepDive() uses, so
 * the call site in index.js/server.js is a straight drop-in:
 *
 *   const vbaReview = await (async () => { try { return await runVbaReview(parsed._filePath); }
 *     catch (e) { console.error(...); return { applicable:false, note:e.message, hasVbaProject:false, findings:[] }; } })();
 *   ...
 *   if (vbaReview.findings && vbaReview.findings.length) allFlagged.push(...vbaReview.findings);
 *
 * Each finding matches the T0-* deterministic-check shape used throughout
 * (id/label/severity/status/sheet/cell/category/condition/reason/
 * corrective_action/workstream/issue_type/model_risk/key_output_impact/
 * method/needs_retest/root_cause/escalation_flag/urgency/confidence) —
 * NOT the Tier 2 P1/P2/P3 schema, since this runs deterministically like
 * redundant-inputs.js and sheet-linkage.js, not through Claude.
 *
 * A clean pass (no VBA project, or VBA present with nothing flagged) never
 * pushes a finding — same convention every sibling T0 check follows
 * (duplicateSheets, namedRangeAudit, reasonableness, etc. only push when
 * something is actually wrong).
 */
async function runVbaReview(filePath) {
  const extraction = await runExtraction(filePath);

  // ── Encrypted workbook — distinct from a generic extraction failure ────
  // This is a "cannot verify" result, not a "no macros found" result, and
  // it needs different downstream handling: the rest of the pipeline
  // (Familiarise, Tier 1, Tier 2) would be reviewing a file we've already
  // confirmed we can't fully see into for macro content, so the caller
  // should stop the run here rather than produce a report that implicitly
  // claims full coverage. blockValidation is the explicit signal for that;
  // callers check it before deciding whether to continue past this point.
  if (extraction.encrypted) {
    return {
      applicable: true,
      encrypted: true,
      blockValidation: true,
      hasVbaProject: null,
      moduleCount: 0,
      note: extraction.error || 'This workbook is password-encrypted; VBA content cannot be verified without the password.',
      findings: [],
    };
  }

  const hadPartialError = Boolean(extraction.error);
  const hasUsableModules = Array.isArray(extraction.modules) && extraction.modules.length > 0;

  if (hadPartialError && !hasUsableModules) {
    // A genuine total failure (nothing was extracted before the error) —
    // degrade the same way formulaDeepDive's catch block does: log and
    // mark not applicable, don't push a finding.
    return { applicable: false, note: extraction.error, hasVbaProject: false, findings: [] };
  }

  if (!hadPartialError && !extraction.hasVbaProject) {
    return {
      applicable: true,
      hasVbaProject: false,
      moduleCount: 0,
      note: 'No VBA project was detected in this workbook.',
      findings: [],
    };
  }

  const findings = [];
  const moduleNames = extraction.modules.map(m => m.name).join(', ');

  // ── Scope-limitation finding — always emitted when a VBA project exists ─
  // This is a disclosure, not a defect: the point is that formula-cell
  // checks can't see into macro code, so a reader needs to know that gap
  // exists rather than assume "no formula issues found" covers everything.
  findings.push({
    id: 'T0-VBA-001',
    label: `Workbook contains a VBA project with ${extraction.moduleCount} module(s) not covered by formula-cell checks`,
    severity: 'medium',
    status: 'fail',
    sheet: 'N/A',
    cell: 'A1',
    category: 'Governance',
    condition: `This workbook contains a VBA project with ${extraction.moduleCount} module(s): ${moduleNames}. This review reads formula cells directly; it does not execute or trace VBA/macro code, so any calculation performed inside a macro is invisible to it, however well the macro itself is written.`,
    reason: `VBA project present — ${extraction.moduleCount} module(s): ${moduleNames}`,
    corrective_action: 'Have a qualified reviewer read the VBA source directly (Alt+F11 in Excel) to confirm what these macros do, particularly any that run automatically or write values back into the model.',
    workstream: 'Governance', issue_type: 'Scope limitation',
    model_risk: 'A model can pass every formula-cell check and still have material logic hidden inside a macro — automated review of the visible spreadsheet cannot substitute for a human reading the VBA source.',
    key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
    root_cause: 'Macro logic outside the scope of static formula analysis',
    escalation_flag: false, urgency: 'Before next reliance', confidence: 100
  });

  // ── Auto-exec findings — macros that run without the user choosing to ──
  const autoExecByModule = {};
  for (const mod of extraction.modules) {
    const triggers = mod.findings.filter(f => f.category === 'AutoExec');
    if (triggers.length > 0) autoExecByModule[mod.name] = triggers;
  }
  if (Object.keys(autoExecByModule).length > 0) {
    const summary = Object.entries(autoExecByModule)
      .map(([mod, trigs]) => `${mod} (${trigs.map(t => t.keyword).join(', ')})`)
      .join('; ');
    findings.push({
      id: 'T0-VBA-002',
      label: 'Auto-executing macro trigger(s) found — code runs without the user choosing to run it',
      severity: 'high',
      status: 'fail',
      sheet: 'N/A',
      cell: 'A1',
      category: 'Governance',
      condition: `Auto-executing macro triggers were found: ${summary}. This is a materially different risk profile from a macro the user must deliberately invoke — auto-run code can alter values or recalculate on open with no visible prompt.`,
      reason: `Auto-run macro trigger(s): ${summary}`,
      corrective_action: 'Confirm what each auto-run trigger does. If it writes values, changes formulas, or pulls external data on open, that behaviour should be disclosed to anyone relying on this model.',
      workstream: 'Governance', issue_type: 'Auto-executing macro',
      model_risk: 'Code that runs on open, without any user action, can change the model silently — a reader has no visual cue that anything executed at all.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Auto-executing macro trigger present',
      escalation_flag: true, urgency: 'Before next reliance', confidence: 100
    });
  }

  // ── Suspicious keyword findings — grouped so the report isn't 40 rows ──
  const suspiciousByModule = {};
  for (const mod of extraction.modules) {
    const sus = mod.findings.filter(f => f.category === 'Suspicious');
    if (sus.length > 0) suspiciousByModule[mod.name] = sus;
  }
  if (Object.keys(suspiciousByModule).length > 0) {
    const summary = Object.entries(suspiciousByModule)
      .map(([mod, items]) => `${mod}: ${[...new Set(items.map(i => i.keyword))].join(', ')}`)
      .join(' | ');
    findings.push({
      id: 'T0-VBA-003',
      label: 'Macro source contains keywords associated with system-level or external actions',
      severity: 'medium',
      status: 'fail',
      sheet: 'N/A',
      cell: 'A1',
      category: 'Governance',
      condition: `Keywords commonly associated with system-level or external actions were found in the macro source: ${summary}. These keywords are not inherently malicious — legitimate macros use them for file I/O, automation, or external data refresh — but they mean this workbook can act outside the spreadsheet itself.`,
      reason: `Suspicious keyword(s) found: ${summary}`,
      corrective_action: 'Review each flagged line in context. Confirm the actions performed (file access, shell commands, external object creation) are expected and match the model\'s stated purpose.',
      workstream: 'Governance', issue_type: 'Suspicious macro keyword',
      model_risk: 'A macro that can run shell commands or create external objects has a reach well beyond the spreadsheet — worth confirming it does only what it is meant to.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'System-level API call present in macro source',
      escalation_flag: false, urgency: 'Before next reliance', confidence: 95
    });
  }

  // ── IOC findings (URLs, executable names, etc.) — strongest signal that
  // something outside the model itself is involved ──
  const iocByModule = {};
  for (const mod of extraction.modules) {
    const iocs = mod.findings.filter(f => f.category === 'IOC');
    if (iocs.length > 0) iocByModule[mod.name] = iocs;
  }
  if (Object.keys(iocByModule).length > 0) {
    const summary = Object.entries(iocByModule)
      .map(([mod, items]) => `${mod}: ${[...new Set(items.map(i => i.keyword))].join(', ')}`)
      .join(' | ');
    findings.push({
      id: 'T0-VBA-004',
      label: 'Macro source contains hardcoded external references (URL, file path, or executable)',
      severity: 'high',
      status: 'fail',
      sheet: 'N/A',
      cell: 'A1',
      category: 'Governance',
      condition: `Specific external references were found hardcoded in the macro source: ${summary}. This means the workbook is capable of reaching outside itself — to the internet, the file system, or another program — as part of its normal operation.`,
      reason: `External reference(s) in macro source: ${summary}`,
      corrective_action: 'Confirm every external reference is expected and points to a legitimate, controlled location. An unexpected URL or executable reference in a financial model warrants immediate manual review before this file is trusted or distributed further.',
      workstream: 'Governance', issue_type: 'Hardcoded external reference',
      model_risk: 'A model that reaches out to an external URL, file path or executable is not just a spreadsheet — anyone opening and running it inherits whatever that reference does.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Hardcoded external reference in macro source',
      escalation_flag: true, urgency: 'Before next reliance', confidence: 95
    });
  }

  // ── Calculation-integrity findings — VBA that manipulates or substitutes
  // for Excel's own calculation engine (manual iterative solving, forced
  // recalculation, calc-mode changes, copy-as-values freezing). Not caught
  // by oletools' own scanner, which is tuned for malware triage, not
  // model-calculation-integrity concerns — this is a custom category
  // specific to this audit tool's actual mission. Confirmed real-world
  // relevance via Hidden Gem's Master_Solve_Fast() macro, a manual
  // iterative debt-sizing solver that no prior category could flag. ──
  const calcIntegrityByModule = {};
  for (const mod of extraction.modules) {
    const calc = mod.findings.filter(f => f.category === 'CalcIntegrity');
    if (calc.length > 0) calcIntegrityByModule[mod.name] = calc;
  }
  if (Object.keys(calcIntegrityByModule).length > 0) {
    const summary = Object.entries(calcIntegrityByModule)
      .map(([mod, items]) => `${mod}: ${[...new Set(items.map(i => i.keyword))].join(', ')}`)
      .join(' | ');
    findings.push({
      id: 'T0-VBA-005',
      label: "Macro source manipulates or substitutes for Excel's own calculation engine",
      severity: 'high',
      status: 'fail',
      sheet: 'N/A',
      cell: 'A1',
      category: 'Governance',
      condition: `VBA code that manipulates Excel's calculation behaviour was found: ${summary}. This may include changing calculation mode, forcing recalculation, configuring iterative-calculation settings, or manually copying values to freeze a result — techniques often used to work around circular references or control when and how the model recalculates.`,
      reason: `Calculation-integrity pattern(s) found: ${summary}`,
      corrective_action: "Confirm exactly what this macro does to the model's calculation — particularly whether values that look like live formula outputs are actually static, macro-pasted results, and whether the model calculates correctly if this macro is never run.",
      workstream: 'Governance', issue_type: 'Calculation integrity',
      model_risk: "A model whose real calculation depends on a macro, not just its formulas, can look complete and consistent while actually depending on manual, macro-driven steps a reader can't see just by opening the file — anyone who opens it without running the macro may be looking at stale or partially-calculated results.",
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Macro-driven calculation control or manual iterative solving present',
      escalation_flag: true, urgency: 'Before next reliance', confidence: 90
    });
  }

  return {
    applicable: true,
    hasVbaProject: true,
    moduleCount: extraction.moduleCount,
    note: hadPartialError
      ? `VBA project reviewed — ${extraction.moduleCount} module(s) recovered before an extraction error, ${findings.length} finding(s). Error: ${extraction.error}`
      : `VBA project reviewed — ${extraction.moduleCount} module(s), ${findings.length} finding(s).`,
    findings,
  };
}

module.exports = { runVbaReview, runExtraction };
