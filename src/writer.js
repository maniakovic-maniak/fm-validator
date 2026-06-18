const { google } = require('googleapis');
const { getAuth } = require('./auth');
const fs = require('fs');
const path = require('path');

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function uploadFile(filePath, fileName, folderId, drive) {
  // Delete previous version if exists
  const existing = await drive.files.list({
    q: `name='${fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id)'
  });
  if (existing.data.files.length > 0) {
    await drive.files.delete({ fileId: existing.data.files[0].id });
    console.log(`   Deleted previous: ${fileName}`);
  }

  const fileSize = fs.statSync(filePath).size;
  const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
  let uploaded = 0;
  const fileStream = fs.createReadStream(filePath);

  fileStream.on('data', chunk => {
    uploaded += chunk.length;
    const pct = Math.round((uploaded / fileSize) * 100);
    process.stdout.write(`   Uploading ${fileName}... ${pct}%\r`);
  });

  const response = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId], mimeType: MIME },
    media: { mimeType: MIME, body: fileStream },
    fields: 'id, name, webViewLink'
  });

  process.stdout.write(`   Uploading ${fileName}... 100%\n`);
  console.log(`   ✅ Uploaded: ${fileName} (${fileSizeMB} MB)`);

  return {
    fileId: response.data.id,
    fileName,
    webViewLink: response.data.webViewLink
  };
}

async function uploadToDrive(outputPath, outputName, folderId) {
  const auth = await getAuth();
  const drive = google.drive({ version: 'v3', auth });
  return await uploadFile(outputPath, outputName, folderId, drive);
}

async function uploadBothFiles(reportPath, reportName, folderId) {
  const auth = await getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const reportResult = await uploadFile(reportPath, reportName, folderId, drive);
  return { reportResult };
}

module.exports = { uploadToDrive, uploadBothFiles };
