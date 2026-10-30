'use strict';
// Patch 48. Finds the approved decision-thresholds file for a model and turns the recalculation's decision results into log lines.
// Only config/decision-thresholds/<model-key>.json is used. A ".proposed.json" file is a draft and is never read here.
const fs = require('fs');
const path = require('path');
const { slug } = require('./output-registry');

const DIR = path.join(__dirname, '..', '..', 'config', 'decision-thresholds');

function thresholdsPathFor(modelName, dir = DIR) {
  try {
    const p = path.join(dir, slug(modelName) + '.json');
    return fs.existsSync(p) ? p : null;
  } catch (_) { return null; }
}

function decisionLogLines(result) {
  const dt = result && result.decision_tests;
  if (!dt) return [];
  if (dt.status !== 'ran') return [`   ⚠️  Decision thresholds not used (${dt.file}): ${(dt.problems || []).slice(0, 2).join('; ')}`];
  return (dt.results || []).map(r => {
    const note = r.decision_changed ? 'DECISION DIFFERS' : (r.cells_tested ? 'no decision changes' : 'not confirmed');
    const why = r.cells_not_recalculated ? `; ${r.cells_not_recalculated} cell(s) not recalculated` + (r.not_recalculated_because && Object.keys(r.not_recalculated_because).length ? ` (${Object.keys(r.not_recalculated_because)[0]})` : '') : '';
    return `   ℹ️  Threshold ${r.id} (${r.operator} ${r.threshold}${r.units}): ${r.cells_tested} cell(s) tested, ${note}${why}`;
  });
}

module.exports = { thresholdsPathFor, decisionLogLines, DIR };
