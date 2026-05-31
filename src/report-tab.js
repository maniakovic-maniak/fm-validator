const ExcelJS = require('exceljs');

const YELLOW = 'FFFFFF00';
const PINK   = 'FFFFC0CB';

function isValidCell(cell) {
  if (!cell || cell === 'N/A' || cell === 'null' || cell === '' || cell === 'Unknown') return false;
  return /^[A-Z]+[0-9]+$/.test(cell.toString().trim());
}

async function buildReportAndHighlight(inputPath, outputPath, allIssues, allFixes, fileInfo) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputPath);

  // ── Highlight auto-fixed cells YELLOW ────────────────────────────────
  for (const fix of allFixes) {
    if (!fix.sheet) continue;
    if (!isValidCell(fix.cell)) fix.cell = 'A1';
    const sheet = workbook.getWorksheet(fix.sheet);
    if (!sheet) continue;
    try {
      sheet.getCell(fix.cell).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW }
      };
    } catch (e) { /* skip */ }
  }

  // ── Highlight flagged cells PINK ──────────────────────────────────────
  for (const issue of allIssues) {
    if (!issue.sheet) continue;
    if (!isValidCell(issue.cell)) issue.cell = 'A1';
    const sheet = workbook.getWorksheet(issue.sheet);
    if (!sheet) continue;
    try {
      sheet.getCell(issue.cell).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: PINK }
      };
    } catch (e) { /* skip */ }
  }

  // ── Remove old report tab ─────────────────────────────────────────────
  const existing = workbook.getWorksheet('Validation Report');
  if (existing) workbook.removeWorksheet(existing.id);

  // ── Build Report tab ──────────────────────────────────────────────────
  const report = workbook.addWorksheet('Validation Report');

  report.columns = [
    { width: 5  },
    { width: 26 },
    { width: 10 },
    { width: 50 },
    { width: 44 },
    { width: 18 },
  ];

  // Title
  report.mergeCells('A1:F1');
  const titleCell = report.getCell('A1');
  titleCell.value = 'VALIDATION REPORT';
  titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2B4A' } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  report.getRow(1).height = 32;

  // Meta
  [
    ['File:', fileInfo.originalName],
    ['Validated:', new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })],
    ['Auto-fixed:', allFixes.filter(f => f.fixable).length],
    ['Needs attention:', allIssues.filter(i => !i.fixable).length],
  ].forEach(([label, value]) => {
    const row = report.addRow([label, value]);
    row.getCell(1).font = { bold: true, color: { argb: 'FF1A2B4A' } };
  });

  report.addRow([]);

  // ── AUTO-FIXED section ────────────────────────────────────────────────
  const fixedHeader = report.addRow(['AUTO-FIXED ISSUES — cells highlighted yellow in the file']);
  report.mergeCells(`A${fixedHeader.number}:F${fixedHeader.number}`);
  fixedHeader.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D7A6B' } };
  fixedHeader.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  fixedHeader.height = 22;

  const fixedCols = report.addRow(['#', 'Sheet', 'Cell', 'Issue Found', 'Fix Applied', 'Go to Sheet']);
  fixedCols.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    cell.alignment = { horizontal: 'center' };
  });

  const fixed = allFixes.filter(f => f.fixable);
  if (fixed.length === 0) {
    report.addRow(['', '', '', 'No auto-fixable issues found', '', '']);
  } else {
    fixed.forEach((f, i) => {
      const row = report.addRow([
        i + 1,
        f.sheet || '',
        f.cell || 'A1',
        f.issue || '',
        f.fix || '',
        ''
      ]);
      if (i % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        });
      }
      if (f.sheet) {
        const targetCell = isValidCell(f.cell) ? f.cell : 'A1';
        const linkCell = row.getCell(6);
        linkCell.value = { text: `→ ${f.sheet}`, hyperlink: `#'${f.sheet}'!${targetCell}` };
        linkCell.font = { color: { argb: 'FF1A2B4A' }, underline: true, bold: true };
        linkCell.alignment = { horizontal: 'center' };
      }
    });
  }

  report.addRow([]);

  // ── NEEDS ATTENTION section ───────────────────────────────────────────
  const flaggedHeader = report.addRow(['NEEDS YOUR ATTENTION — cells highlighted pink in the file']);
  report.mergeCells(`A${flaggedHeader.number}:F${flaggedHeader.number}`);
  flaggedHeader.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } };
  flaggedHeader.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  flaggedHeader.height = 22;

  const flaggedCols = report.addRow(['#', 'Sheet', 'Cell', 'Issue', 'Action Required', 'Go to Sheet']);
  flaggedCols.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    cell.alignment = { horizontal: 'center' };
  });

  const flagged = allIssues.filter(i => !i.fixable);
  if (flagged.length === 0) {
    report.addRow(['', '', '', 'No items require attention', '', '']);
  } else {
    flagged.forEach((f, i) => {
      const cellRef = isValidCell(f.cell) ? f.cell : 'A1';
      const row = report.addRow([
        i + 1,
        f.sheet || '',
        cellRef,
        f.issue || f.reason || f.label || '',
        f.fix_instruction || 'Review and fix manually',
        ''
      ]);
      if (i % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE7F3' } };
        });
      }
      if (f.sheet) {
        const linkCell = row.getCell(6);
        linkCell.value = { text: `→ ${f.sheet}`, hyperlink: `#'${f.sheet}'!${cellRef}` };
        linkCell.font = { color: { argb: 'FFB45309' }, underline: true, bold: true };
        linkCell.alignment = { horizontal: 'center' };
      }
    });
  }

  report.addRow([]);
  const footer = report.addRow([
    'Yellow cell = auto-fixed  |  Pink cell = needs your attention  |  Click → links to jump to the relevant sheet and cell.'
  ]);
  report.mergeCells(`A${footer.number}:F${footer.number}`);
  footer.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };

  await workbook.xlsx.writeFile(outputPath);
  console.log(`   ✅ Report tab built with ${fixed.length} fixes (yellow) + ${flagged.length} flagged (pink)`);
}

module.exports = { buildReportAndHighlight };
