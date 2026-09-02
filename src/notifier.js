const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// FIX: found via a real run — new Resend(process.env.RESEND_API_KEY) used
// to run unconditionally at module-load time (top-level code), so simply
// require()-ing this file crashed the entire process the instant
// RESEND_API_KEY wasn't set, before any actual validation work ran at
// all — notification is an ancillary feature that fires only after the
// real work is already done, and its absence should never be able to
// block the core pipeline. Constructed lazily instead, only when a
// notification is actually about to be sent.
let _resend = null;
function getResendClient() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

async function sendNotification(outcome) {
  // FIX: graceful skip instead of a crash when notifications aren't
  // configured — logs a clear, one-line reason rather than an
  // unhandled exception with a stack trace pointing into node_modules.
  if (!process.env.RESEND_API_KEY) {
    console.log('   (Skipping email notification — RESEND_API_KEY not set in .env. The report itself was still built and uploaded normally.)');
    return;
  }
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
    ? `<p style="color:#B45309"><strong>⚠️ ${needsAttention} item${needsAttention > 1 ? 's' : ''} flagged for your review — nothing in your file has been changed.</strong><br>Open the Processed Report tab in the file for exact cell locations and suggested actions.</p>`
    : `<p style="color:#27500A"><strong>✅ No issues were flagged. Your file has not been modified.</strong></p>`;

  let downloadUrl = webViewLink;
  const fileIdMatch = webViewLink && webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    downloadUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
  }

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px">
      <h2 style="color:#1A2B4A">Processed complete</h2>
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

  // FIX: found via investigating a report that email notifications had
  // stopped arriving despite the console always logging "Notification
  // sent" afterward. That log line only ever confirmed this call
  // didn't throw — it never confirmed Resend genuinely delivered the
  // email. Wrapped in a try/catch (there was none anywhere in this
  // chain before) so a real send failure is visible with Resend's
  // actual error detail, instead of either crashing the whole pipeline
  // (this call has no wrapper at its own call site either) or being
  // indistinguishable from genuine success. Also logs Resend's own
  // response id on success. Now sending from a verified custom domain
  // (plsfx.ai) — the earlier sandbox-sender delivery restriction
  // ('onboarding@resend.dev' could only reach the account's own
  // verified email) no longer applies.
  let sendResult;
  try {
    sendResult = await getResendClient().emails.send({
      from: 'PLSFX model review <no-reply@report.plsfx.ai>',
      to: process.env.NOTIFY_EMAIL,
      subject,
      html
    });
  } catch (e) {
    console.error(`   ⚠️  Email notification failed to send: ${e.message}`);
    console.error(`   ⚠️  (Notification failure does not affect the report itself — it was already built and uploaded. If this keeps happening, check: NOTIFY_EMAIL is set to a real address, and the plsfx.ai domain is still showing Verified in the Resend dashboard.)`);
    return;
  }

  if (sendResult && sendResult.error) {
    // The Resend SDK can also return an error object in the response
    // body rather than throwing — confirmed worth checking separately
    // from the try/catch above, since not every failure mode raises.
    console.error(`   ⚠️  Email notification was not accepted by Resend: ${JSON.stringify(sendResult.error)}`);
    return;
  }

  console.log(`Notification sent: ${subject}${sendResult && sendResult.data && sendResult.data.id ? ` (Resend id: ${sendResult.data.id})` : ''}`);
}

/**
 * Order confirmation email (template 1, drafted in the implementation
 * plan) — sent to the customer immediately after a successful order.
 * Reuses the exact same resilience pattern as sendNotification() above:
 * graceful skip if unconfigured, and checking both a thrown exception
 * and the response's own .error field, since Resend can fail either way.
 */
async function sendOrderConfirmation(order) {
  if (!process.env.RESEND_API_KEY) {
    console.log('   (Skipping order confirmation email — RESEND_API_KEY not set.)');
    return;
  }
  const { orderId, fullName, originalName, grandTotal } = order;
  const subject = `Your order ${escHtml(orderId)} has been received`;
  const totalDisplay = `AU$${grandTotal.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px">
      <p>Hi ${escHtml(fullName)},</p>
      <p>Thanks for submitting <strong>${escHtml(originalName)}</strong> for review. Your order ID is <strong>${escHtml(orderId)}</strong> — keep this for reference.</p>
      <p>Total charged: ${totalDisplay}</p>
      <p>Your model is now in our queue for review. We'll email you again as soon as your report is ready, along with the full breakdown of findings.</p>
      <p>If you have any questions in the meantime, just reply to this email.</p>
      <p>— The PlsFx Team</p>
    </div>
  `;

  let sendResult;
  try {
    sendResult = await getResendClient().emails.send({
      from: 'PLSFX model review <no-reply@report.plsfx.ai>',
      to: order.email,
      replyTo: 'maniakovic@gmail.com',
      subject,
      html
    });
  } catch (e) {
    console.error(`   ⚠️  Order confirmation email failed to send: ${e.message}`);
    return;
  }
  if (sendResult && sendResult.error) {
    console.error(`   ⚠️  Order confirmation email was not accepted by Resend: ${JSON.stringify(sendResult.error)}`);
    return;
  }
  console.log(`Order confirmation sent: ${subject}${sendResult && sendResult.data && sendResult.data.id ? ` (Resend id: ${sendResult.data.id})` : ''}`);
}

/**
 * Report-ready email (template 2, drafted in the implementation plan) —
 * sent manually from the admin dashboard once a run completes, with the
 * actual generated report attached. Reuses the same resilience pattern
 * as every other email function here.
 */
async function sendReportReadyEmail(order) {
  if (!process.env.RESEND_API_KEY) {
    console.log('   (Skipping report-ready email — RESEND_API_KEY not set.)');
    return { skipped: true };
  }
  if (!order.reportName) {
    console.error('   \u26a0\ufe0f  Cannot send report-ready email — order has no reportName.');
    return { error: 'No report available for this order yet.' };
  }
  const reportPath = path.join(__dirname, '..', 'processed', path.basename(order.reportName));
  if (!fs.existsSync(reportPath)) {
    console.error(`   \u26a0\ufe0f  Cannot send report-ready email — report file not found on disk: ${reportPath}`);
    return { error: 'Report file no longer exists on disk.' };
  }

  const { orderId, fullName, originalName } = order;
  const subject = `Your report for ${escHtml(originalName)} is ready`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px">
      <p>Hi ${escHtml(fullName)},</p>
      <p>Your review for <strong>${escHtml(originalName)}</strong> (order ${escHtml(orderId)}) is complete — the full report is attached.</p>
      <p>Inside you'll find a structured, 16-tab review — including an Issue Log, Validation Matrix, and Remediation plan — covering everything found during formula-level review.</p>
      <p>If you have any questions about a specific finding, just reply to this email.</p>
      <p>— The PlsFx Team</p>
    </div>
  `;

  let sendResult;
  try {
    sendResult = await getResendClient().emails.send({
      from: 'PLSFX model review <no-reply@report.plsfx.ai>',
      to: order.email,
      replyTo: 'maniakovic@gmail.com',
      subject,
      html,
      attachments: [{
        filename: path.basename(order.reportName),
        content: fs.readFileSync(reportPath),
      }],
    });
  } catch (e) {
    console.error(`   \u26a0\ufe0f  Report-ready email failed to send: ${e.message}`);
    return { error: e.message };
  }
  if (sendResult && sendResult.error) {
    console.error(`   \u26a0\ufe0f  Report-ready email was not accepted by Resend: ${JSON.stringify(sendResult.error)}`);
    return { error: JSON.stringify(sendResult.error) };
  }
  console.log(`Report-ready email sent: ${subject}${sendResult && sendResult.data && sendResult.data.id ? ` (Resend id: ${sendResult.data.id})` : ''}`);
  return { success: true };
}

/**
 * Admin new-order notification — same pattern as the existing new-run
 * notifications, sent to NOTIFY_EMAIL rather than the customer.
 */
async function sendAdminOrderNotification(order) {
  if (!process.env.RESEND_API_KEY) {
    console.log('   (Skipping admin order notification — RESEND_API_KEY not set.)');
    return;
  }
  const { orderId, fullName, company, originalName, grandTotal } = order;
  const subject = `New order: ${escHtml(orderId)} — ${escHtml(originalName)}`;
  const totalDisplay = `AU$${grandTotal.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px">
      <h2 style="color:#1A2B4A">New submission form order</h2>
      <p><strong>Order ID:</strong> ${escHtml(orderId)}</p>
      <p><strong>Customer:</strong> ${escHtml(fullName)} (${escHtml(company)})</p>
      <p><strong>File:</strong> ${escHtml(originalName)}</p>
      <p><strong>Total:</strong> ${totalDisplay}</p>
    </div>
  `;

  let sendResult;
  try {
    sendResult = await getResendClient().emails.send({
      from: 'PLSFX model review <no-reply@report.plsfx.ai>',
      to: process.env.NOTIFY_EMAIL,
      subject,
      html
    });
  } catch (e) {
    console.error(`   ⚠️  Admin order notification failed to send: ${e.message}`);
    return;
  }
  if (sendResult && sendResult.error) {
    console.error(`   ⚠️  Admin order notification was not accepted by Resend: ${JSON.stringify(sendResult.error)}`);
    return;
  }
  console.log(`Admin order notification sent: ${subject}${sendResult && sendResult.data && sendResult.data.id ? ` (Resend id: ${sendResult.data.id})` : ''}`);
}

/**
 * Demo request email — sends the sample report (a swappable, fixed-path
 * file, not tied to any real customer order) to whoever requested a demo
 * via the website's "Request a Demo" form.
 */
async function sendDemoRequestEmail(demoRequest) {
  if (!process.env.RESEND_API_KEY) {
    console.log('   (Skipping demo request email — RESEND_API_KEY not set.)');
    return { skipped: true };
  }
  // Fixed path, deliberately - swap this one file for the real sample
  // report once it's ready, no code change needed.
  const samplePath = path.join(__dirname, '..', 'assets', 'demo-report.xlsx');
  if (!fs.existsSync(samplePath)) {
    console.error(`   \u26a0\ufe0f  Cannot send demo request email — sample report not found: ${samplePath}`);
    return { error: 'Sample report file not found on disk.' };
  }

  const { name, email } = demoRequest;
  const subject = `Your PlsFx sample model review`;
  // Placeholder copy for now - refine once the real demo flow is confirmed.
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px">
      <p>Hi ${escHtml(name)},</p>
      <p>Thanks for your interest in PlsFx. Attached is a sample model review report, showing the kind of structured, formula-level review our pipeline produces.</p>
      <p>Inside you'll find a real example of the report structure — including an Issue Log, Validation Matrix, and Remediation plan.</p>
      <p>If you'd like to talk through how this could work for your own models, just reply to this email.</p>
      <p>— The PlsFx Team</p>
    </div>
  `;

  let sendResult;
  try {
    sendResult = await getResendClient().emails.send({
      from: 'PLSFX model review <no-reply@report.plsfx.ai>',
      to: email,
      replyTo: 'maniakovic@gmail.com',
      subject,
      html,
      attachments: [{
        filename: 'PlsFx-sample-report.xlsx',
        content: fs.readFileSync(samplePath),
      }],
    });
  } catch (e) {
    console.error(`   \u26a0\ufe0f  Demo request email failed to send: ${e.message}`);
    return { error: e.message };
  }
  if (sendResult && sendResult.error) {
    console.error(`   \u26a0\ufe0f  Demo request email was not accepted by Resend: ${JSON.stringify(sendResult.error)}`);
    return { error: JSON.stringify(sendResult.error) };
  }
  console.log(`Demo request email sent to ${email}${sendResult && sendResult.data && sendResult.data.id ? ` (Resend id: ${sendResult.data.id})` : ''}`);
  return { success: true };
}

module.exports = { sendNotification, sendOrderConfirmation, sendReportReadyEmail, sendAdminOrderNotification, sendDemoRequestEmail };
