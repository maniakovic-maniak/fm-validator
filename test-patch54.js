// Patch 54: a batch cut off by a dropped connection is retried once; nothing else is retried.
const { isTransientApiError, withTransientRetry } = require('./src/validator-tier2');
let pass = 0, fail = 0;
const check = (n, ok, extra) => { if (ok) { pass++; console.log('PASS: ' + n); } else { fail++; console.log('FAIL: ' + n + (extra ? ' -> ' + extra : '')); } };
const err = (message, status, code) => Object.assign(new Error(message), { status, code });
const quiet = { delayMs: 0, log: () => {} };

check('the error from the ESO run ("terminated") is transient', isTransientApiError(err('terminated')));
check('reset / hang-up / closed-socket / fetch failed are transient', ['read ECONNRESET', 'socket hang up', 'other side closed', 'fetch failed', 'Connection error.'].every(m => isTransientApiError(err(m))));
check('code-only errors are transient', isTransientApiError(err('x', undefined, 'ECONNRESET')));
check('500, 502, 503, 504, 529 and 408 are transient', [500, 502, 503, 504, 529, 408].every(s => isTransientApiError(err('x', s))));
check('401, 400, 403, 404, 413, 422 and 429 are never retried', [401, 400, 403, 404, 413, 422, 429].every(s => !isTransientApiError(err('boom terminated', s))));
check('an ordinary error (bad JSON, max_tokens) is not transient', !isTransientApiError(err('response truncated at 128000 output tokens')) && !isTransientApiError(err('Unexpected token')));
check('null is not transient', !isTransientApiError(null));

(async () => {
  let calls = 0;
  const ok = await withTransientRetry(async () => { calls++; if (calls === 1) throw err('terminated'); return 'done'; }, 'B2', quiet);
  check('a dropped connection is retried once and the retry result is used', ok === 'done' && calls === 2);

  calls = 0;
  try { await withTransientRetry(async () => { calls++; throw err('terminated'); }, 'B2', quiet); check('two drops in a row still fail', false); }
  catch (e) { check('two drops in a row fail after exactly two calls, with the original error', calls === 2 && /terminated/.test(e.message)); }

  calls = 0;
  try { await withTransientRetry(async () => { calls++; throw err('invalid x-api-key', 401); }, 'B2', quiet); }
  catch (e) { check('an authentication error is not retried', calls === 1 && e.status === 401); }

  calls = 0;
  const first = await withTransientRetry(async () => { calls++; return 'fine'; }, 'B2', quiet);
  check('a call that works first time is made exactly once (no extra cost)', first === 'fine' && calls === 1);

  calls = 0;
  const logs = [];
  await withTransientRetry(async () => { calls++; if (calls === 1) throw err('terminated'); return 1; }, 'Batch 2', { delayMs: 0, log: m => logs.push(m) });
  check('the log names the batch and says it retried', logs.some(l => /Batch 2/.test(l) && /retrying this batch once/.test(l)) && logs.some(l => /retry completed/.test(l)));

  const src = require('fs').readFileSync('./src/validator-tier2.js', 'utf8');
  check('the batch call is wrapped in the retry, per data chunk', /await withTransientRetry\(\(\) => runBatch\(\s*rules, dataChunks\[i\]/.test(src));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
