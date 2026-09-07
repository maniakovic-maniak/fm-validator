// Runs a complete, real Partner Review engagement end to end - Phase A
// (blind), freeze, Phase B (reveal and compare) - with genuine status
// tracking in the engagement store at every step.
//
// Usage (also how admin/server.js spawns this as a child process):
//   node --env-file=.env run-engagement.js \
//     <engagementId> <orderId> /path/to/export.json /path/to/report.json
//
// The visibility record, if present, is read directly from export.json's
// own visibilityRecord field - no separate argument needed.

const fs = require('fs');
const { runPhaseA, freezePhaseA, runPhaseB, savePhaseBResult, ENGAGEMENTS_DIR } = require('./src/orchestrate');
const { createEngagement, getEngagement, updateEngagement } = require('./src/engagement-store');

async function runEngagement(engagementId, orderId, exportPath, reportPath) {
  // Genuinely resume-safe: if this engagement already exists (e.g. a
  // prior attempt crashed after Phase A completed), don't silently
  // recreate it - use what's already there so status history isn't lost.
  let engagement = getEngagement(engagementId);

  try {
    if (!engagement) {
      const { fullExport } = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
      engagement = createEngagement({ engagementId, orderId, modelName: fullExport.originalName });
    }

    const { batches, visibilityRecord } = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    let frozenPath = engagement.phaseAFrozenPath;
    if (!frozenPath) {
      updateEngagement(engagementId, { status: 'phase_a_running' });
      console.log(`[${engagementId}] Running Phase A - blind independent review...`);
      const phaseAResult = await runPhaseA(engagementId, batches);
      frozenPath = freezePhaseA(engagementId, phaseAResult);
      updateEngagement(engagementId, { status: 'phase_a_complete', phaseAFrozenPath: frozenPath });
      console.log(`[${engagementId}] Phase A complete and frozen - ${phaseAResult.findings.length} independent finding(s).`);
    } else {
      console.log(`[${engagementId}] Phase A already complete from a prior run - reusing the frozen result, not re-running it.`);
    }

    updateEngagement(engagementId, { status: 'phase_b_running' });
    console.log(`[${engagementId}] Running Phase B - reveal and compare...`);
    const phaseBResult = await runPhaseB(frozenPath, reportData, visibilityRecord);
    const resultPath = savePhaseBResult(engagementId, phaseBResult);

    // A short, real, genuinely useful verdict for the admin list view -
    // not the full result, just enough to see at a glance whether this
    // engagement is worth opening.
    const genuineMisses = phaseBResult.independentFindingClassifications.filter(
      f => f.classification === 'Missed entirely' && f.visibilityStatus === 'within_visibility_genuine_miss'
    ).length;
    const verdict = `${phaseBResult.independentFindingClassifications.length} independent finding(s) compared, ${genuineMisses} genuine miss(es) identified.`;

    updateEngagement(engagementId, { status: 'complete', phaseBResultPath: resultPath, verdict });
    console.log(`[${engagementId}] Complete. ${verdict}`);
    return { success: true, engagementId, verdict };
  } catch (err) {
    // If even the initial engagement record couldn't be created (e.g.
    // exportPath itself was invalid, so we never learned the model
    // name), still create a minimal, real record now - a failure that
    // vanishes without a trace defeats the entire point of tracking
    // status at all.
    if (!getEngagement(engagementId)) {
      try { createEngagement({ engagementId, orderId }); } catch (_) { /* genuinely nothing more we can do here */ }
    }
    updateEngagement(engagementId, { status: 'failed', error: err.message });
    console.error(`[${engagementId}] Failed:`, err.message);
    return { success: false, engagementId, error: err.message };
  }
}

if (require.main === module) {
  const [engagementId, orderId, exportPath, reportPath] = process.argv.slice(2);
  if (!engagementId || !exportPath || !reportPath) {
    console.error('Usage: node run-engagement.js <engagementId> <orderId> /path/to/export.json /path/to/report.json');
    process.exit(1);
  }
  runEngagement(engagementId, orderId, exportPath, reportPath).then(result => {
    process.exit(result.success ? 0 : 1);
  });
}

module.exports = { runEngagement };
