const {
  parseLocalRequires, buildDependencyGraph, orderByDependencyProximity,
  describeInBatchDependencies, batchFiles, buildReviewPrompt,
  extractBugsFromResponse, isSelfRetracted,
} = require('./scripts/bug-scan-agent.js');

function run() {
  let allPass = true;
  const check = (desc, pass) => {
    console.log(`${pass ? 'PASS' : 'FAIL'}: ${desc}`);
    if (!pass) allPass = false;
  };

  // ── parseLocalRequires against real files with known relationships ──────
  const indexDeps = parseLocalRequires('index.js');
  check('index.js correctly resolves a known real local require (revenue-double-counting-check.js)',
    indexDeps.includes('src/utils/revenue-double-counting-check.js'));

  const reportTabDeps = parseLocalRequires('src/report-tab.js');
  check('report-tab.js correctly resolves its Python invocation (build_report.py), even though it has zero local JS requires',
    reportTabDeps.includes('src/build_report.py') && reportTabDeps.length === 1);

  // npm-package requires (non-relative) must NOT be picked up as local deps
  const usesOnlyNpmPackages = !indexDeps.some(d => d.includes('node_modules'));
  check('npm package requires are correctly excluded (only relative ./ requires are parsed)', usesOnlyNpmPackages);

  // ── buildDependencyGraph is genuinely undirected ────────────────────────
  const files = ['index.js', 'src/report-tab.js', 'src/build_report.py', 'src/utils/revenue-double-counting-check.js'];
  const graph = buildDependencyGraph(files);
  check('graph edge exists index.js -> revenue-double-counting-check.js',
    graph.get('index.js').has('src/utils/revenue-double-counting-check.js'));
  check('graph edge is undirected: revenue-double-counting-check.js -> index.js also exists',
    graph.get('src/utils/revenue-double-counting-check.js').has('index.js'));
  check('graph edge exists report-tab.js -> build_report.py (the Python bridge)',
    graph.get('src/report-tab.js').has('src/build_report.py'));

  // A file requiring something OUTSIDE the given file set must not produce
  // a dangling/crashing edge -- confirmed by simply not throwing here.
  const partialGraph = buildDependencyGraph(['index.js']); // index.js requires many files not in this list
  check('a file requiring something outside the given set does not throw or create a phantom node',
    partialGraph.get('index.js').size === 0 && partialGraph.size === 1);

  // ── orderByDependencyProximity: real, files stay complete, index.js first ──
  const allFiles = ['src/utils/revenue-double-counting-check.js', 'src/build_report.py', 'index.js', 'src/report-tab.js'];
  const fullGraph = buildDependencyGraph(allFiles);
  const ordered = orderByDependencyProximity(allFiles, fullGraph);
  check('proximity ordering starts from index.js (the entry point)', ordered[0] === 'index.js');
  check('proximity ordering preserves every file with no loss or duplication',
    ordered.length === allFiles.length && new Set(ordered).size === allFiles.length);
  // revenue-double-counting-check.js is index.js's direct neighbor -- it
  // should appear early (adjacent-ish), not pushed to the very end the
  // way alphabetical order would (b < i < r alphabetically puts it last
  // among these four).
  check('a direct dependency of index.js is NOT pushed to the end the way alphabetical order would',
    ordered.indexOf('src/utils/revenue-double-counting-check.js') < ordered.length - 1);

  // ── describeInBatchDependencies only reports relationships WITHIN the batch ──
  const fullBatch = ['index.js', 'src/utils/revenue-double-counting-check.js'];
  const linesFull = describeInBatchDependencies(fullBatch, fullGraph);
  check('dependency description reports the relationship when both files are in the batch',
    linesFull.some(l => l.includes('index.js') && l.includes('revenue-double-counting-check.js')));

  const partialBatch = ['index.js']; // the dependency itself is NOT in this batch
  const linesPartial = describeInBatchDependencies(partialBatch, fullGraph);
  check('dependency description is empty when the related file is not in the same batch (nothing to show Claude)',
    linesPartial.length === 0);

  // ── batchFiles: with a graph, walks in proximity order; without one, doesn't crash ──
  const batchesNoGraph = batchFiles(['index.js'].concat(allFiles.filter(f => f !== 'index.js')));
  check('batchFiles works with no graph argument at all (incremental-scan-of-1-file case)',
    Array.isArray(batchesNoGraph) && batchesNoGraph.flat().length === allFiles.length);

  const batchesWithGraph = batchFiles(allFiles, fullGraph);
  check('batchFiles with a graph still contains every file exactly once',
    batchesWithGraph.flat().length === allFiles.length && new Set(batchesWithGraph.flat()).size === allFiles.length);

  // ── buildReviewPrompt includes the dependency section only when relevant ──
  const promptWithDeps = buildReviewPrompt(fullBatch, fullGraph);
  check('prompt includes an explicit dependency-relationships section when the batch has one',
    promptWithDeps.includes('Dependency relationships among these files') && promptWithDeps.includes('depends on'));

  const promptNoGraph = buildReviewPrompt(fullBatch); // no graph passed at all
  check('prompt omits the dependency section entirely when no graph is supplied (no crash, no empty section either)',
    !promptNoGraph.includes('Dependency relationships among these files'));

  // ── extractBugsFromResponse: the tool-use response parser ──────────────
  // Replaces the earlier assistant-prefill approach, which the API
  // rejected outright with a real error ("This model does not support
  // assistant message prefill"). Tested here against mocked response
  // objects matching the real SDK's content-block shape.

  const emptyBugsResponse = {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'report_bugs', input: { bugs: [] } }],
  };
  check('extractBugsFromResponse correctly returns an empty array for a clean tool_use response',
    JSON.stringify(extractBugsFromResponse(emptyBugsResponse)) === '[]');

  const realBugResponse = {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'report_bugs', input: { bugs: [
      { file: 'x.js', severity: 'high', description: 'd', old_code: 'a', new_code: 'b' },
    ] } }],
  };
  const extracted = extractBugsFromResponse(realBugResponse);
  check('extractBugsFromResponse correctly extracts a real bug object, already parsed (no JSON.parse needed)',
    extracted.length === 1 && extracted[0].file === 'x.js' && extracted[0].severity === 'high');

  // A response with a thinking block ALONGSIDE the tool_use block --
  // the extractor must find the tool_use block specifically, not be
  // confused by other block types being present too.
  const withThinkingResponse = {
    stop_reason: 'tool_use',
    content: [
      { type: 'thinking', thinking: 'reasoning about the code...' },
      { type: 'tool_use', name: 'report_bugs', input: { bugs: [] } },
    ],
  };
  check('extractBugsFromResponse correctly finds the tool_use block even alongside a thinking block',
    JSON.stringify(extractBugsFromResponse(withThinkingResponse)) === '[]');

  // Malformed / unexpected response -- must not throw, must return []
  const malformedResponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'unexpected prose' }] };
  check('extractBugsFromResponse handles a missing tool_use block gracefully (no crash, returns [])',
    JSON.stringify(extractBugsFromResponse(malformedResponse)) === '[]');

  // ── isSelfRetracted: found via a real run where 10 of 29 "bugs" were
  // the model investigating a candidate and concluding it wasn't
  // actually a bug, but leaving the entry in anyway. Fixtures below are
  // the ACTUAL descriptions (trimmed) from that real run, not invented. ──
  const realSelfRetractedDescriptions = [
    "...this loop only ever inspects args[1] and args[2]... this is not a bug",
    "...No bug found here beyond design; removing this entry.",
    "...if npvPick is null when tv is found but npv is empty, the initial guard prevents that. No real issue here.",
    "...the throw happens before extractJson. Re-examine: ... Skipping.",
    "...discarding the linkCount-based risk... is not possible here since High is already the max non-Critical value, so this is not a bug. Skipping — not a genuine bug (self-correction, no bug reported for this item).",
    "...enumerate(findings,5) gives finding[0]->5, finding[1]->6, which matches. This is actually consistent - not a bug.",
    "...the header is placed directly after the spacer row with no gap issue. This is fine. Not a bug -- retracted.",
    "...it is consistent because the Issue Log tab later iterates in the same order. Not a bug.",
    "...it can't be verified without the producer; skipping as it can't be verified without the producer",
    "...this is inherent to the fallback and not obviously wrong on its own... Not flagging further since behavior is intentional/documented as a fallback.",
  ];
  const allRetracted = realSelfRetractedDescriptions.every(d => isSelfRetracted({ description: d }));
  check('isSelfRetracted correctly flags all 10 real self-retracted descriptions from an actual run', allRetracted);
  if (!allRetracted) {
    realSelfRetractedDescriptions.forEach((d, i) => {
      if (!isSelfRetracted({ description: d })) console.log(`  MISSED: [${i}] ${d.slice(0, 80)}`);
    });
  }

  // Real GENUINE bug descriptions from the same run -- must NOT be
  // filtered out (no false positives).
  const realGenuineDescriptions = [
    "downloadFile calls drive.files.get twice for the same file: once to fetch metadata...",
    "The #NAME error regex is missing the trailing '!' and uses '?' as a literal quantifier-less character class issue...",
    "getAuth() reads CREDENTIALS_PATH synchronously without checking it exists...",
    "The Issue Log 'View' hyperlink... HYPERLINK formula for 'Go to Cell' omits the cell reference's sheet-quoting for sheet names containing spaces...",
  ];
  const noneFalsePositive = realGenuineDescriptions.every(d => !isSelfRetracted({ description: d }));
  check('isSelfRetracted does NOT flag real genuine bug descriptions from the same run (no false positives)', noneFalsePositive);
  if (!noneFalsePositive) {
    realGenuineDescriptions.forEach((d, i) => {
      if (isSelfRetracted({ description: d })) console.log(`  FALSE POSITIVE: [${i}] ${d.slice(0, 80)}`);
    });
  }

  // extractBugsFromResponse must apply the filter end-to-end, not just
  // the standalone predicate.
  const mixedResponse = {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', name: 'report_bugs', input: { bugs: [
      { file: 'real.js', severity: 'high', description: 'A genuine race condition in the write path.', old_code: 'a', new_code: 'b' },
      { file: 'fake.js', severity: 'medium', description: 'On reflection this is not a bug, skipping.', old_code: 'c', new_code: 'd' },
    ] } }],
  };
  const filteredResult = extractBugsFromResponse(mixedResponse);
  check('extractBugsFromResponse end-to-end: keeps the genuine bug, drops the self-retracted one',
    filteredResult.length === 1 && filteredResult[0].file === 'real.js');

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

run();
