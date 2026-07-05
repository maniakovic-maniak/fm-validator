// Diagnoses invalid_client — checks credentials.json + token.json against
// Google's token endpoint directly and prints the exact rejection reason.
// Run:  node check-google.js
const fs = require('fs');

const c = JSON.parse(fs.readFileSync('credentials.json'));
const t = JSON.parse(fs.readFileSync('token.json'));
const cl = c.installed || c.web;

console.log('credentials.json type:', c.installed ? 'installed (Desktop app)' : c.web ? 'web' : 'UNKNOWN');
console.log('client_id:', cl.client_id);
console.log('secret starts:', cl.client_secret.slice(0, 10) + '...', '| length:', cl.client_secret.length);

// Common paste accidents — invisible characters
const s = cl.client_secret;
if (s !== s.trim()) console.log('⚠️  SECRET HAS LEADING/TRAILING WHITESPACE — this alone causes invalid_client');
if (/[\r\n\t]/.test(s)) console.log('⚠️  SECRET CONTAINS NEWLINE/TAB CHARACTERS');

console.log('token.json has refresh_token:', !!t.refresh_token);

fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: cl.client_id,
    client_secret: cl.client_secret.trim(),
    refresh_token: t.refresh_token,
    grant_type: 'refresh_token'
  })
})
  .then(r => r.json())
  .then(j => {
    if (j.access_token) {
      console.log('\n✅ Google accepted the credentials — token refresh works.');
      console.log('(If the pipeline still fails, the app may be reading a different credentials file — check GOOGLE_CREDENTIALS_PATH / auth.js)');
    } else {
      console.log('\n❌ Google rejected it:', JSON.stringify(j));
      if (j.error === 'invalid_client') {
        console.log('→ The client_id + client_secret pair is not recognised.');
        console.log('→ In console.cloud.google.com → "Clients" → your OAuth client:');
        console.log('   1. Does the client_id above match EXACTLY?');
        console.log('   2. Does a secret starting with the 10 chars above exist and show Enabled?');
      }
      if (j.error === 'invalid_grant') {
        console.log('→ Credentials are fine but the refresh token is dead — delete token.json and re-run auth.');
      }
    }
  });
