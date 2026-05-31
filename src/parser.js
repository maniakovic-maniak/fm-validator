const { google } = require('googleapis');
const { getAuth } = require('./auth');
const ExcelJS = require('exceljs');
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
        res.data.on('end', resolve).on('error', reject).pipe(dest);
      }
    );
  });
  return destPath;
}

// Used by index.js (CLI) and validators — returns xlsx _raw for fixer/tier1
function parseExcelXLSX(filePath) {
  const workbook = XLSX.readFile(filePath, { cellFormula: true, cellNF: true });
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
    _raw: workbook,
    _type: 'xlsx'
  };
}

// Used by report-tab.js — returns exceljs workbook for styling
async function parseExcelJS(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheets = {};
  for (const worksheet of wb.worksheets) {
    const jsonData = [];
    const rows = worksheet.getSheetValues();
    if (rows && rows.length > 0) {
      const headers = rows[1];
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        const obj = {};
        if (row && headers) {
          headers.forEach((header, index) => {
            if (header) obj[header] = row[index] || null;
          });
          jsonData.push(obj);
        }
      }
    }
    sheets[worksheet.name] = jsonData;
  }
  return {
    sheetNames: wb.worksheets.map(ws => ws.name),
    sheets,
    _raw: wb,
    _type: 'exceljs'
  };
}

// CLI pipeline — downloads from Drive, parses with xlsx for validators
async function fetchAndParse(fileId) {
  console.log(`Downloading file ${fileId}...`);
  const filePath = await downloadFile(fileId);
  console.log(`Parsing...`);
  const parsed = parseExcelXLSX(filePath);
  console.log(`Found ${parsed.sheetNames.length} sheets: ${parsed.sheetNames.join(', ')}`);
  // Store the file path so report-tab can re-read with exceljs
  parsed._filePath = filePath;
  return parsed;
}

// Server pipeline — parses uploaded file with xlsx for validators
function parseExcel(filePath) {
  const parsed = parseExcelXLSX(filePath);
  parsed._filePath = filePath;
  return parsed;
}

module.exports = { fetchAndParse, parseExcel, parseExcelJS };
