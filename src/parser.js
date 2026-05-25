const { google } = require('googleapis');
const { getAuth } = require('./auth');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

async function downloadFile(fileId) {
  const auth = await getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const destPath = path.join(process.cwd(), 'processed', `${fileId}.xlsm`);
  const dest = fs.createWriteStream(destPath);

  await new Promise((resolve, reject) => {
    drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' },
      (err, res) => {
        if (err) return reject(err);
        res.data
          .on('end', resolve)
          .on('error', reject)
          .pipe(dest);
      }
    );
  });

  return destPath;
}

async function parseExcel(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets = {};
  for (const worksheet of workbook.worksheets) {
    const jsonData = [];
    const rows = worksheet.getSheetValues();
    if (rows && rows.length > 0) {
      const headers = rows[1]; // First row is headers
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        const obj = {};
        if (row) {
          headers.forEach((header, index) => {
            obj[header] = row[index] || null;
          });
          jsonData.push(obj);
        }
      }
    }
    sheets[worksheet.name] = jsonData;
  }

  return {
    sheetNames: workbook.worksheets.map(ws => ws.name),
    sheets,
    _raw: workbook
  };
}

async function fetchAndParse(fileId) {
  console.log(`Downloading file ${fileId}...`);
  const filePath = await downloadFile(fileId);
  console.log(`Parsing...`);
  const parsed = await parseExcel(filePath);
  console.log(`Found ${parsed.sheetNames.length} sheets: ${parsed.sheetNames.join(', ')}`);
  return parsed;
}

module.exports = { fetchAndParse, parseExcel };
