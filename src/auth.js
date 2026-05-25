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
  if (fs.existsSync(TOKEN_PATH)) {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH));
    const { client_secret, client_id, redirect_uris } = credentials.installed;
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
