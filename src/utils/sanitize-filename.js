const path = require('path');

/**
 * Sanitise a user-supplied filename before it ever touches a disk path.
 * Strips directory components, control characters, and anything outside
 * a conservative safe charset — then hard-caps the length. The caller
 * still appends its own timestamp/random suffix, so collisions and any
 * residual ambiguity are handled independently of user input.
 */
function sanitizeFilename(originalName) {
  // path.basename strips any directory traversal segments (../, /, \)
  const base = path.basename(String(originalName || 'file'));
  const ext  = path.extname(base).slice(0, 10); // cap absurd extensions
  let name   = path.parse(base).name;

  // Keep letters, numbers, spaces, dash, underscore, parens only
  name = name.replace(/[^a-zA-Z0-9 _\-()]/g, '').trim();
  if (!name) name = 'file';
  name = name.slice(0, 100); // hard cap — avoids filesystem/path-length issues

  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, '');
  return { name, ext: safeExt };
}

module.exports = { sanitizeFilename };
