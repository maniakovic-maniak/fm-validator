// Centralized error-message catalog for the upload-integrity check.
//
// Every message here is written for the actual end user filling in the
// public submission form — no raw system/library error text, no jargon
// a non-technical person wouldn't recognize. Each entry has a stable
// `code` (for the frontend to key off — different icon, different
// styling, analytics) separate from the human-readable `message` (what
// actually displays), and an optional `logDetail` template for
// server-side logs/support tickets, where the real technical detail
// belongs instead of in front of the user.

const UPLOAD_ERRORS = {
  READ_FAILED: {
    code: 'READ_FAILED',
    message: "We couldn't read your file. Please try uploading it again.",
    logDetail: (detail) => `File stat failed: ${detail}`,
  },

  EMPTY_FILE: {
    code: 'EMPTY_FILE',
    message: 'This file is empty. The upload may have been interrupted — please try again.',
    logDetail: () => 'File size was 0 bytes',
  },

  FILE_TOO_LARGE: {
    code: 'FILE_TOO_LARGE',
    message: (sizeMB, limitMB) => sizeMB
      ? `This file is ${sizeMB}MB, which is over our ${limitMB}MB limit. Please reduce the file size (removing unused sheets, embedded images, or old versions of the model can help) and try again.`
      : `This file is over our ${limitMB}MB limit. Please reduce the file size (removing unused sheets, embedded images, or old versions of the model can help) and try again.`,
    logDetail: (sizeMB, limitMB) => sizeMB
      ? `File size ${sizeMB}MB exceeded the ${limitMB}MB limit`
      : `File exceeded the ${limitMB}MB limit (exact size unknown — rejected mid-stream by multer before full size was known)`,
  },

  UNSUPPORTED_EXTENSION: {
    code: 'UNSUPPORTED_EXTENSION',
    message: () => `Please upload your model as .xlsx, .xlsm, .xlsb, or .xls.`,
    logDetail: (ext) => `Unsupported extension: ${ext}`,
  },

  WRONG_FORMAT_MODERN: {
    code: 'WRONG_FORMAT_MODERN',
    message: (ext) => `This doesn't look like a genuine ${ext} file — it may have the wrong extension, or be a different file type entirely. Please confirm you're uploading an actual Excel workbook.`,
    logDetail: (ext) => `File signature did not match expected ZIP-based format for ${ext}`,
  },

  WRONG_FORMAT_LEGACY: {
    code: 'WRONG_FORMAT_LEGACY',
    message: "This doesn't look like a genuine .xls file. Please confirm you're uploading an actual Excel workbook, or try saving it as .xlsx instead.",
    logDetail: () => 'File signature did not match expected OLE2/CFB format for .xls',
  },

  PASSWORD_PROTECTED: {
    code: 'PASSWORD_PROTECTED',
    message: 'This file is password-protected. Please remove the password before uploading — in Excel: File → Info → Protect Workbook → Encrypt with Password → clear the password field.',
    logDetail: () => 'File signature or parser error indicated password protection',
  },

  CORRUPTED: {
    code: 'CORRUPTED',
    message: "We couldn't open this file — it may be corrupted or damaged. Try re-saving it in Excel (File → Save As, keeping the same format) and uploading the new copy.",
    logDetail: (detail) => `Both ExcelJS and openpyxl fallback failed to open the file: ${detail}`,
  },

  NO_SHEETS: {
    code: 'NO_SHEETS',
    message: 'This workbook appears to have no sheets in it. Please confirm the file uploaded correctly.',
    logDetail: () => 'Workbook opened but contained zero sheets',
  },

  NOT_A_MODEL: {
    code: 'NOT_A_MODEL',
    message: "This doesn't look like a financial model — we couldn't find sheets with names like \"Inputs,\" \"Balance Sheet,\" or \"Cash Flow.\" If this genuinely is a financial model, please contact support so we can take a closer look.",
    logDetail: (matched, total) => `Only ${matched} of ${total} sheets matched known model-structure keywords`,
  },
};

/**
 * Builds the {message, code, logDetail} triple for a given error key,
 * applying any arguments the message template needs.
 */
function buildError(key, ...args) {
  const entry = UPLOAD_ERRORS[key];
  if (!entry) {
    throw new Error(`Unknown upload error code: ${key}`);
  }
  return {
    code: entry.code,
    message: typeof entry.message === 'function' ? entry.message(...args) : entry.message,
    logDetail: typeof entry.logDetail === 'function' ? entry.logDetail(...args) : entry.logDetail,
  };
}

module.exports = { UPLOAD_ERRORS, buildError };
