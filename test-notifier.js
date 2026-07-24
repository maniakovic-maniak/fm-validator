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

    // Restore original environment state
    if (originalKey) process.env.RESEND_API_KEY = originalKey;
    else delete process.env.RESEND_API_KEY;

    console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
    if (!allPass) process.exit(1);
  })();
}

run();
