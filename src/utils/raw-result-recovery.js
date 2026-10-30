'use strict';
// raw-result-recovery.js - Patch 36. Puts back text results that the Excel reader turned into "Invalid Date".
//
// When a formula returns text ("FY26") but the cell is formatted as a date, exceljs converts the saved text to a date at
// load, and the result becomes an Invalid Date: the text is gone from the loaded workbook. On The Bend that hid the saved
// period labels of 570 lookups, so they were counted as not tested, and it would equally show a wrong value to any other
// check or to the reviewer. The text is still in the file, in the sheet XML, so it is read from there and written back
// to the cell's saved result.
//
// Only formula cells whose saved result is an Invalid Date are touched, and only their saved result: formulas, styles and
// every other cell stay as loaded. A sheet whose XML is too large to read in one piece is skipped and reported, never guessed.

const fs = require('fs');
const JSZip = require('jszip');

const MAX_SHEET_CHARS = 80 * 1024 * 1024;
const MAX_TARGETS = 20000;

const unescapeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');

function isFormula(v) { return v && typeof v === 'object' && !(v instanceof Date) && (typeof v.formula === 'string' || 'sharedFormula' in v); }

// Formula cells whose saved result is an Invalid Date, per sheet name -> Set of addresses.
function findTargets(workbook) {
  const out = new Map(); let total = 0;
  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, row => {
      row.eachCell({ includeEmpty: false }, cell => {
        const v = cell.value;
        if (!isFormula(v)) return;
        const r = v.result;
        if (r instanceof Date && isNaN(r.getTime())) {
          if (!out.has(ws.name)) out.set(ws.name, new Set());
          out.get(ws.name).add(cell.address); total++;
        }
      });
    });
  });
  return { targets: out, total };
}

function sheetPaths(wbXml, relsXml) {
  const rels = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0]), tg = /\bTarget="([^"]+)"/.exec(m[0]);
    if (id && tg) rels[id[1]] = tg[1];
  }
  const out = {};
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const nm = /\bname="([^"]*)"/.exec(m[0]), rid = /\br:id="([^"]+)"/.exec(m[0]);
    if (!nm || !rid || !rels[rid[1]]) continue;
    let t = rels[rid[1]];
    t = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    out[unescapeXml(nm[1])] = t;
  }
  return out;
}

async function recoverTextResults(workbook, filePath) {
  const t0 = Date.now();
  const { targets, total } = findTargets(workbook);
  const res = { found: total, recovered: 0, skipped: 0, skippedSheets: [], ms: 0 };
  if (!total) { res.ms = Date.now() - t0; return res; }
  if (total > MAX_TARGETS) { res.skipped = total; res.skippedSheets.push('too many cells to recover'); res.ms = Date.now() - t0; return res; }
  let zip;
  try { zip = await JSZip.loadAsync(fs.readFileSync(filePath)); } catch (e) { res.skipped = total; res.skippedSheets.push('file could not be reopened'); res.ms = Date.now() - t0; return res; }
  const wbXml = zip.file('xl/workbook.xml') ? await zip.file('xl/workbook.xml').async('string') : '';
  const relXml = zip.file('xl/_rels/workbook.xml.rels') ? await zip.file('xl/_rels/workbook.xml.rels').async('string') : '';
  const paths = sheetPaths(wbXml, relXml);
  for (const [sheet, addrs] of targets) {
    const entry = paths[sheet] && zip.file(paths[sheet]);
    if (!entry) { res.skipped += addrs.size; res.skippedSheets.push(sheet); continue; }
    const xml = await entry.async('string');
    if (xml.length > MAX_SHEET_CHARS) { res.skipped += addrs.size; res.skippedSheets.push(sheet); continue; }
    const ws = workbook.getWorksheet(sheet);
    const seen = new Set();
    for (const m of xml.matchAll(/<c r="([A-Z]{1,3}\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      if (!addrs.has(m[1]) || !m[3]) continue;
      const t = /\bt="([^"]+)"/.exec(m[2]);
      const v = /<v>([\s\S]*?)<\/v>/.exec(m[3]);
      if (!v) continue;
      const cell = ws.findCell(m[1]);
      if (!cell || !cell._value || !cell._value.model) continue;
      let value;
      if (t && t[1] === 'str') value = unescapeXml(v[1]);
      else if (t && t[1] === 'e') value = { error: unescapeXml(v[1]) };
      else if (t && t[1] === 'b') value = v[1] === '1';
      else continue;                                                   // a number would not have become an Invalid Date
      cell._value.model.result = value;
      seen.add(m[1]); res.recovered++;
    }
    // a merged cell shares its master's value, so it reads correctly once the master is repaired: count what now reads correctly
    for (const a of addrs) {
      if (seen.has(a)) continue;
      const c = ws.findCell(a); const v = c && c.value;
      if (v && typeof v === 'object' && !(v.result instanceof Date && isNaN(v.result.getTime())) && c.isMerged) { seen.add(a); res.recovered++; }
    }
    res.skipped += addrs.size - seen.size;
    if (addrs.size - seen.size) res.skippedSheets.push(sheet);
  }
  res.ms = Date.now() - t0;
  return res;
}

module.exports = { recoverTextResults, findTargets };
