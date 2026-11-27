#!/usr/bin/env python3
# apply-review-queue-v2.py — upgrades the Review Queue from the
# step-2 "4-category" version to the step-3 supervisor
# approve/reject + priority workflow. Assumes step 2's own
# apply-review-queue.py has already been run - this is a genuine
# UPGRADE, not a fresh install.
#
# Tested end-to-end against the real, actual step-2-deployed file
# state before being handed over.
#
# Run this FROM the ~/fm-validator directory on the server.
# Usage: python3 apply-review-queue-v2.py

import sys

SERVER_PATH = 'admin/server.js'
HTML_PATH = 'admin/public/index.html'

with open(SERVER_PATH) as f:
    server = f.read()
with open(HTML_PATH) as f:
    html = f.read()

# ── server.js: update the require() line ──
old_require = "const { classify, loadEngagement } = require('../src/classification-store');"
new_require = "const { reviewFinding, reviewFindingsBatch, loadEngagement, loadApprovedFixQueue } = require('../src/classification-store');"
if old_require not in server:
    sys.exit(f"FAILED: require anchor not found in {SERVER_PATH} - this suggests step 2's script hasn't been run yet, or the file has changed. Aborting without modifying anything.")
server = server.replace(old_require, new_require)

# ── server.js: replace POST /api/classifications with the three new endpoints ──
old_endpoint = """app.post('/api/classifications', (req, res) => {
  try {
    const record = classify(req.body || {});
    res.json({ success: true, record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});"""

new_endpoints = """app.post('/api/review', (req, res) => {
  try {
    const record = reviewFinding(req.body || {});
    res.json({ success: true, record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/review/batch', (req, res) => {
  try {
    const records = reviewFindingsBatch(req.body || {});
    res.json({ success: true, records });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/fix-queue', (req, res) => {
  try {
    res.json({ findings: loadApprovedFixQueue() });
  } catch (err) {
    res.status(500).json({ error: 'An unexpected error occurred loading the fix queue.' });
  }
});"""

if old_endpoint not in server:
    sys.exit(f"FAILED: old endpoint anchor not found in {SERVER_PATH} - aborting without modifying anything.")
server = server.replace(old_endpoint, new_endpoints)

with open(SERVER_PATH, 'w') as f:
    f.write(server)
print(f"OK: {SERVER_PATH} updated")

# ── index.html: replace the table + add approve/reject controls ──
old_table = '''
  <table id="reviewQueueTable" style="display:none">
    <thead>
      <tr>
        <th>Finding</th>
        <th>Order</th>
        <th>Source</th>
        <th>Original classification</th>
        <th>Rationale</th>
        <th>Classify</th>
      </tr>
    </thead>
    <tbody id="reviewQueueBody"></tbody>
  </table>

  <div class="empty-state" id="reviewQueueEmptyState" style="display:none">No unclassified findings - everything's been reviewed.</div>
</div>'''

new_table = '''
  <table id="reviewQueueTable" style="display:none">
    <thead>
      <tr>
        <th><input type="checkbox" id="reviewQueueSelectAll" onclick="toggleSelectAllReviewQueue(this)"></th>
        <th>Finding</th>
        <th>Order</th>
        <th>Source</th>
        <th>Original classification</th>
        <th>Rationale</th>
        <th>Priority</th>
      </tr>
    </thead>
    <tbody id="reviewQueueBody"></tbody>
  </table>
  <div style="margin-top: 12px;">
    <button onclick="approveSelectedReviewQueue()">Approve selected</button>
    <button onclick="rejectSelectedReviewQueue()">Mark selected irrelevant</button>
    <span id="reviewQueueSelectedCount"></span>
  </div>

  <div class="empty-state" id="reviewQueueEmptyState" style="display:none">No unclassified findings - everything's been reviewed.</div>
</div>'''

if old_table not in html:
    sys.exit(f"FAILED: table anchor not found in {HTML_PATH} - aborting without modifying anything.")
html = html.replace(old_table, new_table)

# ── index.html: replace the review-queue <script>...</script> block ──
script_marker = "<script>\nlet reviewQueueFindings"
if script_marker not in html:
    sys.exit(f"FAILED: review-queue script block not found in {HTML_PATH} - aborting without modifying anything.")
start_idx = html.index(script_marker)
end_idx = html.index("</script>", start_idx) + len("</script>")
old_script_block = html[start_idx:end_idx]

new_script_block = '''<script>
let reviewQueueFindings = [];
let reviewQueuePriorities = {};

function renderReviewQueue() {
  document.getElementById('reviewQueueCount').textContent =
    `${reviewQueueFindings.length} unclassified finding${reviewQueueFindings.length !== 1 ? 's' : ''}`;

  if (reviewQueueFindings.length === 0) {
    document.getElementById('reviewQueueEmptyState').style.display = 'block';
    document.getElementById('reviewQueueTable').style.display = 'none';
    return;
  }
  document.getElementById('reviewQueueEmptyState').style.display = 'none';
  document.getElementById('reviewQueueTable').style.display = 'table';

  document.getElementById('reviewQueueBody').innerHTML = reviewQueueFindings.map((f, i) => {
    if (!(f.findingId in reviewQueuePriorities)) reviewQueuePriorities[f.findingId] = 'must_fix';
    const priority = reviewQueuePriorities[f.findingId];
    return `
      <tr>
        <td><input type="checkbox" class="review-queue-row-check" data-index="${i}"></td>
        <td>${f.findingId}</td>
        <td>${f.orderId || '\\u2014'}</td>
        <td>${f.source}</td>
        <td>${f.classification || '\\u2014'}</td>
        <td style="max-width: 320px;">${(f.rationale || '\\u2014').slice(0, 200)}</td>
        <td>
          <select onchange="setReviewQueuePriority('${f.findingId}', this.value)">
            <option value="must_fix" ${priority === 'must_fix' ? 'selected' : ''}>Must fix</option>
            <option value="nice_to_fix" ${priority === 'nice_to_fix' ? 'selected' : ''}>Nice to fix</option>
          </select>
        </td>
      </tr>
    `;
  }).join('');
  updateReviewQueueSelectedCount();
}

function setReviewQueuePriority(findingId, value) {
  reviewQueuePriorities[findingId] = value;
}

function toggleSelectAllReviewQueue(checkbox) {
  document.querySelectorAll('.review-queue-row-check').forEach(c => c.checked = checkbox.checked);
  updateReviewQueueSelectedCount();
}

function getSelectedReviewQueueIndexes() {
  return Array.from(document.querySelectorAll('.review-queue-row-check:checked'))
    .map(c => parseInt(c.dataset.index, 10));
}

function updateReviewQueueSelectedCount() {
  const n = document.querySelectorAll('.review-queue-row-check:checked').length;
  document.getElementById('reviewQueueSelectedCount').textContent = n > 0 ? `${n} selected` : '';
}

document.addEventListener('change', (e) => {
  if (e.target.classList && e.target.classList.contains('review-queue-row-check')) {
    updateReviewQueueSelectedCount();
  }
});

async function loadReviewQueue() {
  const countEl = document.getElementById('reviewQueueCount');
  try {
    countEl.textContent = 'Checking for updates\\u2026';
    const res = await fetch('api/classifications/unclassified');
    if (!res.ok) {
      const err = await res.json();
      countEl.textContent = err.error || 'Could not load the review queue';
      return;
    }
    const data = await res.json();
    reviewQueueFindings = data.findings || [];
    renderReviewQueue();
  } catch (err) {
    countEl.textContent = 'Could not load the review queue';
    console.error(err);
  }
}

async function submitReviewQueueBatch(approved) {
  const indexes = getSelectedReviewQueueIndexes();
  if (indexes.length === 0) {
    alert('Select at least one finding first.');
    return;
  }
  const selected = indexes.map(i => reviewQueueFindings[i]);

  const groups = {};
  for (const f of selected) {
    const priority = reviewQueuePriorities[f.findingId] || 'must_fix';
    const key = `${f.engagementId}::${priority}`;
    if (!groups[key]) groups[key] = { engagementId: f.engagementId, priority, findingIds: [] };
    groups[key].findingIds.push(f.findingId);
  }

  try {
    for (const group of Object.values(groups)) {
      const res = await fetch('api/review/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          findingIds: group.findingIds,
          engagementId: group.engagementId,
          approved,
          priority: approved ? group.priority : undefined,
          reviewedBy: 'admin',
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || 'Could not save one of the batches.');
        return;
      }
    }
    const submittedIds = new Set(selected.map(f => f.findingId));
    reviewQueueFindings = reviewQueueFindings.filter(f => !submittedIds.has(f.findingId));
    document.getElementById('reviewQueueSelectAll').checked = false;
    renderReviewQueue();
  } catch (err) {
    alert('Could not reach the server: ' + err.message);
  }
}

function approveSelectedReviewQueue() { submitReviewQueueBatch(true); }
function rejectSelectedReviewQueue() { submitReviewQueueBatch(false); }
</script>'''

html = html.replace(old_script_block, new_script_block)

with open(HTML_PATH, 'w') as f:
    f.write(html)
print(f"OK: {HTML_PATH} updated")
print()
print("Both files upgraded. Next: replace src/classification-store.js with the new version,")
print("then node --check admin/server.js, commit, push, and restart.")
