const {
  parseLocalRequires, buildDependencyGraph, orderByDependencyProximity,
  describeInBatchDependencies, batchFiles, buildReviewPrompt,
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

  console.log('\n' + (allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'));
  if (!allPass) process.exit(1);
}

run();
