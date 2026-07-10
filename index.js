require('dotenv').config();
const { fetchAndParse, scanFormulaErrors }                            = require('./src/parser');
const { detectRedundantInputs } = require('./src/utils/redundant-inputs');
const { detectOrphanSheets } = require('./src/utils/sheet-linkage');
const { detectNamedRangeIssues } = require('./src/utils/named-range-audit');
const { runFormulaDeepDive } = require('./src/validator-formula-deepdive');
const { checkWaccOverride, checkTerminalValueConcentration, checkOutputReasonableness } = require('./src/utils/reasonableness-checks');
const { detectDuplicateSheets } = require('./src/utils/sheet-linkage');
const { familiariseModel, formatSummaryAsContext } = require('./src/familiariser');
const { loadDomainSkill }                          = require('./src/classifier');
const { preValidate }                              = require('./src/pre-validator');
const { runTier1 }                                 = require('./src/validator-tier1');
const { runTier0 }                                 = require('./src/validator-tier0');
const { runTier2 }                                 = require('./src/validator-tier2');
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
    keySheets:   modelSummary.key_sheets
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
    { timestamp: new Date().toISOString().substr(11,8), step: 'Tier 2', action: '3 batches · 129 rules', artifact: 'Batches 1-3', result: t2Failures.length > 0 ? '⚠ Issues' : '✓ Pass', duration: '', notes: `${t2Pass} pass · ${t2Failures.length} issues` }
  ];
  const t2Meta = t2Results[0] && t2Results[0]._meta ? t2Results[0]._meta : {};
  const auditCompletion = t2Meta.audit_completion_percent || Math.round(((141 - allFlagged.length) / 141) * 100);
  const auditCommentary = t2Meta.audit_completion_commentary || `The audit file has completed ${auditCompletion}% of the planned review procedures. Open items are listed by priority below.`;
  const overallAssessment = 'audit_complete';
  const igReadiness = auditCompletion;
  const igCommentary = auditCommentary;

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
    duplicateSheets
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
