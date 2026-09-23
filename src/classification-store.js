// src/classification-store.js — the storage layer for the supervisor
// approval workflow. Revised from the original 4-category version:
// the supervisor now sets approved (true/false) + priority
// ('must_fix' | 'nice_to_fix'), rather than the original 1-4
// judgment categories. Same real JSON-file pattern as before
// (orders/*.json, engagements-store/*.json).
//
// One file per engagement: classifications/<engagementId>.json

const fs = require('fs');
const path = require('path');

const CLASSIFICATIONS_DIR = path.join(__dirname, '..', 'classifications');

const VALID_PRIORITIES = ['must_fix', 'nice_to_fix'];

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
 * Real, direct supervisor decision on one finding.
 *
 * approved=true requires a real priority ('must_fix' or 'nice_to_fix').
 * approved=false is a genuine soft delete: the record is kept (with
 * reviewerNote preserved) so the reasoning behind rejecting a
 * finding isn't lost, but it's excluded from the active review
 * queue going forward - see loadUnclassified()'s own exclusion
 * logic, which checks this same real, existing record.
 */
function reviewFinding({ findingId, engagementId, approved, priority, reviewerNote, reviewedBy }) {
  if (!findingId) throw new Error('findingId is required - must match a real, existing finding ID');
  if (!engagementId) throw new Error('engagementId is required');
  if (typeof approved !== 'boolean') throw new Error('approved must genuinely be true or false');
  if (approved && !VALID_PRIORITIES.includes(priority)) {
    throw new Error(`An approved finding requires a real priority - one of ${VALID_PRIORITIES.join(', ')} - got ${priority}`);
  }
  if (!reviewedBy) throw new Error('reviewedBy is required - who is making this decision');

  const records = loadEngagement(engagementId);
  const record = {
    findingId: String(findingId),
    engagementId: String(engagementId),
    approved,
    priority: approved ? priority : null,
    status: approved ? 'approved' : 'irrelevant',
    reviewerNote: reviewerNote || '',
    reviewedBy,
    reviewedAt: new Date().toISOString(),
  };
  records.push(record);
  saveEngagement(engagementId, records);
  return record;
}

/**
 * Real, direct batch version of reviewFinding() - approves or
 * rejects several findings in one call, all with the same priority
 * and reviewer, matching the "select all, set priority once" real
 * workflow. Returns the array of real records written, in the same
 * order as the input findingIds.
 */
function reviewFindingsBatch({ findingIds, engagementId, approved, priority, reviewerNote, reviewedBy }) {
  if (!Array.isArray(findingIds) || findingIds.length === 0) {
    throw new Error('findingIds must genuinely be a real, non-empty array');
  }
  return findingIds.map(findingId =>
    reviewFinding({ findingId, engagementId, approved, priority, reviewerNote, reviewedBy })
  );
}

/**
 * Real, direct query across every review decision ever recorded,
 * across every engagement.
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
 * The real, actual fix queue - every approved finding, across every
 * engagement, genuinely ordered must_fix first. This is the concrete
 * artifact the supervisor hands off for execution.
 */
function loadApprovedFixQueue() {
  const all = loadAll();
  const approved = all.filter(r => r.approved);
  const priorityOrder = { must_fix: 0, nice_to_fix: 1 };
  approved.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  return approved;
}

module.exports = {
  reviewFinding,
  reviewFindingsBatch,
  loadEngagement,
  loadAll,
  loadApprovedFixQueue,
  VALID_PRIORITIES,
};
