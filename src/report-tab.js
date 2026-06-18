const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const YELLOW = 'FFFFFF00';   // auto-fixed cells
   // needs attention
const BLUE   = 'FFD6EAF8';   // formula error groups
const PINK   = 'FFFFC0CB';

function isValidCell(cell) {
  if (!cell || cell === 'N/A' || cell === 'null' || cell === '' || cell === 'Unknown') return false;
  return /^[A-Z]+[0-9]+$/.test(cell.toString().trim());
}

// ── Build standalone report file ──────────────────────────────────────────────
async function buildReportFile(outputPath, allIssues, allFixes, fileInfo) {
  const workbook = new ExcelJS.Workbook();
  const report = workbook.addWorksheet('Validation Report');

  report.columns = [
    { width: 5  },
    { width: 26 },
    { width: 10 },
    { width: 50 },
    { width: 44 },
  ];

  // Title
  report.mergeCells('A1:E1');
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
    ['Note:', 'Blue = formula errors (investigate at source) · Pink = needs attention · Original file is unchanged'],
  ].forEach(([label, value]) => {
    const row = report.addRow([label, value]);
    row.getCell(1).font = { bold: true, color: { argb: 'FF1A2B4A' } };
    report.mergeCells(`B${row.number}:E${row.number}`);
  });

  report.addRow([]);

  // ── AUTO-FIXED section ──────────────────────────────────────────────────────
  const fixedHeader = report.addRow(['AUTO-FIXED ISSUES']);
  report.mergeCells(`A${fixedHeader.number}:E${fixedHeader.number}`);
  fixedHeader.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D7A6B' } };
  fixedHeader.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  fixedHeader.height = 22;

  const fixedCols = report.addRow(['#', 'Sheet', 'Cell', 'Issue Found', 'Fix Applied']);
  fixedCols.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    cell.alignment = { horizontal: 'center' };
  });

  const fixed = allFixes.filter(f => f.fixable);
  if (fixed.length === 0) {
    report.addRow(['', '', '', 'No auto-fixable issues found', '']);
  } else {
    fixed.forEach((f, i) => {
      const row = report.addRow([
        i + 1,
        f.sheet || '',
        f.cell || '',
        f.issue || '',
        f.fix || '',
      ]);
      if (i % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        });
      }
      // Yellow indicator in Cell column
      if (f.cell) {
        row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
      }
    });
  }

  report.addRow([]);

  // ── NEEDS ATTENTION section ─────────────────────────────────────────────────
  const flaggedHeader = report.addRow(['NEEDS YOUR ATTENTION']);
  report.mergeCells(`A${flaggedHeader.number}:E${flaggedHeader.number}`);
  flaggedHeader.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } };
  flaggedHeader.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  flaggedHeader.height = 22;

  const flaggedCols = report.addRow(['#', 'Sheet', 'Cell', 'Issue', 'Action Required']);
  flaggedCols.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    cell.alignment = { horizontal: 'center' };
  });

  const flagged = allIssues.filter(i => !i.fixable);
  if (flagged.length === 0) {
    report.addRow(['', '', '', 'No items require attention', '']);
  } else {
    flagged.forEach((f, i) => {
      const cellRef = isValidCell(f.cell) ? f.cell : 'A1';
      const row = report.addRow([
        i + 1,
        f.sheet || '',
        cellRef,
        f.issue || f.reason || f.label || '',
        f.fix_instruction || 'Review and fix manually',
      ]);
      const isFormulaError = f.type === 'formula_error';
      if (i % 2 === 0) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isFormulaError ? BLUE : 'FFFCE7F3' } };
        });
      } else if (isFormulaError) {
        row.eachCell(cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
        });
      }
      // Pink indicator in Cell column
      row.getCell(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PINK } };
    });
  }

  report.addRow([]);
  const footer = report.addRow([
    'Blue rows = formula errors (must be fixed at source, never masked) · Pink rows = needs your attention · Original file was not modified'
  ]);
  report.mergeCells(`A${footer.number}:E${footer.number}`);
  footer.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };

  await workbook.xlsx.writeFile(outputPath);
  console.log(`   ✅ Report file built: ${path.basename(outputPath)}`);
  console.log(`   ✅ ${fixed.length} auto-fixed + ${flagged.length} flagged items`);
}

// ── Keep for backward compatibility ───────────────────────────────────────────
async function buildReportAndHighlight(inputPath, outputPath, allIssues, allFixes, fileInfo) {
  await buildReportFile(outputPath, allIssues, allFixes, fileInfo);
}

module.exports = { buildReportAndHighlight, buildReportFile };
