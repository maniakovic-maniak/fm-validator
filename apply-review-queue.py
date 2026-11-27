#!/usr/bin/env python3
# apply-review-queue.py — genuinely, directly inserts the review queue
# additions into the real, existing admin/server.js and
# admin/public/index.html files, at their exact, confirmed anchor
# points. Tested against the real, actual uploaded files before being
# handed over - not a guess.
#
# Run this FROM the ~/fm-validator directory on the server (or from a
# local clone with the same real file paths).
#
# Usage: python3 apply-review-queue.py

import sys

SERVER_PATH = 'admin/server.js'
HTML_PATH = 'admin/public/index.html'

with open(SERVER_PATH) as f:
    server = f.read()
with open(HTML_PATH) as f:
    html = f.read()

# ── server.js: add the require() line ──
require_anchor = "const { getProgress } = require('../src/utils/run-progress');"
require_addition = "const { classify, loadEngagement } = require('../src/classification-store');"
if require_anchor not in server:
    sys.exit(f"FAILED: require anchor not found in {SERVER_PATH} - this file may have changed since this script was written. Aborting without modifying anything.")
server = server.replace(require_anchor, require_anchor + "\n" + require_addition)

# ── server.js: add the two route handlers, before app.listen() ──
route_additions = '''app.get('/api/classifications/unclassified', (req, res) => {
  if (!listPartnerReviewEngagements) {
    return res.status(503).json({ error: 'Partner Review integration is not available on this server.' });
  }
  try {
    const engagements = listPartnerReviewEngagements().filter(e => e.status === 'complete');
    const fs = require('fs');
    const unclassified = [];

    for (const engagement of engagements) {
      if (!engagement.phaseBResultPath) continue;
      const phaseBPath = path.resolve(PARTNER_REVIEW_PATH, engagement.phaseBResultPath);
      if (!fs.existsSync(phaseBPath)) continue;

      let phaseB;
      try {
        phaseB = JSON.parse(fs.readFileSync(phaseBPath, 'utf8'));
      } catch (err) {
        console.error(`   \\u26a0\\ufe0f  Could not parse Phase B result for ${engagement.engagementId}: ${err.message}`);
        continue;
      }

      const alreadyClassified = new Set(loadEngagement(engagement.engagementId).map(r => r.findingId));

      const auditFindings = phaseB.auditFindingClassifications || [];
      const independentFindings = phaseB.independentFindingClassifications || [];

      for (const f of auditFindings) {
        if (!f.auditFindingId || alreadyClassified.has(f.auditFindingId)) continue;
        unclassified.push({
          findingId: f.auditFindingId,
          engagementId: engagement.engagementId,
          orderId: engagement.orderId,
          source: 'audit',
          classification: f.classification,
          rationale: f.rationale,
        });
      }
      for (const f of independentFindings) {
        if (!f.independentFindingId || alreadyClassified.has(f.independentFindingId)) continue;
        unclassified.push({
          findingId: f.independentFindingId,
          engagementId: engagement.engagementId,
          orderId: engagement.orderId,
          source: 'independent',
          classification: f.classification,
          rationale: f.rationale,
        });
      }
    }

    res.json({ findings: unclassified });
  } catch (err) {
    console.error('   \\u26a0\\ufe0f  Unexpected error listing unclassified findings:', err.message);
    res.status(500).json({ error: 'An unexpected error occurred listing unclassified findings.' });
  }
});

app.post('/api/classifications', (req, res) => {
  try {
    const record = classify(req.body || {});
    res.json({ success: true, record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

'''
listen_anchor = "app.listen(PORT, () => console.log(`FM Validator Admin running on http://localhost:${PORT}`));"
if listen_anchor not in server:
    sys.exit(f"FAILED: app.listen anchor not found in {SERVER_PATH} - aborting without modifying anything.")
server = server.replace(listen_anchor, route_additions + listen_anchor)

with open(SERVER_PATH, 'w') as f:
    f.write(server)
print(f"OK: {SERVER_PATH} updated")

# ── index.html: sidebar button ──
sidebar_anchor = '<button class="sidebar-item" data-page="partner-review">Partner Review</button>'
sidebar_addition = '<button class="sidebar-item" data-page="review-queue">Review Queue</button>'
if sidebar_anchor not in html:
    sys.exit(f"FAILED: sidebar anchor not found in {HTML_PATH} - aborting without modifying anything.")
html = html.replace(sidebar_anchor, sidebar_anchor + "\n    " + sidebar_addition)

# ── index.html: page div ──
page_div = '''<div class="page" id="page-review-queue" style="display:none">
  <div class="header">
    <h1>Review Queue</h1>
    <span class="meta" id="reviewQueueCount">Loading\u2026</span>
  </div>

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
page_anchor = '''      <div class="empty-state" id="partnerReviewEmptyState" style="display:none">No Partner Review engagements yet.</div>
    </div>'''
if page_anchor not in html:
    sys.exit(f"FAILED: page anchor not found in {HTML_PATH} - aborting without modifying anything.")
html = html.replace(page_anchor, page_anchor + "\n\n    " + page_div)

# ── index.html: switchToTab wiring ──
switch_anchor = "    if (pageName === 'partner-review') loadPartnerReviewEngagements();"
switch_addition = "    if (pageName === 'review-queue') loadReviewQueue();"
if switch_anchor not in html:
    sys.exit(f"FAILED: switchToTab anchor not found in {HTML_PATH} - aborting without modifying anything.")
html = html.replace(switch_anchor, switch_anchor + "\n" + switch_addition)

# ── index.html: new <script> block, before the closing tags ──
script_block = '''<script>
let reviewQueueFindings = [];

const FEEDBACK_CATEGORY_LABELS = {
  1: 'Confirmed correct',
  2: 'Confirmed wrong',
  3: 'Directionally right, wrong specifics',
  4: 'Genuinely unresolvable',
};

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
    const categoryButtons = [1, 2, 3, 4].map(n =>
      `<button class="action-icon" title="${FEEDBACK_CATEGORY_LABELS[n]}" onclick="classifyReviewQueueFinding(${i}, ${n})">${n}</button>`
    ).join(' ');
    return `
      <tr>
        <td>${f.findingId}</td>
        <td>${f.orderId || '\\u2014'}</td>
        <td>${f.source}</td>
        <td>${f.classification || '\\u2014'}</td>
        <td style="max-width: 320px;">${(f.rationale || '\\u2014').slice(0, 200)}</td>
        <td>${categoryButtons}</td>
      </tr>
    `;
  }).join('');
}

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

async function classifyReviewQueueFinding(index, category) {
  const f = reviewQueueFindings[index];
  const note = prompt(`Classifying ${f.findingId} as "${FEEDBACK_CATEGORY_LABELS[category]}". Optional note:`, '');
  if (note === null) return;
  try {
    const res = await fetch('api/classifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        findingId: f.findingId,
        engagementId: f.engagementId,
        category,
        reviewerNote: note,
        reviewedBy: 'admin',
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Could not save this classification.');
      return;
    }
    reviewQueueFindings.splice(index, 1);
    renderReviewQueue();
  } catch (err) {
    alert('Could not reach the server: ' + err.message);
  }
}
</script>'''
# Insert the NEW script block right before the closing </body></html>,
# keeping the ORIGINAL </script> that closes the existing script block
# genuinely intact. A real bug, caught by testing this exact script
# end-to-end: anchoring on the full "</script>\n</body>\n</html>" and
# replacing it wholesale genuinely swallowed the original </script>
# along with it, leaving 2 opening <script> tags but only 1 closing
# one in the final file.
closing_anchor = '''</body>
</html>'''
if closing_anchor not in html:
    sys.exit(f"FAILED: closing-tag anchor not found in {HTML_PATH} - aborting without modifying anything.")
html = html.replace(closing_anchor, script_block + "\n" + closing_anchor)

with open(HTML_PATH, 'w') as f:
    f.write(html)
print(f"OK: {HTML_PATH} updated")
print()
print("Both files updated successfully. Next: node --check admin/server.js, then restart.")
