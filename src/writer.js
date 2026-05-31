const { google } = require('googleapis');
const { getAuth } = require('./auth');
const fs = require('fs');
const path = require('path');

async function uploadToDrive(outputPath, outputName, folderId) {
  const auth = await getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const existing = await drive.files.list({
    q: `name='${outputName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)'
  });
  if (existing.data.files.length > 0) {
    await drive.files.delete({ fileId: existing.data.files[0].id });
    console.log(`   Deleted previous validated file`);
  }

  const fileSize = fs.statSync(outputPath).size;
  const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
  console.log(`   File size: ${fileSizeMB} MB`);

  let uploaded = 0;
  const fileStream = fs.createReadStream(outputPath);
  fileStream.on('data', chunk => {
    uploaded += chunk.length;
    const pct = Math.round((uploaded / fileSize) * 100);
    process.stdout.write(`   Uploading to Drive... ${pct}%\r`);
  });

  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const response = await drive.files.create({
    requestBody: {
      name: outputName,
      parents: [folderId],
      mimeType: MIME
    },
    media: {
      mimeType: MIME,
      body: fileStream
    },
    fields: 'id, name, webViewLink'
  });

  process.stdout.write(`   Uploading to Drive... 100%\n`);
  console.log(`   ✅ Upload complete: ${outputName}`);

  return {
    fileId: response.data.id,
    fileName: outputName,
    webViewLink: response.data.webViewLink
  };
}

module.exports = { uploadToDrive };
