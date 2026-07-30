// Tests notifier.js's real, reported crash: require()-ing this module
// used to construct the Resend client at module-load time
// unconditionally, so simply importing it (which index.js/server.js do
// at the top of the file, before any pipeline logic runs) crashed the
// entire process with "Missing API key" whenever RESEND_API_KEY wasn't
// set in .env — even for someone who never intends to use email
// notifications at all.

function run() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ── The real bug: requiring the module with no key set must not throw ──
  const originalKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  delete require.cache[require.resolve('./src/notifier.js')];

  let sendNotification;
  try {
    ({ sendNotification } = require('./src/notifier.js'));
    check('requiring notifier.js with RESEND_API_KEY unset no longer crashes the process', true);
  } catch (e) {
    check('requiring notifier.js with RESEND_API_KEY unset no longer crashes the process', false);
    console.log('  threw:', e.message);
  }

  return (async () => {
    // ── Calling sendNotification with no key must gracefully skip ────────
    if (sendNotification) {
      try {
        await sendNotification({
          originalName: 'test.xlsx', outputName: 'test_VALIDATED.xlsx',
          webViewLink: 'https://drive.google.com/x', totalIssues: 5, needsAttention: 3,
        });
        check('sendNotification() with no key configured gracefully skips instead of throwing', true);
      } catch (e) {
        check('sendNotification() with no key configured gracefully skips instead of throwing', false);
        console.log('  threw:', e.message);
      }
    }

    // ── Regression: with a key present, the client still constructs fine ──
    process.env.RESEND_API_KEY = 're_fake_test_key_for_construction_check';
    delete require.cache[require.resolve('./src/notifier.js')];
    delete require.cache[require.resolve('resend')];
    try {
      const { Resend } = require('resend');
      const client = new Resend(process.env.RESEND_API_KEY);
      check('with a key present, the underlying Resend client still constructs successfully (no regression)',
        typeof client.emails.send === 'function');
    } catch (e) {
      check('with a key present, the underlying Resend client still constructs successfully (no regression)', false);
      console.log('  threw:', e.message);
    }

    // ══════════════════════════════════════════════════════════════
    // The real gap this fixes: found via investigating a report that
    // email notifications had stopped arriving despite the console
    // always logging "Notification sent" afterward — that log line
    // only ever confirmed the call didn't throw, never that Resend
    // genuinely delivered the email. There was no try/catch anywhere
    // in this chain before, and no check of Resend's own error-object
    // response shape (a request Resend accepts but doesn't deliver —
    // very plausible with the sandbox sender address — returns
    // {error, data: null} rather than throwing).
    // ══════════════════════════════════════════════════════════════

    function mockResendModule(sendImpl) {
      delete require.cache[require.resolve('resend')];
      const resendPath = require.resolve('resend');
      require.cache[resendPath] = {
        id: resendPath, filename: resendPath, loaded: true,
        exports: { Resend: class { constructor() { this.emails = { send: sendImpl }; } } },
      };
    }

    process.env.RESEND_API_KEY = 're_fake_test_key';
    const baseArgs = {
      originalName: 'test.xlsx', outputName: 'test_VALIDATED.xlsx',
      webViewLink: 'https://drive.google.com/x', totalIssues: 5, needsAttention: 3,
    };

    // Case A: Resend throws (a genuine network/API-level failure) —
    // must be caught, logged, and NOT propagate to crash the pipeline.
    {
      mockResendModule(async () => { throw new Error('simulated network failure'); });
      delete require.cache[require.resolve('./src/notifier.js')];
      const { sendNotification: sendA } = require('./src/notifier.js');
      let threw = false;
      try { await sendA(baseArgs); } catch (e) { threw = true; }
      check('a thrown exception from Resend is caught and does not propagate to crash the pipeline', !threw);
    }

    // Case B: Resend returns an error OBJECT rather than throwing (the
    // "accepted but not delivered" case — e.g. invalid_from_address
    // from the sandbox sender restriction) — must be detected and
    // logged, not silently treated as success.
    {
      let detectedError = null;
      const origError = console.error;
      console.error = (...args) => { detectedError = args.join(' '); };
      mockResendModule(async () => ({ data: null, error: { message: 'invalid_from_address', name: 'invalid_from_address' } }));
      delete require.cache[require.resolve('./src/notifier.js')];
      const { sendNotification: sendB } = require('./src/notifier.js');
      await sendB(baseArgs);
      console.error = origError;
      check('an error-object response (accepted but not delivered) is detected and logged, not silently treated as success',
        detectedError && detectedError.includes('invalid_from_address'));
    }

    // Case C: genuine success — confirms the Resend message id is
    // captured and logged for a real, verifiable delivery confirmation.
    {
      let loggedLine = null;
      const origLog = console.log;
      console.log = (...args) => { loggedLine = args.join(' '); origLog(...args); };
      mockResendModule(async () => ({ data: { id: 're_test_message_id_123' }, error: null }));
      delete require.cache[require.resolve('./src/notifier.js')];
      const { sendNotification: sendC } = require('./src/notifier.js');
      await sendC(baseArgs);
      console.log = origLog;
      check('genuine success logs Resend\'s own message id for a real, verifiable delivery confirmation',
        loggedLine && loggedLine.includes('re_test_message_id_123'));
    }

    // Restore the real resend module for any subsequent test files in
    // the same process.
    delete require.cache[require.resolve('resend')];
    delete require.cache[require.resolve('./src/notifier.js')];

    // Restore original environment state
    if (originalKey) process.env.RESEND_API_KEY = originalKey;
    else delete process.env.RESEND_API_KEY;

    console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
    if (!allPass) process.exit(1);
  })();
}

run();
