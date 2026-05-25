const { google } = require('googleapis');
const { getAuth } = require('./auth');
const XLSX = require('xlsx');
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

function parseExcel(filePath) {
  const workbook = XLSX.readFile(filePath, {
    cellFormula: true,
    cellNF: true,
  });

  const sheets = {};
  for (const name of workbook.SheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
      defval: null,
      raw: false,
    });
  }

  return {
    sheetNames: workbook.SheetNames,
    sheets,
    _raw: workbook
  };
}

async function fetchAndParse(fileId) {
  console.log(`Downloading file ${fileId}...`);
  const filePath = await downloadFile(fileId);
  console.log(`Parsing...`);
  const parsed = parseExcel(filePath);
  console.log(`Found ${parsed.sheetNames.length} sheets: ${parsed.sheetNames.join(', ')}`);
  return parsed;
}

module.exports = { fetchAndParse, parseExcel };
