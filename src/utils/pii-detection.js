// pii-detection.js — G12: scan cell VALUES (not formulas — PII appears as
// literal data, not formula logic) for personally identifiable
// information. Inspired by CellSentry's PII detection feature, but with
// patterns chosen for an Australian financial-modelling context rather
// than the US/CN locales that tool covers.
//
// Deliberately conservative: high-confidence, low-ambiguity patterns
// (email, Luhn-validated credit cards, SSN, IBAN) are flagged standalone.
// More ambiguous numeric formats that are common in financial models for
// entirely unrelated reasons (a TFN-length number could just as easily be
// a dollar figure) are only flagged when nearby row/column context
// actually suggests personal/banking data — same principle as G1's
// check-label approach, applied here to avoid flooding a report with
// false positives on ordinary numeric data.

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g;
const CC_CANDIDATE_RE = /\b(?:\d[ -]?){13,19}\b/g;

const BANKING_CONTEXT_RE = /\b(BSB|bank account|account number|TFN|tax file number|bank details|payee|payroll|super(annuation)?|salary)\b/i;

function luhnCheck(numStr) {
  let sum = 0, alt = false;
  for (let i = numStr.length - 1; i >= 0; i--) {
    let n = parseInt(numStr[i], 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function rowLabel(worksheet, rowNumber) {
  let label = null;
  worksheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
    if (label === null && typeof cell.value === 'string') label = cell.value;
  });
  return label;
}

function checkPII(workbook) {
  const findings = [];

  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.formula) return; // PII appears as literal data, not formula logic
        const raw = cell.value;
        if (raw === null || raw === undefined) return;

        // Numeric-pattern checks (credit card, SSN, IBAN, TFN, BSB) only
        // apply to genuinely string-typed cells. A financial figure like
        // 38.50994134900524, converted to text purely for pattern
        // matching, can accidentally contain a digit run that
        // coincidentally passes Luhn — confirmed as a real false-positive
        // class via testing (multiple "credit card" hits in Valuation
        // and Scenario cells that were plainly just numeric results).
        // Genuine PII is almost always stored as text in the first place,
        // to preserve exact formatting (leading zeros, digit grouping),
        // so requiring a real string type is both more accurate and
        // eliminates this false-positive class entirely.
        const isGenuineText = typeof raw === 'string';
        const text = String(raw);

        // Email can appear inside a longer string value regardless of
        // type oddities, but in practice will only ever be a string.
        let m;
        EMAIL_RE.lastIndex = 0;
        while ((m = EMAIL_RE.exec(text)) !== null) {
          findings.push({ sheet: worksheet.name, cell: cell.address, type: 'Email address', match: m[0], confidence: 'high' });
        }
        SSN_RE.lastIndex = 0;
        while (isGenuineText && (m = SSN_RE.exec(text)) !== null) {
          findings.push({ sheet: worksheet.name, cell: cell.address, type: 'US SSN-format number', match: redact(m[0]), confidence: 'high' });
        }
        IBAN_RE.lastIndex = 0;
        while (isGenuineText && (m = IBAN_RE.exec(text)) !== null) {
          findings.push({ sheet: worksheet.name, cell: cell.address, type: 'IBAN-format number', match: redact(m[0]), confidence: 'high' });
        }
        CC_CANDIDATE_RE.lastIndex = 0;
        while (isGenuineText && (m = CC_CANDIDATE_RE.exec(text)) !== null) {
          const digitsOnly = m[0].replace(/[ -]/g, '');
          if (digitsOnly.length >= 13 && digitsOnly.length <= 19 && luhnCheck(digitsOnly)) {
            findings.push({ sheet: worksheet.name, cell: cell.address, type: 'Credit card number (Luhn-valid)', match: redact(m[0]), confidence: 'high' });
          }
        }

        // Lower confidence, context-required — a bare 8-9 digit number or
        // a 6-digit XXX-XXX pattern is far too common in ordinary
        // financial data (dollar figures, IDs, period counters) to flag
        // on format alone. Only flagged when the row's own label
        // suggests banking/personal data, AND only for genuinely
        // string-typed cells for the same reason as above.
        if (isGenuineText && /^\d{8,9}$/.test(text.trim())) {
          const label = rowLabel(worksheet, rowNumber);
          if (label && BANKING_CONTEXT_RE.test(label)) {
            findings.push({ sheet: worksheet.name, cell: cell.address, type: 'Possible TFN (context: row labeled "' + label.trim() + '")', match: redact(text.trim()), confidence: 'low' });
          }
        }
        if (isGenuineText && /^\d{3}-?\d{3}$/.test(text.trim())) {
          const label = rowLabel(worksheet, rowNumber);
          if (label && BANKING_CONTEXT_RE.test(label)) {
            findings.push({ sheet: worksheet.name, cell: cell.address, type: 'Possible BSB (context: row labeled "' + label.trim() + '")', match: redact(text.trim()), confidence: 'low' });
          }
        }
      });
    });
  });

  return { applicable: true, flaggedCount: findings.length, findings };
}

// Never surface the actual matched value in full — findings should point
// a reviewer to the cell, not reproduce the sensitive data itself.
function redact(s) {
  if (s.length <= 4) return '*'.repeat(s.length);
  return s.slice(0, 2) + '*'.repeat(s.length - 4) + s.slice(-2);
}

module.exports = { checkPII, luhnCheck };
