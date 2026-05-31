const { Resend } = require('resend');
require('dotenv').config();
const resend = new Resend(process.env.RESEND_API_KEY);

async function sendNotification(outcome) {
  const {
    originalName,
    outputName,
    webViewLink,
    totalIssues,
    autoFixed,
    needsAttention
  } = outcome;

  const isClean = needsAttention === 0;

  const subject = isClean
    ? `✅ Validated — no issues: ${originalName}`
    : `⚠️  Validated — ${needsAttention} item${needsAttention > 1 ? 's' : ''} need attention: ${originalName}`;

  const attentionBlock = needsAttention > 0
    ? `<p style="color:#B45309"><strong>⚠️ ${needsAttention} item${needsAttention > 1 ? 's' : ''} could not be auto-fixed and need your review.</strong><br>Open the Validation Report tab in the file for exact cell locations.</p>`
    : `<p style="color:#27500A"><strong>✅ All issues were auto-fixed. No action required.</strong></p>`;

  let downloadUrl = webViewLink;
  const fileIdMatch = webViewLink && webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    downloadUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px">
      <h2 style="color:#1A2B4A">Validation complete</h2>
      <p><strong>File:</strong> ${originalName}</p>
      <p><strong>Output:</strong> ${outputName}</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
      <p><strong>Total issues found:</strong> ${totalIssues}</p>
      <p><strong>Auto-fixed:</strong> ${autoFixed}</p>
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
