const { google } = require('googleapis');
const { getAuth } = require('./auth');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const EXCEL_ERROR_CODES = ['#REF!', '#VALUE!', '#DIV/0!', '#NAME?', '#N/A', '#NULL!', '#NUM!'];

async function downloadFile(fileId) {
  const auth = await getAuth();
  const drive = google.drive({ version: 'v3', auth });

  // Fetch the real filename from Drive metadata
  const meta = await drive.files.get({ fileId, fields: 'name' });
  const originalName = meta.data.name || `${fileId}.xlsx`;
  const destPath = path.join(process.cwd(), 'processed', originalName);

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
// ── Formula caching limitation (L3) ──────────────────────────────────────
// exceljs reads formula results from the cached values Excel stores in the
// xlsx zip package. These cached values (cell.value.result) are only present
// when the file was last saved by Excel with calculation enabled.
//
// Files that may have missing cached values:
//   - Files saved by Google Sheets, LibreOffice, or Numbers
//   - Files saved with manual calculation mode and not recalculated before save
//   - Files opened and re-saved by openpyxl or other xlsx libraries
//   - Corrupted or partially-written xlsx files
//
// Impact: formula errors in these files will not be detected by Tier 0 or Tier 1.
// The formula text scanner (Tier 0) partially mitigates this by detecting
// #REF! strings inside formula text — but only for cells whose formula text
// is also cached.
//
// Workaround: instruct clients to open the file in Excel, press F9 to
// recalculate, save, and re-upload before validation.
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
// Find the best header row in the first 10 rows.
// Financial models often have title rows, blank rows, or date rows before
// the actual label row. We pick the row with the most non-empty text cells.
// Returns clean display text for a header cell. Explicitly formats Date
// values (e.g. "Jun 2027") since cell.text can fall back to a raw
// JS Date.toString() output ("Wed Jun 30 2027 10:00:00 GMT+1000...")
// when the cell has no explicit Excel number format applied.
function headerCellText(cell) {
  const v = cell.value;
  if (v instanceof Date) {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${monthNames[v.getMonth()]} ${v.getFullYear()}`;
  }
  if (v && typeof v === 'object' && 'result' in v && v.result instanceof Date) {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${monthNames[v.result.getMonth()]} ${v.result.getFullYear()}`;
  }
  return cell.text != null ? String(cell.text).trim() : '';
}

function findHeaderRow(ws) {
  let bestRow = 1;
  let bestScore = 0;
  const limit = Math.min(10, ws.rowCount);
  for (let r = 1; r <= limit; r++) {
    const row = ws.getRow(r);
    let textCells = 0;
    let numericCells = 0;
    row.eachCell({ includeEmpty: false }, cell => {
      const v = headerCellText(cell);
      if (v.length > 0 && isNaN(Number(v))) textCells++;
      else if (!isNaN(Number(v)) && v.length > 0) numericCells++;
    });
    // Prefer rows with many text cells and few numeric cells — those are labels
    const score = textCells * 2 - numericCells;
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }
  return bestRow;
}

function worksheetToRows(ws) {
  const headerRowNum = findHeaderRow(ws);
  const headerRow = ws.getRow(headerRowNum);
  const headers = [];
  const seen = {};
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    let base = headerCellText(cell);
    if (base === '') base = `col${col}`;
    if (base.length > 40) base = base.substring(0, 40);
    if (seen[base] !== undefined) base = `${base}_${col}`;
    seen[base] = true;
    headers[col] = base;
  });
  const rows = [];
  for (let r = headerRowNum + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = {};
    const cellRefs = {};
    let hasData = false;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const key = headers[col] || `col${col}`;
      obj[key] = cellPlainValue(cell);
      cellRefs[key] = cell.address;
      hasData = true;
    });
    if (hasData) {
      // _cellRefs maps each header label to its real Excel cell address
      // (e.g. "Jun 2086": "J45"). Used downstream so Claude can cite real
      // cell references instead of describing locations in plain English,
      // and so F-score lookups can match findings to formula complexity data.
      Object.defineProperty(obj, '_cellRefs', { value: cellRefs, enumerable: false });
      Object.defineProperty(obj, '_rowNum', { value: r, enumerable: false });
      rows.push(obj);
    }
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
