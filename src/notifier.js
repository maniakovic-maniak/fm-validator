const { Resend } = require('resend');

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// dotenv is loaded once by the entry point (server.js / index.js)
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendNotification(outcome) {
  const {
    originalName,
    outputName,
    webViewLink,
    totalIssues,
    needsAttention
  } = outcome;

  const isClean = needsAttention === 0;

  const subject = isClean
    ? `✅ Validated — no issues: ${escHtml(originalName)}`
    : `⚠️  Validated — ${needsAttention} item${needsAttention > 1 ? 's' : ''} need attention: ${escHtml(originalName)}`;

  // Wording matters here: this product never modifies the client's file —
  // it only flags, attributes root causes, and proposes actions. Earlier
  // copy said "auto-fixed", left over from a pre-v4 architecture that was
  // deliberately abandoned. Client-facing text claiming automatic fixes
  // that never actually happen is a real accuracy problem, not just stale
  // wording — fixed to describe what the product actually does.
  const attentionBlock = needsAttention > 0
    ? `<p style="color:#B45309"><strong>⚠️ ${needsAttention} item${needsAttention > 1 ? 's' : ''} flagged for your review — nothing in your file has been changed.</strong><br>Open the Validation Report tab in the file for exact cell locations and suggested actions.</p>`
    : `<p style="color:#27500A"><strong>✅ No issues were flagged. Your file has not been modified.</strong></p>`;

  let downloadUrl = webViewLink;
  const fileIdMatch = webViewLink && webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    downloadUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px">
      <h2 style="color:#1A2B4A">Validation complete</h2>
      <p><strong>File:</strong> ${escHtml(originalName)}</p>
      <p><strong>Output:</strong> ${escHtml(outputName)}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
      <p><strong>Total issues found:</strong> ${totalIssues}</p>
      <p><strong>Needs attention:</strong> ${needsAttention}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
      ${attentionBlock}
      <a href="${downloadUrl}" style="display:inline-block;margin-top:16px;background:#1A2B4A;color:white;padding:10px 20px;border-radius:6px;text-decoration:none">Download Validated File</a>
    </div>
  `;

  await resend.emails.send({
    from: 'FM Validator <onboarding@resend.dev>',
    to: process.env.NOTIFY_EMAIL,
    subject,
    html
  });

  console.log(`Notification sent: ${subject}`);
}

module.exports = { sendNotification };
