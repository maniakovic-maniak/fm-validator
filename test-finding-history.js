const { currentFingerprints, computeCrossRunStats } = require('./src/utils/finding-history');

function run() {
  let allPass = true;

  // --- currentFingerprints: cell-level granularity ---
  const findings1 = [
    { root_cause_id: 'T0-DAISYCHAIN-001', affected_cells: ['SheetA!A1', 'SheetA!A2'], label: 'daisy chain' },
    { root_cause_id: 'T0-DATAVALID-001', affected_cells: [], label: 'no validation' }, // no cells -> falls back to bare ID
  ];
  const fps1 = currentFingerprints(findings1);
  const fpKeys = [...fps1.keys()].sort();
  const expectedKeys = ['T0-DAISYCHAIN-001::SheetA!A1', 'T0-DAISYCHAIN-001::SheetA!A2', 'T0-DATAVALID-001'].sort();
  const fpPass = JSON.stringify(fpKeys) === JSON.stringify(expectedKeys);
  console.log(`${fpPass ? 'PASS' : 'FAIL'}: currentFingerprints produces cell-level keys, with bare-ID fallback for no-affected_cells`);
  if (!fpPass) allPass = false;

  // --- Run 1: everything is new (empty history) ---
  const run1Findings = [
    { root_cause_id: 'T0-DAISYCHAIN-001', affected_cells: ['SheetA!A1', 'SheetA!A2', 'SheetA!A3'], label: '3 daisy chains' },
  ];
  const stats1 = computeCrossRunStats(run1Findings, {});
  const run1Pass = stats1.new.length === 3 && stats1.closed.length === 0 && stats1.regressed.length === 0 && stats1.stillOpen.length === 0;
  console.log(`${run1Pass ? 'PASS' : 'FAIL'}: run 1 (empty history) -- everything is New`);
  if (!run1Pass) allPass = false;

  // --- Run 2: A1 and A3 fixed (both gone), A2 still open, A4 new ---
  const run2Findings = [
    { root_cause_id: 'T0-DAISYCHAIN-001', affected_cells: ['SheetA!A2', 'SheetA!A4'], label: '2 daisy chains' },
  ];
  const stats2 = computeCrossRunStats(run2Findings, stats1.updatedHistory);
  const closedFps = stats2.closed.map(c => c.fingerprint).sort();
  const run2Pass = JSON.stringify(closedFps) === JSON.stringify(['T0-DAISYCHAIN-001::SheetA!A1', 'T0-DAISYCHAIN-001::SheetA!A3'])
    && stats2.stillOpen.length === 1 && stats2.stillOpen[0].fingerprint.endsWith('A2')
    && stats2.new.length === 1 && stats2.new[0].fingerprint.endsWith('A4')
    && stats2.regressed.length === 0;
  console.log(`${run2Pass ? 'PASS' : 'FAIL'}: run 2 -- A1 AND A3 correctly closed (run 1 had 3 cells, run 2 keeps only A2), A2 still open, A4 new`);
  if (!run2Pass) allPass = false;
  console.log('  closed:', stats2.closed.map(c=>c.fingerprint), '| stillOpen:', stats2.stillOpen.map(c=>c.fingerprint), '| new:', stats2.new.map(c=>c.fingerprint));

  // --- Run 3: A1 reappears -- must be REGRESSED, not just "new". A3
  // stays closed (never reappears), so only A1 is a regression. ---
  const run3Findings = [
    { root_cause_id: 'T0-DAISYCHAIN-001', affected_cells: ['SheetA!A1', 'SheetA!A2', 'SheetA!A4'], label: '3 daisy chains again' },
  ];
  const stats3 = computeCrossRunStats(run3Findings, stats2.updatedHistory);
  const run3Pass = stats3.regressed.length === 1 && stats3.regressed[0].fingerprint.endsWith('A1')
    && stats3.new.length === 0 && stats3.closed.length === 0
    && stats3.stillOpen.length === 2; // A2 and A4 both still open
  console.log(`${run3Pass ? 'PASS' : 'FAIL'}: run 3 -- A1 correctly REGRESSED (not counted as merely New), A2/A4 still open, A3 untouched (stays closed)`);
  if (!run3Pass) allPass = false;
  console.log('  regressed:', stats3.regressed.map(r=>r.fingerprint + ' (timesClosed was ' + r.timesClosed + ')'));

  // --- Run 4: everything fixed -- all currently-open items close.
  // A3 was already closed since run 2, so it's not part of this count
  // again -- only the 3 that were open going into run 4 (A1, A2, A4). ---
  const stats4 = computeCrossRunStats([], stats3.updatedHistory);
  const run4Pass = stats4.closed.length === 3 && stats4.new.length === 0 && stats4.regressed.length === 0 && stats4.stillOpen.length === 0;
  console.log(`${run4Pass ? 'PASS' : 'FAIL'}: run 4 -- everything fixed, all 3 currently-open items correctly closed`);
  if (!run4Pass) allPass = false;

  // --- isFirstRun: the real bug found via a bug-scan run. A genuine
  // first run on a perfectly clean model (zero findings) has the exact
  // same counts (0 closed, 0 new, 0 regressed, 0 stillOpen) as run 4
  // above ("everything fixed") -- these must be distinguishable, and
  // isFirstRun is the field that does it, derived from whether any
  // prior history existed at all, not from the counts. ---
  const cleanFirstRunStats = computeCrossRunStats([], {}); // truly empty history = genuine first run
  const isFirstRunPass = cleanFirstRunStats.isFirstRun === true
    && cleanFirstRunStats.closed.length === 0 && cleanFirstRunStats.new.length === 0;
  console.log(`${isFirstRunPass ? 'PASS' : 'FAIL'}: a genuine first run with zero findings is correctly flagged isFirstRun=true`);
  if (!isFirstRunPass) allPass = false;

  const notFirstRunPass = stats4.isFirstRun === false;
  console.log(`${notFirstRunPass ? 'PASS' : 'FAIL'}: run 4 ("everything fixed"), despite having the identical zero-findings shape, is correctly flagged isFirstRun=false (real history existed)`);
  if (!notFirstRunPass) allPass = false;

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}
run();
