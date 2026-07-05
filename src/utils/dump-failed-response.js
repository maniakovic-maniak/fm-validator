const fs = require('fs');
const path = require('path');

// On any LLM JSON parse failure, save the complete raw response for
// post-mortem — intermittent quote/format breakage cannot be diagnosed
// from console fragments. Files land in logs/failed-responses/.
function dumpFailedResponse(stage, rawText, err) {
  try {
    const dir = path.join(__dirname, '..', '..', 'logs', 'failed-responses');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}__${stage}.txt`);
    fs.writeFileSync(file, `ERROR: ${err.message}\n\n════ RAW RESPONSE ════\n${rawText}`);
    console.error(`   Raw response saved for diagnosis: logs/failed-responses/${path.basename(file)}`);
  } catch (_) { /* never let diagnostics break the pipeline */ }
}

module.exports = { dumpFailedResponse };
