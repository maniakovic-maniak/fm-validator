// TEMPORARY — remove this entire block once real eWay integration is
// wired in below. Never the default: requires deliberately setting
// EWAY_EMULATION_MODE=true. Logged loudly at startup specifically so
// this is never silently active without someone noticing — an
// accidentally-left-on emulation flag that fakes successful payments
// is a genuine risk, not just a testing convenience.
const EMULATION_ENABLED = process.env.EWAY_EMULATION_MODE === 'true';
if (EMULATION_ENABLED) {
  console.warn('\n\u26a0\uFE0F\u26a0\uFE0F\u26a0\uFE0F  EWAY_EMULATION_MODE is ON — payments are being FAKED as successful, no real charge occurs. \u26a0\uFE0F\u26a0\uFE0F\u26a0\uFE0F');
  console.warn('   This must be OFF before this server ever handles a real customer. Unset EWAY_EMULATION_MODE to disable.\n');
}

/**
 * PLACEHOLDER — eWay's real API documentation has not been supplied yet
 * (confirmed explicitly in the implementation plan). This function is
 * structurally complete — correct inputs, correct outputs, correct
 * error shape — but does NOT make any real payment call. It must be
 * replaced with genuine eWay SDK/API integration before this endpoint
 * can process a real payment.
 *
 * Per the confirmed architecture decision: the payment UI is built
 * in-house, and raw card data is encrypted client-side before reaching
 * this backend at all — eWayEncryptedPayload here is expected to
 * already be whatever opaque, encrypted value eWay's own client-side
 * SDK produces, not raw card details. This function's job is only to
 * hand that opaque payload to eWay's real charge API and interpret
 * their real response — never to see or handle raw card data itself.
 *
 * @param {string} eWayEncryptedPayload - opaque payload from eWay's client SDK
 * @param {number} amountCents - the server-re-verified amount to charge
 * @returns {Promise<{success: boolean, transactionId?: string, declineReason?: string}>}
 */
async function chargeViaEway(eWayEncryptedPayload, amountCents) {
  if (EMULATION_ENABLED) {
    // Fake success, in the exact shape a real eWay response would take,
    // so everything downstream (order creation, both emails, the
    // success screen) runs through its genuine real code path — this
    // is specifically for testing that full cycle, not for skipping it.
    const fakeTransactionId = `EMULATED-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.warn(`   \u26a0\ufe0f  EMULATED payment (no real charge) — amount: ${(amountCents / 100).toFixed(2)}, fake transactionId: ${fakeTransactionId}`);
    return { success: true, transactionId: fakeTransactionId };
  }

  // TODO: replace this entire function body with a real call to eWay's
  // charge API once their integration docs arrive. The shape below
  // (success/transactionId on success, success/declineReason on
  // failure) is what the caller in server.js already expects — keep
  // that contract when wiring in the real implementation.
  throw new Error(
    'chargeViaEway() is a structural placeholder — eWay API integration docs have not been supplied yet. ' +
    'This must be replaced with a real eWay API call before /api/submit-order can process genuine payments.'
  );
}

module.exports = { chargeViaEway };
