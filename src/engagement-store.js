const fs = require('fs');
const path = require('path');

const ENGAGEMENTS_STORE_DIR = path.join(__dirname, '..', 'engagements-store');
if (!fs.existsSync(ENGAGEMENTS_STORE_DIR)) fs.mkdirSync(ENGAGEMENTS_STORE_DIR, { recursive: true });

// Deliberately a separate directory from orchestrate.js's own
// ENGAGEMENTS_DIR (which holds the raw Phase A/B output files
// themselves) - this directory holds one real, structured record per
// engagement, tracking status and linking to those raw files, not the
// raw files themselves.

function recordFilePath(engagementId) {
  return path.join(ENGAGEMENTS_STORE_DIR, `${engagementId}.json`);
}

/**
 * Creates a new engagement record. Uses the same 'wx' atomic-create
 * guard as fm-validator's own order-store.js - refuses to silently
 * overwrite an existing engagement with the same id.
 */
function createEngagement({ engagementId, orderId, modelName }) {
  if (!engagementId) throw new Error('engagementId is required');
  const record = {
    engagementId,
    orderId: orderId || null,
    modelName: modelName || null,
    status: 'queued', // queued | phase_a_running | phase_a_complete | phase_b_running | complete | failed
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
    phaseAFrozenPath: null,
    phaseBResultPath: null,
    verdict: null, // set once Phase B completes - a short, real summary for the admin list view
  };
  try {
    fs.writeFileSync(recordFilePath(engagementId), JSON.stringify(record, null, 2), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') throw new Error(`An engagement with id "${engagementId}" already exists.`);
    throw err;
  }
  return record;
}

function getEngagement(engagementId) {
  try {
    return JSON.parse(fs.readFileSync(recordFilePath(engagementId), 'utf8'));
  } catch (err) {
    return null;
  }
}

function updateEngagement(engagementId, updates) {
  const existing = getEngagement(engagementId);
  if (!existing) return null;
  const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  fs.writeFileSync(recordFilePath(engagementId), JSON.stringify(updated, null, 2));
  return updated;
}

function listEngagements() {
  return fs.readdirSync(ENGAGEMENTS_STORE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(ENGAGEMENTS_STORE_DIR, f), 'utf8'));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = { createEngagement, getEngagement, updateEngagement, listEngagements, ENGAGEMENTS_STORE_DIR };
