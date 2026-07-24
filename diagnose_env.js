require('dotenv').config();
function preview(name, sensitive) {
  const v = process.env[name];
  if (v == null || v === '') { console.log(name + ': NOT SET'); return; }
  if (sensitive) console.log(name + ': set (' + v.length + ' chars, starts with "' + v.slice(0, 6) + '...")');
  else console.log(name + ': "' + v + '"');
}
console.log('=== Env values as loaded by this project ===');
preview('ANTHROPIC_API_KEY', true);
preview('GOOGLE_DRIVE_FOLDER_ID', false);
preview('GOOGLE_CREDENTIALS_PATH', false);
preview('RESEND_API_KEY', true);
preview('NOTIFY_EMAIL', false);
const fs = require('fs');
console.log('');
console.log('credentials.json exists at project root:', fs.existsSync('./credentials.json'));
console.log('token.json exists at project root:', fs.existsSync('./token.json'));
