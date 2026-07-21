// period-sequence-gap-check.js — L11 (fm-validator book-mining: "Excel
// for Auditors", Jelen & Dowell): a gap in a period/date sequence
// (a skipped month, a missing record) is detectable by an irregular
// delta between consecutive periods, relative to the sequence's own
// established, otherwise-consistent spacing.
//
// METHOD: for each row containing a run of date values (plain or
// formula-derived), compute the day-gaps between consecutive periods,
// find the MODAL gap (the sequence's real, established spacing —
// monthly, quarterly, annual, whatever it turns out to be — rather than
// assuming a specific periodicity), and flag any individual gap that is
// a clear multiple of the modal gap (roughly 2x or more, with
// tolerance) — the signature of one or more skipped periods.

const MIN_SEQUENCE_LENGTH = 6;   // need enough dates to establish a real modal spacing
const GAP_MULTIPLE_THRESHOLD = 1.5; // a gap this many times the modal spacing is flagged
const TOLERANCE_DAYS = 3;        // small day-count noise (28 vs 31 day months, leap years) shouldn't itself trigger a flag

function getDateValue(cell) {
  const raw = cell.formula ? cell.result : cell.value;
  if (raw instanceof Date) return raw;
  return null;
}

function modalGap(gaps) {
  const buckets = {};
  for (const g of gaps) {
    // Bucket gaps within TOLERANCE_DAYS of each other together, so
    // ordinary month-length variation (28-31 days) counts as "the same"
    // spacing rather than being treated as many different gap sizes.
    const bucketKey = Math.round(g / (TOLERANCE_DAYS * 2)) * (TOLERANCE_DAYS * 2);
    buckets[bucketKey] = (buckets[bucketKey] || 0) + 1;
  }
  let bestKey = null, bestCount = 0;
  for (const [key, count] of Object.entries(buckets)) {
    if (count > bestCount) { bestCount = count; bestKey = Number(key); }
  }
  return { value: bestKey, count: bestCount };
}

function checkPeriodSequenceGaps(workbook) {
  const findings = [];

  workbook.eachSheet(ws => {
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      const dates = [];
      row.eachCell({ includeEmpty: false }, (cell, colNum) => {
        const d = getDateValue(cell);
        if (d) dates.push({ colNum, address: cell.address, date: d });
      });
      if (dates.length < MIN_SEQUENCE_LENGTH) return;
      dates.sort((a, b) => a.colNum - b.colNum);

      const gaps = [];
      for (let i = 1; i < dates.length; i++) {
        const days = Math.round((dates[i].date - dates[i - 1].date) / 86400000);
        gaps.push(days);
      }
      const { value: modal, count: modalCount } = modalGap(gaps);
      if (modal === null || modalCount < dates.length * 0.5) return; // no real established spacing to compare against

      for (let i = 0; i < gaps.length; i++) {
        if (gaps[i] > modal * GAP_MULTIPLE_THRESHOLD) {
          findings.push({
            sheet: ws.name,
            beforeCell: dates[i].address,
            afterCell: dates[i + 1].address,
            beforeDate: dates[i].date.toISOString().slice(0, 10),
            afterDate: dates[i + 1].date.toISOString().slice(0, 10),
            gapDays: gaps[i],
            modalGapDays: modal,
            note: `${ws.name}: the period sequence jumps from ${dates[i].address} (${dates[i].date.toISOString().slice(0, 10)}) to ${dates[i + 1].address} (${dates[i + 1].date.toISOString().slice(0, 10)}) — a ${gaps[i]}-day gap, against an established spacing of roughly ${modal} days elsewhere in the same row. This is consistent with one or more periods being skipped or deleted from the sequence.`,
          });
        }
      }
    });
  });

  return {
    applicable: true,
    flaggedCount: findings.length,
    findings,
    note: 'Flags an irregular gap in a row of date values, relative to the row\'s own established (modal) spacing — the signature of a skipped or deleted period. Only rows with at least 6 date values, where a single spacing accounts for at least half the gaps, are evaluated; a row without a clear established rhythm has nothing reliable to compare against.',
  };
}

module.exports = { checkPeriodSequenceGaps };
