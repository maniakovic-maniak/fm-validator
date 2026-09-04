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
    ? `<p style="color:#F5A623"><strong>⚠️ ${needsAttention} item${needsAttention > 1 ? 's' : ''} flagged for your review — nothing in your file has been changed.</strong><br>Open the Processed Report tab in the file for exact cell locations and suggested actions.</p>`
    : `<p style="color:#5DCAA5"><strong>✅ No issues were flagged. Your file has not been modified.</strong></p>`;

  let downloadUrl = webViewLink;
  const fileIdMatch = webViewLink && webViewLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileIdMatch) {
    downloadUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
  }

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="dark only">
<meta name="supported-color-schemes" content="dark only">
<title>Processed complete</title>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<style>table {border-collapse: collapse;}</style>
<![endif]-->
<style>
  body, table, td { margin: 0; padding: 0; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  table { border-collapse: collapse !important; }
  body { height: 100% !important; width: 100% !important; }

  .body-bg { background-color: #05070d; }
  .card-bg { background-color: #0d1018; }
  .text-primary { color: #eef1f8; }
  .text-secondary { color: #a9b1c4; }
  .text-muted { color: #7d8598; }
  .border-hair { border-color: rgba(233,237,245,0.14); }
  .footer-bg { background-color: #0a0c12; }
  .accent { color: #5DCAA5; }

  @media screen and (max-width: 600px) {
    .email-container { width: 100% !important; }
    .fluid-padding { padding-left: 24px !important; padding-right: 24px !important; }
  }
</style>
</head>
<body class="body-bg" style="margin:0; padding:0; background-color:#05070d; font-family: Arial, Helvetica, sans-serif;">

<center class="body-bg" style="width:100%; background-color:#05070d;">
  <!--[if mso]>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center">
  <tr><td>
  <![endif]-->

  <table role="presentation" class="email-container" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px; margin:0 auto;">

    <tr>
      <td class="fluid-padding" style="padding:36px 32px 24px 32px; text-align:left;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background-color:#3d8b85; padding:8px 12px; font-family: Georgia, 'Times New Roman', serif; font-style:italic; font-size:16px; color:#ffffff;">fx</td>
            <td style="background-color:#16171A; padding:8px 16px; font-family: Arial, Helvetica, sans-serif; font-weight:bold; font-size:16px; color:#ffffff; letter-spacing:0.5px;">PlsFx</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td class="fluid-padding" style="padding:0 32px 32px 32px;">
        <table role="presentation" class="card-bg" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0d1018; border-radius:12px;">
          <tr>
            <td class="fluid-padding" style="padding:36px 40px 40px 40px;">
              <p class="accent" style="margin:0 0 18px 0; font-family: 'Courier New', Courier, monospace; font-size:12px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#5DCAA5;">PROCESSED COMPLETE</p>
              <p class="text-secondary" style="margin:0 0 8px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;"><strong class="text-primary" style="color:#eef1f8;">File:</strong> ${escHtml(originalName)}</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;"><strong class="text-primary" style="color:#eef1f8;">Output:</strong> ${escHtml(outputName)}</p>
              <hr class="border-hair" style="border:none;border-top:1px solid rgba(233,237,245,0.14);margin:18px 0">
              <p class="text-secondary" style="margin:0 0 8px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;"><strong class="text-primary" style="color:#eef1f8;">Total issues found:</strong> ${totalIssues}</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;"><strong class="text-primary" style="color:#eef1f8;">Needs attention:</strong> ${needsAttention}</p>
              <hr class="border-hair" style="border:none;border-top:1px solid rgba(233,237,245,0.14);margin:18px 0">
              <div style="font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6;">${attentionBlock}</div>
              <a href="${downloadUrl}" style="display:inline-block;margin-top:20px;background-color:#5DCAA5;color:#05070d;padding:12px 24px;border-radius:6px;text-decoration:none;font-family: Arial, Helvetica, sans-serif;font-weight:bold;font-size:14px;">Download Processed File</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td class="footer-bg fluid-padding" style="background-color:#0a0c12; padding:24px 32px;">
        <p class="text-muted" style="margin:0; font-family: 'Courier New', Courier, monospace; font-size:11px; line-height:1.6; color:#7d8598;">&copy; Copyright 2026 BIRDHOUSE TRADING PTY LTD. - All Rights Reserved / ABN: 61692125616</p>
      </td>
    </tr>

  </table>

  <!--[if mso]>
  </td></tr>
  </table>
  <![endif]-->
</center>

</body>
</html>
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
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="dark only">
<meta name="supported-color-schemes" content="dark only">
<title>Order confirmed</title>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<style>table {border-collapse: collapse;}</style>
<![endif]-->
<style>
  body, table, td { margin: 0; padding: 0; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  table { border-collapse: collapse !important; }
  body { height: 100% !important; width: 100% !important; }

  .body-bg { background-color: #05070d; }
  .card-bg { background-color: #0d1018; }
  .text-primary { color: #eef1f8; }
  .text-secondary { color: #a9b1c4; }
  .text-muted { color: #7d8598; }
  .border-hair { border-color: rgba(233,237,245,0.14); }
  .footer-bg { background-color: #0a0c12; }
  .accent { color: #5DCAA5; }

  @media screen and (max-width: 600px) {
    .email-container { width: 100% !important; }
    .fluid-padding { padding-left: 24px !important; padding-right: 24px !important; }
  }
</style>
</head>
<body class="body-bg" style="margin:0; padding:0; background-color:#05070d; font-family: Arial, Helvetica, sans-serif;">

<center class="body-bg" style="width:100%; background-color:#05070d;">
  <!--[if mso]>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center">
  <tr><td>
  <![endif]-->

  <table role="presentation" class="email-container" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px; margin:0 auto;">

    <tr>
      <td class="fluid-padding" style="padding:36px 32px 24px 32px; text-align:left;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background-color:#3d8b85; padding:8px 12px; font-family: Georgia, 'Times New Roman', serif; font-style:italic; font-size:16px; color:#ffffff;">fx</td>
            <td style="background-color:#16171A; padding:8px 16px; font-family: Arial, Helvetica, sans-serif; font-weight:bold; font-size:16px; color:#ffffff; letter-spacing:0.5px;">PlsFx</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td class="fluid-padding" style="padding:0 32px 32px 32px;">
        <table role="presentation" class="card-bg" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0d1018; border-radius:12px;">
          <tr>
            <td class="fluid-padding" style="padding:36px 40px 40px 40px;">
              <p class="accent" style="margin:0 0 18px 0; font-family: 'Courier New', Courier, monospace; font-size:12px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#5DCAA5;">ORDER CONFIRMED</p>
              <p class="text-primary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:16px; line-height:1.6; color:#eef1f8;">Hi ${escHtml(fullName)},</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">Thanks for submitting <strong>${escHtml(originalName)}</strong> for review. Your order ID is <strong>${escHtml(orderId)}</strong> - keep this for reference.</p>
              <p class="text-primary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#eef1f8;">Total charged: ${totalDisplay}</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">Your model is now in our queue for review. We'll email you again as soon as your report is ready, along with the full breakdown of findings.</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">If you have any questions in the meantime, just reply to this email.</p>

              <p class="text-secondary" style="margin:28px 0 0 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">- The PlsFx team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td class="footer-bg fluid-padding" style="background-color:#0a0c12; padding:24px 32px;">
        <p class="text-muted" style="margin:0; font-family: 'Courier New', Courier, monospace; font-size:11px; line-height:1.6; color:#7d8598;">&copy; Copyright 2026 BIRDHOUSE TRADING PTY LTD. - All Rights Reserved / ABN: 61692125616</p>
      </td>
    </tr>

  </table>

  <!--[if mso]>
  </td></tr>
  </table>
  <![endif]-->
</center>

</body>
</html>
  `;

  let sendResult;
  try {
    sendResult = await getResendClient().emails.send({
      from: 'PLSFX model review <no-reply@report.plsfx.ai>',
      to: order.email,
      replyTo: 'mikhail@plsfx.ai',
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
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="dark only">
<meta name="supported-color-schemes" content="dark only">
<title>Your report is ready</title>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<style>table {border-collapse: collapse;}</style>
<![endif]-->
<style>
  body, table, td { margin: 0; padding: 0; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  table { border-collapse: collapse !important; }
  body { height: 100% !important; width: 100% !important; }

  .body-bg { background-color: #05070d; }
  .card-bg { background-color: #0d1018; }
  .text-primary { color: #eef1f8; }
  .text-secondary { color: #a9b1c4; }
  .text-muted { color: #7d8598; }
  .border-hair { border-color: rgba(233,237,245,0.14); }
  .footer-bg { background-color: #0a0c12; }
  .accent { color: #5DCAA5; }

  @media screen and (max-width: 600px) {
    .email-container { width: 100% !important; }
    .fluid-padding { padding-left: 24px !important; padding-right: 24px !important; }
  }
</style>
</head>
<body class="body-bg" style="margin:0; padding:0; background-color:#05070d; font-family: Arial, Helvetica, sans-serif;">

<center class="body-bg" style="width:100%; background-color:#05070d;">
  <!--[if mso]>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center">
  <tr><td>
  <![endif]-->

  <table role="presentation" class="email-container" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px; margin:0 auto;">

    <tr>
      <td class="fluid-padding" style="padding:36px 32px 24px 32px; text-align:left;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background-color:#3d8b85; padding:8px 12px; font-family: Georgia, 'Times New Roman', serif; font-style:italic; font-size:16px; color:#ffffff;">fx</td>
            <td style="background-color:#16171A; padding:8px 16px; font-family: Arial, Helvetica, sans-serif; font-weight:bold; font-size:16px; color:#ffffff; letter-spacing:0.5px;">PlsFx</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td class="fluid-padding" style="padding:0 32px 32px 32px;">
        <table role="presentation" class="card-bg" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0d1018; border-radius:12px;">
          <tr>
            <td class="fluid-padding" style="padding:36px 40px 40px 40px;">
              <p class="accent" style="margin:0 0 18px 0; font-family: 'Courier New', Courier, monospace; font-size:12px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#5DCAA5;">REPORT READY</p>
              <p class="text-primary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:16px; line-height:1.6; color:#eef1f8;">Hi ${escHtml(fullName)},</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">Your review for <strong>${escHtml(originalName)}</strong> (order ${escHtml(orderId)}) is complete - the full report is attached.</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">Inside you'll find a structured, 16-tab review - including an Issue Log, Validation Matrix, and Remediation plan - covering everything found during formula-level review.</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">If you have any questions about a specific finding, just reply to this email.</p>

              <p class="text-secondary" style="margin:28px 0 0 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">- The PlsFx team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td class="footer-bg fluid-padding" style="background-color:#0a0c12; padding:24px 32px;">
        <p class="text-muted" style="margin:0; font-family: 'Courier New', Courier, monospace; font-size:11px; line-height:1.6; color:#7d8598;">&copy; Copyright 2026 BIRDHOUSE TRADING PTY LTD. - All Rights Reserved / ABN: 61692125616</p>
      </td>
    </tr>

  </table>

  <!--[if mso]>
  </td></tr>
  </table>
  <![endif]-->
</center>

</body>
</html>
  `;

  let sendResult;
  try {
    sendResult = await getResendClient().emails.send({
      from: 'PLSFX model review <no-reply@report.plsfx.ai>',
      to: order.email,
      replyTo: 'mikhail@plsfx.ai',
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
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="dark only">
<meta name="supported-color-schemes" content="dark only">
<title>Your sample report</title>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<style>table {border-collapse: collapse;}</style>
<![endif]-->
<style>
  body, table, td { margin: 0; padding: 0; }
  img { border: 0; line-height: 100%; outline: none; text-decoration: none; }
  table { border-collapse: collapse !important; }
  body { height: 100% !important; width: 100% !important; }

  .body-bg { background-color: #05070d; }
  .card-bg { background-color: #0d1018; }
  .text-primary { color: #eef1f8; }
  .text-secondary { color: #a9b1c4; }
  .text-muted { color: #7d8598; }
  .border-hair { border-color: rgba(233,237,245,0.14); }
  .footer-bg { background-color: #0a0c12; }
  .accent { color: #5DCAA5; }

  @media screen and (max-width: 600px) {
    .email-container { width: 100% !important; }
    .fluid-padding { padding-left: 24px !important; padding-right: 24px !important; }
  }
</style>
</head>
<body class="body-bg" style="margin:0; padding:0; background-color:#05070d; font-family: Arial, Helvetica, sans-serif;">

<center class="body-bg" style="width:100%; background-color:#05070d;">
  <!--[if mso]>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center">
  <tr><td>
  <![endif]-->

  <table role="presentation" class="email-container" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px; margin:0 auto;">

    <tr>
      <td class="fluid-padding" style="padding:36px 32px 24px 32px; text-align:left;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="background-color:#3d8b85; padding:8px 12px; font-family: Georgia, 'Times New Roman', serif; font-style:italic; font-size:16px; color:#ffffff;">fx</td>
            <td style="background-color:#16171A; padding:8px 16px; font-family: Arial, Helvetica, sans-serif; font-weight:bold; font-size:16px; color:#ffffff; letter-spacing:0.5px;">PlsFx</td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td class="fluid-padding" style="padding:0 32px 32px 32px;">
        <table role="presentation" class="card-bg" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0d1018; border-radius:12px;">
          <tr>
            <td class="fluid-padding" style="padding:36px 40px 40px 40px;">
              <p class="accent" style="margin:0 0 18px 0; font-family: 'Courier New', Courier, monospace; font-size:12px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#5DCAA5;">SAMPLE REPORT</p>
              <p class="text-primary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:16px; line-height:1.6; color:#eef1f8;">Hi ${escHtml(name)},</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">Thanks for your interest in PlsFx. Attached is a sample model review report, showing the kind of structured, formula-level review our pipeline produces.</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">Inside you'll find a real example of the report structure - including an Issue Log, Validation Matrix, and Remediation plan.</p>
              <p class="text-secondary" style="margin:0 0 18px 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">If you'd like to talk through how this could work for your own models, just reply to this email.</p>

              <p class="text-secondary" style="margin:28px 0 0 0; font-family: Arial, Helvetica, sans-serif; font-size:15px; line-height:1.6; color:#a9b1c4;">- The PlsFx team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td class="footer-bg fluid-padding" style="background-color:#0a0c12; padding:24px 32px;">
        <p class="text-muted" style="margin:0; font-family: 'Courier New', Courier, monospace; font-size:11px; line-height:1.6; color:#7d8598;">&copy; Copyright 2026 BIRDHOUSE TRADING PTY LTD. - All Rights Reserved / ABN: 61692125616</p>
      </td>
    </tr>

  </table>

  <!--[if mso]>
  </td></tr>
  </table>
  <![endif]-->
</center>

</body>
</html>
  `;

  let sendResult;
  try {
    sendResult = await getResendClient().emails.send({
      from: 'PLSFX model review <no-reply@report.plsfx.ai>',
      to: email,
      replyTo: 'mikhail@plsfx.ai',
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
