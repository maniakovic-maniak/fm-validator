const { google } = require('googleapis');
const { getAuth } = require('./auth');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const EXCEL_ERROR_CODES = ['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NULL!', '#NUM!'];

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

// ── Cell helpers (exceljs cell model) ─────────────────────────────────────────
// Returns the Excel error code (e.g. "#REF!") if this cell holds or evaluates
// to a formula error, otherwise null.
function cellErrorValue(cell) {
  const v = cell.value;
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    if (typeof v.error === 'string') return v.error;                       // direct error value
    if (v.result && typeof v.result === 'object' && typeof v.result.error === 'string') {
      return v.result.error;                                               // formula evaluating to an error
    }
  }
  return null;
}

// Returns a primitive value for a cell, resolving formulas to their results and
// preserving zeros. Used to summarise sheet data for validators.
function cellPlainValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (typeof v.error === 'string') return v.error;
    if ('result' in v) {
      const r = v.result;
      if (r && typeof r === 'object' && typeof r.error === 'string') return r.error;
      return r === undefined ? null : r;
    }
    if (Array.isArray(v.richText)) return v.richText.map(rt => rt.text).join('');
    if (typeof v.text === 'string') return v.text;                         // hyperlink { text, hyperlink }
    return null;
  }
  return v;
}

// Scans every worksheet for formula errors. Returns [{ sheet, cell, error }].
function scanFormulaErrors(workbook) {
  const findings = [];
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const error = cellErrorValue(cell);
        if (error) findings.push({ sheet: ws.name, cell: cell.address, error });
      });
    });
  });
  return findings;
}

// Builds an array of row objects keyed by header text (first row). Handles blank
// and duplicate headers, and preserves zero values.
function worksheetToRows(ws) {
  const headerRow = ws.getRow(1);
  const headers = [];
  const seen = {};
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    let base = cell.text != null ? String(cell.text).trim() : '';
    if (base === '') base = `col${col}`;
    if (seen[base] !== undefined) base = `${base}_${col}`;
    seen[base] = true;
    headers[col] = base;
  });

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    let hasData = false;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = headers[col] || `col${col}`;
      obj[key] = cellPlainValue(cell);
      hasData = true;
    });
    if (hasData) rows.push(obj);
  }
  return rows;
}

// Parses an .xlsx/.xlsm file with exceljs. The original file is only ever read,
// never modified — fixes are surfaced in a separate report.
async function parseWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheetNames = workbook.worksheets.map(ws => ws.name);
  const sheets = {};
  for (const ws of workbook.worksheets) {
    sheets[ws.name] = worksheetToRows(ws);
  }

  return {
    sheetNames,
    sheets,
    _raw: workbook,
    _type: 'exceljs',
    _filePath: filePath
  };
}

// CLI pipeline — downloads from Drive, then parses.
async function fetchAndParse(fileId) {
  console.log(`Downloading file ${fileId}...`);
  const filePath = await downloadFile(fileId);
  console.log(`Parsing...`);
  const parsed = await parseWorkbook(filePath);
  console.log(`Found ${parsed.sheetNames.length} sheets: ${parsed.sheetNames.join(', ')}`);
  return parsed;
}

// Server pipeline — parses an uploaded file.
async function parseExcel(filePath) {
  return parseWorkbook(filePath);
}

module.exports = {
  fetchAndParse,
  parseExcel,
  parseWorkbook,
  scanFormulaErrors,
  EXCEL_ERROR_CODES
};
