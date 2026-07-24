const { authenticate } = require('@google-cloud/local-auth');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];

async function getAuth() {
  // FIX (found via a real bug-scan run, two related issues in the same
  // function): CREDENTIALS_PATH was read unconditionally as soon as
  // TOKEN_PATH was found to exist, with no existence check of its own —
  // if token.json exists but credentials.json was moved or deleted,
  // this threw an unhandled ENOENT instead of falling back to the
  // authenticate() flow the way a missing token.json already does.
  // Separately, credentials.installed was hardcoded, assuming a
  // Desktop-app-type OAuth client specifically — a Web-application-type
  // client's downloaded JSON uses a 'web' key instead, which would
  // throw when destructuring an undefined installed key. Both fixed
  // together: an explicit existence check with a fallback to
  // authenticate(), and accepting either credential shape.
  if (fs.existsSync(TOKEN_PATH) && fs.existsSync(CREDENTIALS_PATH)) {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH));
    const credentialConfig = credentials.installed || credentials.web;
    const { client_secret, client_id, redirect_uris } = credentialConfig;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
    oAuth2Client.setCredentials(tokenData);
    return oAuth2Client;
  }
  const client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(client.credentials));
  return client;
}

module.exports = { getAuth };
