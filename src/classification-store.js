// src/classification-store.js — the storage layer for the 4-category
// feedback loop. Matches this project's own established pattern
// (orders/*.json, engagements-store/*.json) - a real, simple JSON
// file per engagement, not a new database dependency. Genuinely
// deployable tonight without any new infrastructure decision.
//
// One file per engagement: classifications/<engagementId>.json
// Each file holds an array of classification records for that
// engagement's findings.

const fs = require('fs');
const path = require('path');

const CLASSIFICATIONS_DIR = path.join(__dirname, '..', 'classifications');

const VALID_CATEGORIES = [1, 2, 3, 4];
const CATEGORY_LABELS = {
  1: 'Confirmed correct',
  2: 'Confirmed wrong',
  3: 'Directionally right, wrong specifics',
  4: 'Genuinely unresolvable by this mechanism',
};

function ensureDirReady() {
  if (!fs.existsSync(CLASSIFICATIONS_DIR)) {
    fs.mkdirSync(CLASSIFICATIONS_DIR, { recursive: true });
  }
}

function filePathFor(engagementId) {
  const safeId = String(engagementId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(CLASSIFICATIONS_DIR, `${safeId}.json`);
}

function loadEngagement(engagementId) {
  const p = filePathFor(engagementId);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`Real, existing classification file for "${engagementId}" is corrupt: ${err.message}`);
  }
}

function saveEngagement(engagementId, records) {
  ensureDirReady();
  fs.writeFileSync(filePathFor(engagementId), JSON.stringify(records, null, 2));
}

/**
 * Add one real classification record. findingId and engagementId
 * must be the real, existing IDs the finding is already known by
 * (matching the Issue Log / Validation Matrix / Partner Review
 * report), so a classification can always be traced back to the
 * real finding it's about.
 */
function classify({ findingId, engagementId, category, reviewerNote, reviewedBy }) {
  if (!findingId) throw new Error('findingId is required - must match a real, existing finding ID');
  if (!engagementId) throw new Error('engagementId is required');
  if (!VALID_CATEGORIES.includes(category)) {
    throw new Error(`category must be one of ${VALID_CATEGORIES.join(', ')} - got ${category}`);
  }
  if (!reviewedBy) throw new Error('reviewedBy is required - who is making this classification');

  const records = loadEngagement(engagementId);
  const record = {
    findingId: String(findingId),
    engagementId: String(engagementId),
    category,
    categoryLabel: CATEGORY_LABELS[category],
    reviewerNote: reviewerNote || '',
    reviewedBy,
    reviewedAt: new Date().toISOString(),
  };
  records.push(record);
  saveEngagement(engagementId, records);
  return record;
}

/**
 * Real, direct query across every classification ever recorded,
 * across every engagement - needed for the aggregation view the
 * design doc calls out as the actual payoff (e.g. "rule X has 6
 * category-3 classifications out of 8 total"). Reads every real
 * classification file on disk; fine for the real volume this
 * feature will see for a long time - revisit if that changes.
 */
function loadAll() {
  ensureDirReady();
  const files = fs.readdirSync(CLASSIFICATIONS_DIR).filter(f => f.endsWith('.json'));
  const all = [];
  for (const f of files) {
    const engagementId = f.replace(/\.json$/, '');
    const records = loadEngagement(engagementId);
    all.push(...records);
  }
  return all;
}

/**
 * Real aggregation by rule ID (the prefix of findingId before any
 * per-instance suffix, e.g. "T2-S10-505" itself is already the rule
 * ID for Tier 2 findings). Returns, per rule ID, the real category
 * distribution - the concrete first version of the aggregation view
 * the design doc scopes.
 */
function aggregateByRule() {
  const all = loadAll();
  const byRule = {};
  for (const rec of all) {
    if (!byRule[rec.findingId]) {
      byRule[rec.findingId] = { 1: 0, 2: 0, 3: 0, 4: 0, total: 0 };
    }
    byRule[rec.findingId][rec.category]++;
    byRule[rec.findingId].total++;
  }
  return byRule;
}

module.exports = {
  classify,
  loadEngagement,
  loadAll,
  aggregateByRule,
  VALID_CATEGORIES,
  CATEGORY_LABELS,
};
