// Run this within fm-validator's own repo, where it belongs (parseExcel
// and its real dependencies live here, not in Partner Review's separate
// repo):
//   node scripts/export-for-partner-review.js /path/to/model.xlsm [orderId] > export.json
//
// The optional orderId looks up that specific run's real, persisted
// visibility record - exactly which sheets/rows fm-validator's own
// curated route actually showed for that run. Without it, the export
// still works, but Phase B loses the ability to distinguish a genuine
// reasoning miss from a visibility gap the curated route never had the
// chance to see in the first place.
//
// The resulting export.json is what gets handed off to Partner Review -
// matching the shared-filesystem architecture already agreed on, not a
// direct code dependency between the two separate repos.

// Patch 43: the export is the JSON on stdout. The parser prints progress lines with console.log (stdout), and one of them
// ("Text results in date-formatted cells") landed in the JSON and broke every Partner Review run. All logging goes to stderr here.
console.log = console.info = (...a) => console.error(...a);

const { buildFullExport, batchExport } = require('../src/utils/partner-review-export');
const { getOrder } = require('../src/utils/order-store');
const path = require('path');
const { ranAsCompleteFullParse, buildCompleteVisibility } = require('../src/utils/full-parse-visibility');

const filePath = process.argv[2];
const orderId = process.argv[3];
if (!filePath) {
  console.error('Usage: node scripts/export-for-partner-review.js /path/to/model.xlsm [orderId] > export.json');
  process.exit(1);
}

(async () => {
  const fullExport = await buildFullExport(filePath);
  const batches = batchExport(fullExport);
  console.error(`Exported ${Object.keys(fullExport.sheets).length} sheets, ${fullExport.namedRanges.length} named ranges, split into ${batches.length} batches.`);

  let visibilityRecord = null;
  if (orderId) {
    const order = getOrder(orderId);
    if (order && order.visibilityRecord) {
      visibilityRecord = order.visibilityRecord;
      console.error(`Included the real visibility record from order ${orderId}'s own run.`);
    } else if (ranAsCompleteFullParse(order, path.join(__dirname, '..', 'logs', 'runs'))) {
      // The full-parse route showed the reviewer every formula, all static text and every named range, so nothing
      // was out of sight: record that, so a miss on this run is counted as a genuine miss.
      visibilityRecord = buildCompleteVisibility(fullExport.sheets);
      console.error(`Order ${orderId} ran on the full-parse route with complete workbook coverage: recorded every exported cell as visible (${Object.keys(visibilityRecord).length} sheets).`);
    } else {
      console.error(`\u26a0\ufe0f  No visibility record found for order ${orderId} - either it predates this feature, or ran on the full-parse route (which has nothing to record a gap for). Proceeding without one.`);
    }
  }

  // The actual export goes to stdout, so it can be redirected cleanly
  // to a file without the diagnostic lines above getting mixed in.
  process.stdout.write(JSON.stringify({ fullExport, batches, visibilityRecord }));
})();
