require('dotenv').config();
const { fetchAndParse, scanFormulaErrors }                            = require('./src/parser');
const { detectRedundantInputs } = require('./src/utils/redundant-inputs');
const { detectOrphanSheets } = require('./src/utils/sheet-linkage');
const { detectNamedRangeIssues } = require('./src/utils/named-range-audit');
const { checkTotalRanges } = require('./src/utils/total-range-check');
const { checkSignConventions } = require('./src/utils/sign-convention-check');
const { checkKeyOutputChains } = require('./src/utils/key-output-chain-check');
const { checkBareNPV, checkNestedIFs, checkMergedCells, checkHiddenRowsColumns } = require('./src/utils/fast-standard-checks');
const { checkHardcodedCheckCells } = require('./src/utils/hardcoded-check-cells');
const { checkCircularReferences } = require('./src/utils/circular-reference-detector');
const { checkOffByOneRanges, checkAggregateResultMismatch, checkRangeIncludesOwnTotal, checkSuspiciousErrorMasking } = require('./src/utils/spreadsheet-auditor-checks');
const { checkPII } = require('./src/utils/pii-detection');
const { runFormulaDeepDive } = require('./src/validator-formula-deepdive');
const { runVbaReview } = require('./src/validator-vba');
const { checkWaccOverride, checkTerminalValueConcentration, checkOutputReasonableness } = require('./src/utils/reasonableness-checks');
const { detectDuplicateSheets } = require('./src/utils/sheet-linkage');
const { familiariseModel, formatSummaryAsContext } = require('./src/familiariser');
const { loadDomainSkill, maybeQueueDomainDraft }   = require('./src/classifier');
const { preValidate }                              = require('./src/pre-validator');
const { runTier1 }                                 = require('./src/validator-tier1');
const { runTier0 }                                 = require('./src/validator-tier0');
const { runTier2, resolveDeepAccountingSheets }    = require('./src/validator-tier2');
const { buildReportFile }                          = require('./src/report-tab');
const { uploadBothFiles }                          = require('./src/writer');
const { sendNotification }                         = require('./src/notifier');
const path = require('path');
const fs   = require('fs');
const { logAuditEvent }    = require('./src/utils/audit-log');
const { runRetentionSweep } = require('./src/utils/cleanup');
const { startRunLog }      = require('./src/utils/run-logger');

const FILE_ID   = process.argv[2];
const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

if (!FILE_ID) {
  console.error('Usage: node index.js <google-drive-file-id>');
  process.exit(1);
}

let runLog = { filename: null, stop: () => {} };
async function run() {
  // ── Step 1: Parse ──────────────────────────────────────────────────────────
  const parsed = await fetchAndParse(FILE_ID);

  // Derive original filename from the downloaded file path
  const originalName = path.basename(parsed._filePath);
  runLog = startRunLog(originalName);

  console.log('\n─────────────────────────────────────');
  console.log(`FM VALIDATOR — ${originalName}`);
  console.log('─────────────────────────────────────\n');

  // ── Step 1.5: Tier 0 — Formula text scan ──────────────────────────────
  console.log('[1.5/6] Scanning formula text...');
  const tier0 = await runTier0(parsed);
  // Opt-in only — this is an additional-cost, additional-time review
  // beyond the standard run. Off by default; set ENABLE_FORMULA_DEEPDIVE=true
  // (or pass formulaDeepDive:true in the request body, for server.js) to enable.
  const wantsDeepDive = process.env.ENABLE_FORMULA_DEEPDIVE === 'true';
  // Wave 1 reasonableness checks — deterministic, always on (unlike
  // Formula Deep Dive these are cheap and don't need an opt-in gate).
  const reasonableness = (() => { try { return {
    waccOverride: checkWaccOverride(parsed._raw),
    terminalValue: checkTerminalValueConcentration(parsed._raw),
    outputs: checkOutputReasonableness(parsed._raw)
  }; } catch (e) { console.error('   \u26a0\ufe0f  Reasonableness checks failed:', e.message);
    return { waccOverride:{applicable:false}, terminalValue:{applicable:false}, outputs:{applicable:false} }; } })();
  const duplicateSheets = (() => { try { return detectDuplicateSheets(parsed.sheetNames); }
    catch (e) { console.error('   \u26a0\ufe0f  Duplicate-sheet scan failed:', e.message); return { applicable:false, flaggedCount:0, flagged:[] }; } })();
  const formulaDeepDive = wantsDeepDive
    ? await (async () => { try { return await runFormulaDeepDive(parsed, tier0, {}); }
        catch (e) { console.error('   \u26a0\ufe0f  Formula Deep Dive failed:', e.message); return { applicable:false, note:e.message, reviewed:0, findings:[] }; } })()
    : { applicable:false, note:'Not requested for this run.', reviewed:0, findings:[] };
  const errorScan = (() => { try { return scanFormulaErrors(parsed._raw); } catch (e) { console.error('   \u26a0\ufe0f  Error scan failed:', e.message); return []; } })();
  const redundantInputs = (() => { try { return detectRedundantInputs(parsed._raw); } catch (e) { console.error('   \u26a0\ufe0f  Redundant-input scan failed:', e.message); return { applicable:false, note:e.message, totalInputs:0, redundantCount:0, redundant:[], inputSheets:[] }; } })();
  const orphanSheets = (() => { try { return detectOrphanSheets(tier0.dependencyMap, parsed.sheetNames, redundantInputs.inputSheets || []); } catch (e) { console.error('   \u26a0\ufe0f  Orphan-sheet scan failed:', e.message); return { applicable:false, note:e.message, orphanSheets:[], financialStatementSheets:[], reachableSheets:[], totalSheets:0 }; } })();
  const namedRangeAudit = (() => { try { return detectNamedRangeIssues(parsed._raw); } catch (e) { console.error('   \u26a0\ufe0f  Named-range audit failed:', e.message); return { applicable:false, note:e.message, unused:[], poorlyNamed:[], broken:[], totalNamedRanges:0 }; } })();
  // Wave 2 — VBA/macro review. Deterministic (not opt-in, unlike Formula
  // Deep Dive) but genuinely async since it spawns a Python subprocess, so
  // it needs its own await rather than fitting the synchronous IIFE
  // pattern the checks above use.
  const vbaReview = await (async () => { try { return await runVbaReview(parsed._filePath); }
    catch (e) { console.error('   \u26a0\ufe0f  VBA/macro review failed:', e.message); return { applicable:false, note:e.message, hasVbaProject:false, findings:[] }; } })();

  // Encrypted workbook — stop here rather than continue into Familiarise/
  // Tier 1/Tier 2 against a file we've already confirmed we can't fully
  // see into for macro content.
  if (vbaReview.blockValidation) {
    console.log('❌ Workbook is password-encrypted — stopping validation');
    console.log(`   ${vbaReview.note}`);
    logAuditEvent({ event: 'vba_encrypted_blocked', originalName, source: 'cli' });
    runLog.stop();
    process.exit(1);
  }

  // ── Step 2: Familiarise ────────────────────────────────────────────────────
  console.log('[1/6] Familiarising with the model...');
  const modelSummary = await familiariseModel(parsed);
  const modelContext = formatSummaryAsContext(modelSummary);

  // ── Step 3: Classify + load domain skill ──────────────────────────────────
  console.log('\n[2/6] Classifying model type...');
  const modelType = modelSummary.model_type || 'generic';
  console.log(`   Model type: ${modelType}`);
  console.log(`   Industry: ${modelSummary.industry || 'unknown'}`);

  const domain = loadDomainSkill(modelType);
  console.log(`   Domain skill loaded: ${domain.file}`);

  // Opportunistic, non-blocking: if this model type has no dedicated
  // skill yet (domain.file === 'skill-generic.md'), queue a draft for
  // future review. Never awaited — this run already has what it needs
  // and must not be slowed down or put at risk by a new, less-tested
  // code path making its own LLM call.
  maybeQueueDomainDraft(modelType, modelSummary, parsed.sheetNames, domain);

  // ── Step 4: Pre-validation gate ────────────────────────────────────────────
  console.log('\n[3/6] Running pre-validation gate...');
  const preResult = preValidate(parsed);
  if (!preResult.passed) {
    console.log('❌ Pre-validation failed — stopping');
    preResult.results
      .filter(r => r.status === 'fail')
      .forEach(r => console.log(`   FAIL: ${r.check} → ${r.reason}`));
    process.exit(1);
  }
  console.log('✅ Pre-validation passed');

  // ── Step 5: Validation — single pass, flag only ────────────────────────────
  console.log('\n[4/6] Running validation...');
  const t1Results  = runTier1(parsed);
  const t1Pass     = t1Results.filter(r => r.status === 'pass').length;
  const t1Failures = t1Results.filter(r => r.status === 'fail');

  const t2Results  = await runTier2(parsed, {
    domain:      domain.content,
    modelContext,
    keySheets:   modelSummary.key_sheets,
    tier0Stats:  tier0.stats,
    tier0Risks:  tier0.riskIndicators,
    namedRangeAudit,
    vbaReview
  });
  const t2Pass     = t2Results.filter(r => r.status === 'pass').length;
  const t2Failures = t2Results.filter(r => r.status !== 'pass');

  console.log(`   Tier 1: ${t1Pass} pass, ${t1Failures.length} fail`);
  console.log(`   Tier 2: ${t2Pass} pass, ${t2Failures.length} issues`);

  // Deduplicate findings
  const seenKeys   = new Set();
  const allFlagged = [];
  const allFixes   = [];
  for (const f of [...t1Failures, ...t2Failures]) {
    const key = `${f.id}-${f.sheet || ""}`;
    if (!seenKeys.has(key)) { seenKeys.add(key); allFlagged.push(f); }
  }
  // Captured here, before any T0-* deterministic findings (redundant inputs,
  // orphan sheets, named ranges, reasonableness, duplicate sheets, VBA
  // review, etc.) get pushed below. Those checks aren't part of the 141-rule
  // checklist, so they must not dilute the score/completion % computed
  // against it later — allFlagged.length keeps growing below, but this
  // snapshot stays fixed at the true checklist-rule count.
  const checklistFindingCount = allFlagged.length;
  // Redundant-input finding (V11 §2) — deterministic; flows through the register.
  if (redundantInputs.applicable && redundantInputs.redundantCount > 0) {
    const _locs = redundantInputs.redundant.slice(0, 15).map(x => `${x.sheet}!${x.cell}`).join(', ');
    const _more = redundantInputs.redundantCount > 15 ? ` and ${redundantInputs.redundantCount - 15} more` : '';
    const _ratio = redundantInputs.redundantCount / Math.max(redundantInputs.totalInputs, 1);
    allFlagged.push({
      id: 'T0-RI-001',
      label: `${redundantInputs.redundantCount} input-sheet constant(s) not referenced by any formula`,
      severity: _ratio > 0.2 ? 'high' : 'medium',
      status: 'fail',
      sheet: redundantInputs.inputSheets[0],
      cell: (redundantInputs.redundant[0] || {}).cell || 'A1',
      condition: `${redundantInputs.redundantCount} of ${redundantInputs.totalInputs} numeric constants on ${redundantInputs.inputSheets.join(', ')} are not referenced by any static formula reference (including ranges, whole columns/rows and defined names): ${_locs}${_more}. ${redundantInputs.note}`,
      reason: `${redundantInputs.redundantCount} of ${redundantInputs.totalInputs} input constants unreferenced — examples: ${_locs}${_more}`,
      corrective_action: 'For each listed input: link it into the calculation chain, remove it, or relabel it as a memo item. Every retained assumption must demonstrably drive the model.',
      workstream: 'Inputs', category: 'Structure', issue_type: 'Redundant input',
      model_risk: 'Users may believe these assumptions drive the forecast when they affect nothing — scenario analysis over these inputs is meaningless and conclusions drawn from it unsafe.',
      key_output_impact: 'No', method: 'automated', needs_retest: true,
      root_cause: 'Orphaned / unlinked input', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 95
    });
  }
  // Orphan-sheet finding — deterministic; a whole calculation area that
  // never reaches the financial statements is more serious than a single
  // unused input, so this gets its own T1-level treatment.
  if (orphanSheets.applicable && orphanSheets.orphanSheets.length > 0) {
    const _sheets = orphanSheets.orphanSheets.join(', ');
    allFlagged.push({
      id: 'T0-LINK-001',
      label: `${orphanSheets.orphanSheets.length} sheet(s) have no traceable path to a financial statement`,
      severity: 'critical',
      status: 'fail',
      sheet: orphanSheets.orphanSheets[0],
      cell: 'A1',
      condition: `The following sheet(s) contain formulas but have no static reference path (direct or indirect, including named ranges) to a detected financial-statement sheet (${orphanSheets.financialStatementSheets.join(', ')}): ${_sheets}. ${orphanSheets.note}`,
      reason: `${orphanSheets.orphanSheets.length} sheet(s) not traceable to financial statements: ${_sheets}`,
      corrective_action: 'For each listed sheet: confirm whether it should feed the financial statements and link it in, or document why it is intentionally standalone.',
      workstream: 'Structure', category: 'Linkage', issue_type: 'Orphan sheet',
      model_risk: 'This sheet may calculate real values that never reach the reported outputs — assumptions here can be changed with no visible effect on the model, or a genuine result may be silently missing from the financial statements.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Sheet not linked to financial statements', escalation_flag: true,
      urgency: 'Before next reliance', confidence: 90
    });
  }
  // Named-range findings — unused (P2, may include legitimate benign
  // cases) and broken (P1, unambiguously wrong) get separate findings so
  // severity isn't diluted by mixing them.
  if (namedRangeAudit.applicable && namedRangeAudit.broken.length > 0) {
    const names = namedRangeAudit.broken.map(b => b.name).join(', ');
    allFlagged.push({
      id: 'T0-NR-001',
      label: `${namedRangeAudit.broken.length} named range(s) point to a broken or deleted reference`,
      severity: 'critical', status: 'fail',
      sheet: '', cell: 'A1', category: 'Linkage',
      condition: `The following named range(s) no longer resolve to a valid location: ${names}. Any formula that used to reference these would show #REF!/#NAME? errors.`,
      reason: `${namedRangeAudit.broken.length} broken named range(s): ${names}`,
      corrective_action: 'Repair or remove each broken named range; check whether any formula was relying on it before the underlying range was deleted.',
      workstream: 'Structure', category: 'Linkage', issue_type: 'Broken named range',
      model_risk: 'A broken named range signals a structural change (deleted sheet/range) that was not fully cleaned up — worth checking nothing else was silently affected.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Named range reference invalid', escalation_flag: true,
      urgency: 'Before next reliance', confidence: 95
    });
  }
  if (namedRangeAudit.applicable && namedRangeAudit.unused.length > 0) {
    const names = namedRangeAudit.unused.slice(0, 8).map(u => u.name).join(', ');
    allFlagged.push({
      id: 'T0-NR-002',
      label: `${namedRangeAudit.unused.length} named range(s) are defined but never referenced by any formula`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Linkage',
      condition: `The following named range(s) exist but no formula anywhere references them, by name or by the cell address they point to: ${names}${namedRangeAudit.unused.length > 8 ? ' and others' : ''}. A name whose wording suggests a key output (total, capex, revenue, debt) deserves particular attention.`,
      reason: `${namedRangeAudit.unused.length} unused named range(s)`,
      corrective_action: 'For each: confirm whether it should be linked into the model, or remove it if genuinely no longer needed.',
      workstream: 'Structure', category: 'Linkage', issue_type: 'Unused named range',
      model_risk: 'The underlying value may be a real output that never reaches the financial statements — the exact failure mode described in the capex linkage case study.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'Named range not referenced', escalation_flag: true,
      urgency: 'Before next reliance', confidence: 85
    });
  }
  // ── Opaque/dynamic reference finding (A1, adapted from audit-xls) ────────
  // INDIRECT() constructs a cell/sheet reference from a string at
  // calculation time, so the actual target cannot be confirmed just by
  // reading the formula — the closest deterministic, buildable proxy for
  // audit-xls's own concern: "flag any cells where the formula references
  // a different sheet without a sheet name." Split out from the combined
  // OFFSET/INDIRECT complexity scoring in validator-tier0.js specifically
  // so this can be its own named finding rather than silent noise inside
  // a general "OFFSET" count. Confirmed real on a genuine production file
  // (15 INDIRECT calls found on the Sunrise/KPMG model, previously
  // invisible under a combined OFFSET count of 34).
  if (tier0.stats && tier0.stats.totalIndirectCount > 0) {
    const cells = (tier0.riskIndicators.indirectCells || []).slice(0, 8)
      .map(c => `${c.sheet}!${c.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-INDIRECT-001',
      label: `${tier0.stats.totalIndirectCount} formula cell(s) use INDIRECT() to construct a reference from a string`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${tier0.stats.totalIndirectCount} formula cell(s) use INDIRECT(), including: ${cells}${tier0.stats.totalIndirectCount > 8 ? ' and others' : ''}. Because the reference is built from a string at calculation time, the actual target cell or sheet cannot be confirmed just by reading the formula — this is a materially more opaque pattern than a normal cell reference for anyone tracing the model's logic.`,
      reason: `${tier0.stats.totalIndirectCount} cell(s) use INDIRECT()`,
      corrective_action: 'Confirm what each INDIRECT() call actually resolves to at runtime, and consider replacing it with a direct cell reference where the target does not genuinely need to be computed dynamically.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Opaque dynamic reference',
      model_risk: 'A reference built from a string cannot be verified by reading the formula alone — if the string is ever wrong or the target is renamed/moved, the formula can silently point somewhere unintended without producing a visible error.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'INDIRECT() used to construct a dynamic reference',
      escalation_flag: false, urgency: 'Before next reliance', confidence: 100
    });
  }

  // ── A2 — SUM() ranges that exclude real data at either end ─────────────
  // Built and unit-tested against real files earlier, but never wired
  // into the actual pipeline until now — this is the connection that
  // makes it produce findings in a real report.
  const totalRangeCheck = (() => { try { return checkTotalRanges(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Total-range check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (totalRangeCheck.applicable && totalRangeCheck.findings.length > 0) {
    totalRangeCheck.findings.forEach((f, i) => {
      allFlagged.push({
        id: `T0-TOTALRANGE-${String(i + 1).padStart(3, '0')}`,
        label: `${f.sheet}!${f.cell} sums a range that excludes ${f.excludedCount} adjacent numeric row(s)`,
        severity: 'medium', status: 'fail',
        sheet: f.sheet, cell: f.cell, category: 'Structure',
        condition: f.note,
        reason: `SUM range (${f.sumRange}) does not match the real contiguous data block (${f.actualBlockRange})`,
        corrective_action: 'Confirm whether the excluded row(s) genuinely belong in this total. If so, extend the SUM range to include them — this is the classic symptom of a row inserted after the range was set.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Truncated SUM range',
        model_risk: 'A total that silently excludes real adjacent data understates whatever it feeds into, without producing any visible error.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: 'SUM range does not cover the full contiguous data block', escalation_flag: false,
        urgency: 'Before next reliance', confidence: 85
      });
    });
  }

  // ── A3 — Sign-convention inconsistency for the same line item ──────────
  // Same situation as A2 — built and tested standalone, never connected
  // to the pipeline until now.
  const signConventionCheck = (() => { try { return checkSignConventions(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Sign-convention check failed:', e.message); return { applicable:false, flaggedCount:0, results:[] }; } })();
  if (signConventionCheck.applicable && signConventionCheck.results.length > 0) {
    signConventionCheck.results.forEach((r, i) => {
      allFlagged.push({
        id: `T0-SIGNCONV-${String(i + 1).padStart(3, '0')}`,
        label: `"${r.label}" appears with inconsistent sign across the workbook`,
        severity: 'medium', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: r.note,
        reason: `${r.positiveCount} positive and ${r.negativeCount} negative instance(s) found for the same labelled line item`,
        corrective_action: 'Confirm the model\'s own sign convention for this line item and correct whichever instance(s) don\'t follow it — or confirm the difference is a deliberate, disclosed convention change between sheets.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Sign convention inconsistency',
        model_risk: 'A silently inconsistent sign convention can cause a value to be added where it should be subtracted (or vice versa) wherever it is later referenced.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: 'Same labelled line item has inconsistent sign across the workbook', escalation_flag: false,
        urgency: 'Before next reliance', confidence: 75
      });
    });
  }

  // ── A4 — Key-output dependency-chain tracing ────────────────────────────
  // Extends the existing sheet-level Sheet Dependency tab to actual
  // cell-level chain verification for key output cells specifically (not
  // every formula cell — key outputs are what a reader actually relies
  // on, and tracing all of them would be slow and mostly redundant given
  // how much real chains overlap). Deliberately worded as worth
  // confirming, not broken: a chain reaching a blank cell can mean a
  // genuinely missing input, but confirmed real on a production file that
  // it can just as easily be a benign, unpopulated future-period column —
  // this needs a human to judge, not an automatic fail.
  const keyOutputChainCheck = (() => { try { return checkKeyOutputChains(parsed._raw, tier0.cellScoreIndex, parsed.sheetNames); }
    catch (e) { console.error('   \u26a0\ufe0f  Key-output chain check failed:', e.message); return { applicable:false, flaggedCount:0, results:[] }; } })();
  if (keyOutputChainCheck.applicable && keyOutputChainCheck.results.length > 0) {
    keyOutputChainCheck.results.forEach((r, i) => {
      const affectedList = r.affectedOutputs.map(o => `${o.labelText} (${o.sheet}!${o.cell})`).join(', ');
      const isError = r.type === 'error_propagation';
      allFlagged.push({
        id: `T0-CHAIN-${String(i + 1).padStart(3, '0')}`,
        label: isError
          ? `${r.sheet}!${r.cell} holds a cached error (${r.value}) that ${r.affectedOutputs.length} key output(s) trace back through`
          : `${r.sheet}!${r.cell} is blank, and ${r.affectedOutputs.length} key output(s) trace back through it`,
        severity: 'medium', status: 'fail',
        sheet: r.sheet, cell: r.cell, category: 'Structure',
        condition: isError
          ? `Tracing the formula chain behind these key outputs back through their precedents reaches ${r.sheet}!${r.cell}, which holds a cached error value (${r.value}). Affected: ${affectedList}.`
          : `Tracing the formula chain behind these key outputs back through their precedents reaches ${r.sheet}!${r.cell}, which is blank — no formula and no value. Affected: ${affectedList}. This may be a genuinely missing input, or a template column for a period not yet populated — confirm which before treating this as an error.`,
        reason: isError ? `Cached error propagating to ${r.affectedOutputs.length} key output(s)` : `Blank cell reached by ${r.affectedOutputs.length} key output(s)`,
        corrective_action: isError
          ? 'Investigate and resolve the underlying error at its source rather than the symptom in each affected output.'
          : 'Confirm whether this cell is expected to be blank (e.g. a future period not yet reached) or is a genuinely missing input feeding these outputs.',
        workstream: 'Structure', category: 'Structure', issue_type: isError ? 'Error propagation to key output' : 'Key output chain reaches blank cell',
        model_risk: isError
          ? 'A cached error at the root of a chain means every key output depending on it is unreliable until the error is resolved.'
          : 'If genuinely missing rather than an expected placeholder, every key output depending on this cell is currently understating or misstating its true value.',
        key_output_impact: affectedList,
        method: 'automated', needs_retest: true,
        root_cause: isError ? 'Cached formula error at a shared precedent cell' : 'Shared precedent cell is blank',
        escalation_flag: false, urgency: 'Before next reliance', confidence: 70
      });
    });
  }

  // ── FAST Standard checks — four rules confirmed directly against a real
  // copy of the FAST Standard (02c, July 2019). Each aggregates into ONE
  // finding per check (not one per instance) — some of these (nested IFs
  // especially) can have hundreds of individual cells, and one finding
  // with a sample is far more useful than a flood of near-duplicates.
  const npvCheck = (() => { try { return checkBareNPV(tier0.cellScoreIndex); }
    catch (e) { console.error('   \u26a0\ufe0f  Bare NPV check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (npvCheck.applicable && npvCheck.findings.length > 0) {
    const sample = npvCheck.findings.slice(0, 8).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-NPV-001',
      label: `${npvCheck.findings.length} formula cell(s) use NPV() rather than XNPV()`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${npvCheck.findings.length} formula cell(s) use NPV(), including: ${sample}${npvCheck.findings.length > 8 ? ' and others' : ''}. NPV() assumes the first cash flow occurs exactly one period from today and every subsequent flow is evenly spaced — an assumption that rarely matches a real model's actual dates. XNPV (using actual dates) avoids this silent timing mismatch. This is a named rule in the FAST Standard (FAST 4.01-02).`,
      reason: `${npvCheck.findings.length} cell(s) use NPV() instead of XNPV()`,
      corrective_action: 'Confirm the timing assumption embedded in each NPV() call is actually correct for this model, or replace with XNPV using the model\'s real dates.',
      workstream: 'Structure', category: 'Structure', issue_type: 'NPV timing assumption',
      model_risk: 'A silent, uncommunicated assumption about cash flow timing can materially misstate a discounted value without ever producing a visible error.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
      root_cause: 'NPV() used instead of XNPV()', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 90
    });
  }

  const nestedIfCheck = (() => { try { return checkNestedIFs(tier0.cellScoreIndex); }
    catch (e) { console.error('   \u26a0\ufe0f  Nested IF check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (nestedIfCheck.applicable && nestedIfCheck.findings.length > 0) {
    const sheetCounts = {};
    nestedIfCheck.findings.forEach(f => { sheetCounts[f.sheet] = (sheetCounts[f.sheet] || 0) + 1; });
    const sheetSummary = Object.entries(sheetCounts).slice(0, 6).map(([s, c]) => `${s} (${c})`).join(', ');
    const sample = nestedIfCheck.findings.slice(0, 5).map(f => `${f.sheet}!${f.cell}`).join(', ');
    allFlagged.push({
      id: 'T0-NESTEDIF-001',
      label: `${nestedIfCheck.findings.length} formula cell(s) contain nested IF statements`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${nestedIfCheck.findings.length} formula cell(s) contain a nested IF (an IF statement inside another IF's own arguments), concentrated in: ${sheetSummary}. Examples: ${sample}. Nested IFs are a named FAST Standard anti-pattern (FAST 3.03-07) — they take materially longer to decode correctly and are prone to untested combinations of logical states.`,
      reason: `${nestedIfCheck.findings.length} cell(s) contain nested IF logic`,
      corrective_action: 'Consider replacing nested IFs with flag-based multiplication or INDEX/CHOOSE lookups where the logic allows — particularly for the highest-concentration sheets listed.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Nested IF statements',
      model_risk: 'Nested conditional logic is difficult to fully test — a combination of conditions that was never exercised during model construction can silently produce the wrong branch.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Nested IF statements', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 95
    });
  }

  const mergedCellCheck = (() => { try { return checkMergedCells(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Merged cell check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (mergedCellCheck.applicable && mergedCellCheck.findings.length > 0) {
    const totalMerges = mergedCellCheck.findings.reduce((sum, f) => sum + f.mergeCount, 0);
    const sheetSummary = mergedCellCheck.findings.slice(0, 8).map(f => `${f.sheet} (${f.mergeCount})`).join(', ');
    allFlagged.push({
      id: 'T0-MERGE-001',
      label: `${totalMerges} merged cell range(s) across ${mergedCellCheck.findings.length} sheet(s)`,
      severity: 'low', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${totalMerges} merged cell range(s) found across: ${sheetSummary}${mergedCellCheck.findings.length > 8 ? ' and others' : ''}. Merged cells break column/row selection consistency and are a named FAST Standard anti-pattern (FAST 4.02-02) — FAST's own stated concern is directly relevant to automated review: some model-audit tools will silently unmerge cells while processing a file, which can itself alter the workbook.`,
      reason: `${totalMerges} merged range(s) across ${mergedCellCheck.findings.length} sheet(s)`,
      corrective_action: 'Confirm merged cells are confined to presentation/header areas rather than calculation blocks — centre-across-selection formatting achieves the same visual effect without merging.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Merged cells',
      model_risk: 'Merged cells in or near calculation areas can silently drop values (only the upper-left cell of a merge retains its value) and complicate automated or manual review alike.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Merged cell ranges present', escalation_flag: false,
      urgency: 'When convenient', confidence: 100
    });
  }

  const hiddenCheck = (() => { try { return checkHiddenRowsColumns(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Hidden rows/columns check failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (hiddenCheck.applicable && hiddenCheck.findings.length > 0) {
    const sheetSummary = hiddenCheck.findings.slice(0, 8).map(f => `${f.sheet} (${f.hiddenRowCount} row(s), ${f.hiddenColCount} col(s))`).join(', ');
    allFlagged.push({
      id: 'T0-HIDDEN-001',
      label: `${hiddenCheck.findings.length} sheet(s) contain hidden rows or columns`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `Hidden rows and/or columns found on: ${sheetSummary}${hiddenCheck.findings.length > 8 ? ' and others' : ''}. This is distinct from the separate check for entirely hidden sheets — these are hidden ranges within otherwise-visible sheets. The FAST Standard names this explicitly (FAST 2.01-08): hidden ranges can conceal stale, overridden, or manipulated values from a reviewer who is only looking at what's visible.`,
      reason: `Hidden rows/columns found on ${hiddenCheck.findings.length} sheet(s)`,
      corrective_action: 'Unhide and review the contents of each hidden range to confirm nothing material is being concealed from a normal review.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Hidden rows or columns',
      model_risk: 'A hidden row or column is invisible during a normal visual review, and any manual override or stale value sitting inside one would not be caught without deliberately unhiding it.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Hidden rows or columns present', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 100
    });
  }

  // G1 — hardcoded check/reconciliation cells: a false-assurance risk
  // distinct from generic hardcode counting. High vs low confidence are
  // deliberately reported differently, not pooled — testing against real
  // files showed the low-confidence bucket is genuinely noisier (column
  // headers like "Expected"/"Actual"/"Status", period labels) than a
  // reliable finding set, while high-confidence (the value itself reads
  // as pass/fail/ok/0) has held up cleanly in testing.
  const hardcodedCheckResult = (() => { try { return checkHardcodedCheckCells(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Hardcoded check-cell scan failed:', e.message); return { applicable:false, flaggedCount:0, findings:[] }; } })();
  if (hardcodedCheckResult.applicable) {
    const highConf = hardcodedCheckResult.findings.filter(f => f.confidence === 'high');
    const lowConf = hardcodedCheckResult.findings.filter(f => f.confidence === 'low');
    if (highConf.length > 0) {
      const sample = highConf.slice(0, 8).map(f => `${f.sheet}!${f.cell} ("${f.label}" = ${JSON.stringify(f.value)})`).join(', ');
      const lowNote = lowConf.length > 0 ? ` A further ${lowConf.length} lower-confidence candidate(s) were also found but are more likely to be column headers or period labels than genuine check results — not included above, worth a manual glance if time allows.` : '';
      allFlagged.push({
        id: 'T0-HARDCHECK-001',
        label: `${highConf.length} check/reconciliation cell(s) appear hardcoded rather than formula-driven`,
        severity: 'high', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `${highConf.length} cell(s) in a check- or reconciliation-labeled row show a static, typed-in pass/fail-style value with no formula behind them: ${sample}.${lowNote} A hardcoded check result will keep showing the same outcome forever, regardless of what the underlying numbers actually do — the model could stop passing this test and the cell would never reflect it.`,
        reason: `${highConf.length} check cell(s) appear to be hardcoded rather than live`,
        corrective_action: 'Replace each flagged cell with a formula that genuinely compares the observed result against the expected result, rather than a static status.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Hardcoded check cell',
        model_risk: 'A check cell that cannot fail gives false assurance — a reviewer sees "PASS" and trusts it, without realising the cell never actually recalculates.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: 'Check result hardcoded rather than formula-driven', escalation_flag: false,
        urgency: 'Before next reliance', confidence: 85
      });
    }
  }

  // G7 — genuine circular-reference detection. The existing Tier 1
  // no_circular_references check has no real detection behind it — it
  // always reports "uncertain" with a static message asking the user to
  // check manually in Excel. This builds real graph-based cycle
  // detection and specifically classifies whether a cycle routes through
  // a distribution/funding-decision cell (dividend, cash sweep, minimum-
  // cash equity top-up) — a materially higher-risk pattern than the
  // common, often-intentional interest-on-average-balance circularity,
  // since a distribution or funding decision based on its own post-
  // decision cash outcome is a genuine logical trap, not just an
  // iterative-solve convenience.
  const circularRefResult = (() => { try { return checkCircularReferences(tier0.cellScoreIndex, parsed.sheetNames, parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Circular reference detection failed:', e.message); return { applicable:false, totalCycles:0, dividendRelatedCycles:[], otherCycles:[] }; } })();
  if (circularRefResult.applicable) {
    if (circularRefResult.dividendRelatedCycles.length > 0) {
      // Group by the shared distribution/funding cell — testing showed
      // the same underlying mechanism can surface as multiple distinct
      // cycle paths (e.g. one per adjacent time period), which reads as
      // one real issue, not several.
      const byCell = {};
      circularRefResult.dividendRelatedCycles.forEach(c => {
        if (!byCell[c.dividendCell]) byCell[c.dividendCell] = { label: c.dividendLabel, count: 0 };
        byCell[c.dividendCell].count++;
      });
      const summary = Object.entries(byCell).map(([cell, v]) => `${cell} ("${v.label}") — ${v.count} distinct cycle path(s)`).join('; ');
      const [sh, cl] = Object.keys(byCell)[0].split('!');
      allFlagged.push({
        id: 'T0-CIRC-001',
        label: `Circular reference routed through a distribution/funding decision`,
        severity: 'high', status: 'fail',
        sheet: sh, cell: cl, category: 'Structure',
        condition: `A genuine circular reference was found passing through: ${summary}. This is a distribution or funding-decision cell whose own formula depends, through a chain of precedents, on a cash balance that already reflects that same decision — the decision is calculated from its own outcome. Unlike the common, often-intentional interest-on-average-balance circularity, this pattern usually indicates a real logic error rather than a deliberate iterative-solve design choice.`,
        reason: `Circular reference through a distribution/funding-decision cell`,
        corrective_action: 'Trace the cycle in Excel (Formulas → Error Checking → Circular References) and confirm whether this is a genuine error or a deliberately iterative calculation. If deliberate, document the rationale on the Inputs sheet and confirm iterative calculation is enabled; if not, break the cycle by referencing a prior-period balance rather than the current period\'s post-decision balance.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Circular reference — distribution/funding',
        model_risk: 'A distribution or funding decision that depends on its own outcome can converge to an unstable or misleading result, or silently rely on Excel\'s iterative-calculation settings without anyone realising the model requires them.',
        key_output_impact: 'Yes', method: 'automated', needs_retest: true,
        root_cause: 'Circular reference through a distribution/funding-decision cell', escalation_flag: false,
        urgency: 'Before next reliance', confidence: 80
      });
    }
    if (circularRefResult.otherCycles.length > 0) {
      const sample = circularRefResult.otherCycles.slice(0, 3).map(c => c.path[0]).join(', ');
      allFlagged.push({
        id: 'T0-CIRC-002',
        label: `${circularRefResult.otherCycles.length} other circular reference chain(s) found`,
        severity: 'low', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `${circularRefResult.otherCycles.length} circular reference chain(s) found not involving a distribution/funding-decision cell, e.g. starting near: ${sample}. This may be a deliberate, common pattern such as interest calculated on an average debt or cash balance — not necessarily an error, but worth confirming iterative calculation is intentionally enabled and documented.`,
        reason: `${circularRefResult.otherCycles.length} circular reference chain(s) found`,
        corrective_action: 'Confirm each is a deliberate, documented circularity (e.g. interest on average balance) rather than an unintended error.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Circular reference — general',
        model_risk: 'An undocumented circular reference makes it unclear to a reviewer whether iterative calculation is required by design or is masking an error.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
        root_cause: 'Circular reference present', escalation_flag: false,
        urgency: 'When convenient', confidence: 75
      });
    }
  }

  // G8-G11 — inspired by patterns confirmed real in the
  // petehottelet/spreadsheet-auditor project. Each was tested against
  // real files and had at least one genuine false-positive class found
  // and fixed before being wired in here (see comments in
  // spreadsheet-auditor-checks.js for the specifics — a legitimate
  // cumulative-total pattern for G8, a dashboard-layout false positive
  // for G9's original design, requiring a whole-formula match for G9's
  // final design).
  const g8Result = (() => { try { return checkOffByOneRanges(tier0.cellScoreIndex); }
    catch (e) { console.error('   \u26a0\ufe0f  Off-by-one range check failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (g8Result.applicable && g8Result.findings.length > 0) {
    const sample = g8Result.findings.slice(0, 6).map(f => f.expectedEndCol
      ? `${f.cell} (ends at column ${f.actualEndCol}, its ${f.peerCount} peers mostly end at ${f.expectedEndCol})`
      : `${f.cell} (ends at row ${f.actualEndRow}, its ${f.peerCount} peers mostly end at ${f.expectedEndRow})`).join(', ');
    allFlagged.push({
      id: 'T0-OFFBYONE-001',
      label: `${g8Result.findings.length} aggregate range(s) appear shorter than their structural peers`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${g8Result.findings.length} aggregate formula(s) span a noticeably shorter range than other, structurally identical formulas nearby: ${sample}. Compared against peers (same function, same column, same range start) rather than judged in isolation — a real, specific majority pattern each of these deviates from, not a guess about what the range "should" be.`,
      reason: `${g8Result.findings.length} range(s) end earlier than their peer group's majority pattern`,
      corrective_action: 'Confirm whether the shorter range is intentional (e.g. this row genuinely covers a shorter period) or an unupdated range left behind when a column was inserted elsewhere in the block.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Off-by-one aggregate range',
      model_risk: 'A range that silently excludes the most recent period is a common, easy-to-miss error when new columns are inserted into an existing block.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'Aggregate range shorter than its peer group', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 70
    });
  }

  const g9Result = (() => { try { return checkAggregateResultMismatch(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Aggregate result mismatch check failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (g9Result.applicable && g9Result.findings.length > 0) {
    const sample = g9Result.findings.slice(0, 6).map(f => `${f.sheet}!${f.cell} (shows ${f.cachedResult.toLocaleString()}, its own range sums to ${f.independentSum.toLocaleString()})`).join(', ');
    allFlagged.push({
      id: 'T0-AGGMISMATCH-001',
      label: `${g9Result.findings.length} SUM formula(s) whose cached result doesn't match their own range`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${g9Result.findings.length} formula(s) whose stored, displayed result doesn't match an independent sum of their own explicit range's own cached values: ${sample}. This can mean either the file wasn't recalculated and saved with calculation enabled before delivery, or a genuine formula error.`,
      reason: `${g9Result.findings.length} formula(s) show a cached result inconsistent with their own range`,
      corrective_action: 'Open the file in Excel, force a full recalculation (Ctrl+Alt+F9), and re-save. If the mismatch persists after recalculation, it is a genuine formula error requiring investigation.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Stale or inconsistent aggregate result',
      model_risk: 'A displayed total that doesn\'t match its own underlying data is one of the most direct forms of misleading output a reviewer can encounter.',
      key_output_impact: 'Yes', method: 'automated', needs_retest: true,
      root_cause: 'Cached formula result inconsistent with its own range', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 90
    });
  }

  const g10Result = (() => { try { return checkRangeIncludesOwnTotal(tier0.cellScoreIndex, parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  Range-includes-own-total check failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (g10Result.applicable && g10Result.findings.length > 0) {
    const sample = g10Result.findings.slice(0, 6).map(f => `${f.cell} (range ${f.range} includes row ${f.subtotalRow}, labeled "${f.subtotalLabel}")`).join(', ');
    allFlagged.push({
      id: 'T0-RANGEDUP-001',
      label: `${g10Result.findings.length} SUM range(s) include a subtotal row within their own span`,
      severity: 'high', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${g10Result.findings.length} SUM formula(s) span a range that includes a row itself labeled as a total or subtotal, within the range rather than at its boundary: ${sample}. This likely double-counts that subtotal's own components alongside the subtotal itself.`,
      reason: `${g10Result.findings.length} range(s) likely double-count an internal subtotal`,
      corrective_action: 'Adjust the range to either sum only the line items (excluding the subtotal row) or only the subtotals (excluding the individual line items), not both.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Range includes its own subtotal',
      model_risk: 'A total that silently double-counts a subset of its own components can materially overstate a key figure without any visible error.',
      key_output_impact: 'Yes', method: 'automated', needs_retest: true,
      root_cause: 'Aggregate range includes an internal subtotal row', escalation_flag: false,
      urgency: 'Before next reliance', confidence: 80
    });
  }

  const g11Result = (() => { try { return checkSuspiciousErrorMasking(tier0.cellScoreIndex); }
    catch (e) { console.error('   \u26a0\ufe0f  Error-masking check failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (g11Result.applicable && g11Result.findings.length > 0) {
    const sample = g11Result.findings.slice(0, 8).map(f => `${f.cell} (${f.functionName} falls back to ${f.fallbackValue})`).join(', ');
    allFlagged.push({
      id: 'T0-ERRMASK-001',
      label: `${g11Result.findings.length} IFERROR/IFNA cell(s) fall back to a specific non-zero hardcoded value`,
      severity: 'medium', status: 'fail',
      sheet: '', cell: 'A1', category: 'Structure',
      condition: `${g11Result.findings.length} cell(s) use IFERROR or IFNA with a fallback to a specific, non-zero hardcoded number rather than 0 or blank: ${sample}. Falling back to 0 or blank for an expected edge case (e.g. an early-period ratio dividing by zero) is common and usually safe — falling back to a specific number is less common and can look like a plug masking whatever the underlying formula would otherwise have produced.`,
      reason: `${g11Result.findings.length} cell(s) mask errors with a specific non-zero fallback`,
      corrective_action: 'Confirm each flagged fallback value is a deliberate, reasoned default rather than a plug covering an unresolved formula issue.',
      workstream: 'Structure', category: 'Structure', issue_type: 'Non-zero error-masking fallback',
      model_risk: 'A hardcoded fallback value can silently substitute for a broken calculation indefinitely, with no visible indication anything is wrong.',
      key_output_impact: 'Unknown', method: 'automated', needs_retest: false,
      root_cause: 'IFERROR/IFNA falls back to a specific non-zero value', escalation_flag: false,
      urgency: 'When convenient', confidence: 65
    });
  }

  // G12 — PII detection. Deliberately conservative: two real false-
  // positive classes were found and fixed during testing (a naive
  // credit-card-number check matching digit sequences inside ordinary
  // numeric cell values converted to text, and the same risk for the
  // context-required checks) — every numeric-pattern check here now
  // requires the cell to be genuinely string-typed, since real PII is
  // almost always entered as text to preserve exact formatting, while a
  // financial figure is almost never coincidentally identical to a
  // properly-formatted card number, SSN, or IBAN.
  const piiResult = (() => { try { return checkPII(parsed._raw); }
    catch (e) { console.error('   \u26a0\ufe0f  PII scan failed:', e.message); return { applicable:false, findings:[] }; } })();
  if (piiResult.applicable && piiResult.findings.length > 0) {
    const highConf = piiResult.findings.filter(f => f.confidence === 'high');
    const lowConf = piiResult.findings.filter(f => f.confidence === 'low');
    if (highConf.length > 0) {
      const byType = {};
      highConf.forEach(f => { (byType[f.type] ||= []).push(`${f.sheet}!${f.cell}`); });
      const summary = Object.entries(byType).map(([type, cells]) => `${type}: ${cells.slice(0,5).join(', ')}${cells.length > 5 ? ` and ${cells.length-5} more` : ''}`).join('; ');
      const lowNote = lowConf.length > 0 ? ` A further ${lowConf.length} lower-confidence candidate(s) were also found, requiring row-label context to trigger — worth a manual glance.` : '';
      allFlagged.push({
        id: 'T0-PII-001',
        label: `${highConf.length} cell(s) appear to contain personally identifiable information`,
        severity: 'high', status: 'fail',
        sheet: '', cell: 'A1', category: 'Structure',
        condition: `${highConf.length} cell(s) contain data matching a recognised PII pattern: ${summary}.${lowNote} Values are not reproduced here — only the cell locations. This workbook may not be safe to share as broadly as a typical financial model, or the data may need to be removed or redacted before wider circulation.`,
        reason: `${highConf.length} cell(s) appear to contain PII`,
        corrective_action: 'Confirm whether this data is genuinely needed in the model; if not, remove it. If it is needed, restrict circulation of this workbook accordingly and consider whether it should be masked or moved to a separate, access-controlled file.',
        workstream: 'Structure', category: 'Structure', issue_type: 'Personally identifiable information detected',
        model_risk: 'A financial model is often circulated more broadly than its original author expects — investment committees, lenders, advisors. PII embedded in the workbook travels with it.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true,
        root_cause: 'Cell value matches a recognised PII pattern', escalation_flag: true,
        urgency: 'Before external circulation', confidence: 85
      });
    }
  }

    if (reasonableness.waccOverride.applicable && reasonableness.waccOverride.mismatch) {
      const w = reasonableness.waccOverride;
      allFlagged.push({
        id: 'T0-RSN-001', label: 'Calculated WACC differs from the applied discount rate',
        severity: 'high', status: 'fail', sheet: w.calculatedLocation.split('!')[0], cell: w.calculatedLocation.split('!')[1],
        category: 'Reasonableness', condition: w.note, reason: w.note,
        corrective_action: 'Document the rationale for the override explicitly next to the applied rate, or confirm the override was unintentional.',
        workstream: 'Valuation', issue_type: 'WACC override',
        model_risk: 'A silent override can mislead a reader into thinking the valuation is based on the calculated cost of capital when it is not.',
        key_output_impact: 'Yes', method: 'automated', needs_retest: true, root_cause: 'Discount rate override not documented',
        escalation_flag: false, urgency: 'Before external circulation', confidence: 90
      });
    }
    if (reasonableness.terminalValue.applicable && reasonableness.terminalValue.flagged) {
      const t = reasonableness.terminalValue;
      allFlagged.push({
        id: 'T0-RSN-002', label: `Terminal value represents ${(t.concentrationPct*100).toFixed(0)}% of total project NPV`,
        severity: 'high', status: 'fail', sheet: t.terminalValueLocation.split('!')[0], cell: t.terminalValueLocation.split('!')[1],
        category: 'Reasonableness', condition: t.note, reason: t.note,
        corrective_action: 'Sensitise the valuation to exit multiple compression and delayed exit timing; show what proportion of return is operating performance versus assumed exit.',
        workstream: 'Valuation', issue_type: 'Terminal value concentration',
        model_risk: 'A high proportion of total return depending on an assumed future exit, rather than demonstrated operating performance, is a higher-risk return profile than the headline NPV alone conveys.',
        key_output_impact: 'Yes', method: 'automated', needs_retest: false, root_cause: 'High reliance on terminal value',
        escalation_flag: false, urgency: 'Before external circulation', confidence: 85
      });
    }
    if (reasonableness.outputs.applicable && reasonableness.outputs.flaggedCount > 0) {
      const flaggedMetrics = reasonableness.outputs.results.filter(r => r.flagged);
      const summary = flaggedMetrics.map(r => `${r.metric} = ${r.unit==='percent' ? (r.value*100).toFixed(1)+'%' : r.value.toFixed(1)+'x'}`).join(', ');
      allFlagged.push({
        id: 'T0-RSN-003', label: `${flaggedMetrics.length} output metric(s) warrant explicit commercial-reasonableness challenge`,
        severity: 'high', status: 'fail', sheet: flaggedMetrics[0].location.split('!')[0], cell: flaggedMetrics[0].location.split('!')[1],
        category: 'Reasonableness',
        condition: `${summary}. ${reasonableness.outputs.note}`,
        reason: `Flagged: ${summary}`,
        corrective_action: 'Benchmark each flagged metric against comparable businesses; document why the model output is defensible or revise the underlying assumption.',
        workstream: 'Valuation', issue_type: 'Output reasonableness',
        model_risk: 'A model can be perfectly wired and still produce commercially unrealistic outputs — these are not automatically wrong, but require named, specific challenge before reliance.',
        key_output_impact: 'Yes', method: 'automated', needs_retest: false, root_cause: 'Aggressive underlying assumptions',
        escalation_flag: false, urgency: 'Before external circulation', confidence: 75
      });
    }
    if (duplicateSheets.applicable && duplicateSheets.flaggedCount > 0) {
      const names = duplicateSheets.flagged.map(f => f.sheet).join(', ');
      allFlagged.push({
        id: 'T0-DUP-001', label: `${duplicateSheets.flaggedCount} duplicate/backup sheet(s) detected`,
        severity: 'medium', status: 'fail', sheet: duplicateSheets.flagged[0].sheet, cell: 'A1',
        category: 'Model Control', condition: `${names}. ${duplicateSheets.note}`,
        reason: `Duplicate/backup sheet(s): ${names}`,
        corrective_action: 'For each: confirm which sheet is official, then archive or remove the other rather than leaving both in the live model.',
        workstream: 'Structure', issue_type: 'Duplicate sheet',
        model_risk: 'Backup sheets can contain stale outputs; investment committee materials can easily pick up the wrong dashboard or summary by mistake.',
        key_output_impact: 'Unknown', method: 'automated', needs_retest: true, root_cause: 'Duplicate sheet not archived',
        escalation_flag: false, urgency: 'Before next reliance', confidence: 90
      });
    }
  if (formulaDeepDive.findings && formulaDeepDive.findings.length) allFlagged.push(...formulaDeepDive.findings);
  if (vbaReview.findings && vbaReview.findings.length) allFlagged.push(...vbaReview.findings);
  console.log(`   ℹ️  ${allFlagged.length} items flagged`);
  // Per-rule outcomes for the Validation Matrix tab (pass + fail + uncertain)
  const ruleResults = [...t1Results, ...t2Results].map(r => ({
    id: r.id, status: r.status || 'uncertain',
    confidence: r.confidence ?? null, needs_retest: r.needs_retest ?? false
  }));


  // ── Step 6: Build report ───────────────────────────────────────────────────
  console.log('\n[5/6] Building validation report...');
  const baseName   = originalName.replace(/\.[^/.]+$/, '');
  const reportName = `${baseName}_VALIDATED.xlsx`;
  const reportPath = path.join(process.cwd(), 'processed', reportName);

  if (!fs.existsSync(path.join(process.cwd(), 'processed'))) {
    fs.mkdirSync(path.join(process.cwd(), 'processed'), { recursive: true });
  }


  // Build audit log
  const auditLog = [
    { timestamp: new Date().toISOString().substr(11,8), step: 'Parse', action: `Parsed ${parsed.sheetNames.length} sheets`, artifact: originalName, result: '✓ Pass', duration: '', notes: `${parsed.sheetNames.length} sheets` },
    { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 0', action: 'Formula scan', artifact: 'All sheets', result: '✓ Pass', duration: tier0.elapsed || '', notes: `${tier0.stats.uniqueFormulaCount} unique formulas` },
    { timestamp: new Date().toISOString().substr(11,8), step: 'Familiarise', action: 'Claude read all sheets', artifact: originalName, result: '✓ Pass', duration: '', notes: modelType },
    { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 1', action: `${t1Results.length} code checks`, artifact: `${t1Pass} pass · ${t1Failures.length} fail`, result: t1Failures.length > 0 ? '⚠ Issues' : '✓ Pass', duration: '', notes: '' },
    { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 2', action: '3 batches · 129 rules', artifact: 'Batches 1-3', result: t2Failures.length > 0 ? '⚠ Issues' : '✓ Pass', duration: '', notes: `${t2Pass} pass · ${t2Failures.length} issues` },
    { timestamp: new Date().toISOString().substr(11,8), step: 'VBA Review', action: 'Macro extraction + risk scan', artifact: vbaReview.hasVbaProject ? `${vbaReview.moduleCount} module(s)` : 'No VBA project', result: !vbaReview.applicable ? '⚠ Skipped' : (vbaReview.findings && vbaReview.findings.length ? '⚠ Issues' : '✓ Pass'), duration: '', notes: vbaReview.note || '' }
  ];
  const t2Meta = t2Results[0] && t2Results[0]._meta ? t2Results[0]._meta : {};
  const auditCompletion = t2Meta.audit_completion_percent || Math.round(((141 - checklistFindingCount) / 141) * 100);
  const auditCommentary = t2Meta.audit_completion_commentary || `The audit file has completed ${auditCompletion}% of the planned review procedures. Open items are listed by priority below.`;
  const overallAssessment = 'audit_complete';
  const igReadiness = auditCompletion;
  const igCommentary = auditCommentary;

  // Real resolved sheet names for the "Evidence Reviewed" column — cheap,
  // no LLM call, safe to compute again here independently of whatever
  // runTier2 itself did internally.
  const deepAccountingResolvedSheets = resolveDeepAccountingSheets(parsed.sheetNames);

  await buildReportFile(reportPath, allFlagged, allFixes, {
    originalName,
    modelType,
    modelIndustry:     modelSummary.industry,
    modelPurpose:      modelSummary.model_purpose,
    modelSummary,
    tier0,
    auditLog,
    overallAssessment,
    igReadiness,
    igCommentary,
    domainSkill:       domain.file,
    modelTier:         'Tier 1',
    reviewMode:        'llm_only',
    ruleResults,
    errorScan,
    redundantInputs,
    orphanSheets,
    namedRangeAudit,
    formulaDeepDive,
    reasonableness,
    duplicateSheets,
    vbaReview,
    deepAccountingResolvedSheets
  });

  // ── Step 7: Upload + notify ────────────────────────────────────────────────
  console.log('\n[6/6] Uploading report and notifying...');
  const { reportResult } = await uploadBothFiles(reportPath, reportName, FOLDER_ID);

  await sendNotification({
    originalName,
    outputName:     reportName,
    webViewLink:    reportResult.webViewLink,
    totalIssues:    allFlagged.length,
    autoFixed:      0,
    needsAttention: allFlagged.length,
    modelType,
    modelIndustry:  modelSummary.industry
  });

  // Local disk is a working directory only — Drive (with its own retention
  // sweep) is the retained artefact.
  fs.unlink(reportPath, () => {});
  logAuditEvent({ event: 'report_delivered', originalName, reportName, source: 'cli', issueCount: allFlagged.length, runLog: runLog.filename });
  runLog.stop();

  // One-off sweep for this run — covers CLI-only usage where server.js's
  // hourly cron isn't running in this process.
  await runRetentionSweep({
    uploadsDir:   path.join(process.cwd(), 'uploads'),
    processedDir: path.join(process.cwd(), 'processed'),
    folderId:     FOLDER_ID
  }).catch(e => console.error('Retention sweep failed:', e.message));

  console.log('\n─────────────────────────────────────');
  console.log('FM VALIDATOR — complete');
  console.log(`Model type:       ${modelType} — ${modelSummary.industry || 'unknown'}`);
  console.log(`Needs attention:  ${allFlagged.length}`);
  console.log(`Report file:      ${reportName}`);
  console.log('Note: Original file unchanged');
  console.log('─────────────────────────────────────\n');
}

run().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error('Stack:', err.stack);
  logAuditEvent({ event: 'validation_error', source: 'cli', error: err.message });
  try { runLog.stop(); } catch (_) {}
  process.exit(1);
});
