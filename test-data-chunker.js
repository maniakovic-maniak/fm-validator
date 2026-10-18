#!/usr/bin/env node
// test-data-chunker.js - proves the data chunker splits a full-parse payload into chunks that fit, keeps linked sheets
// together, cuts an oversized sheet (and an oversized row) without losing or duplicating a line, and prices the plan.
// Pure functions: no API calls, no cost.
'use strict';
const assert = require('assert');
const dc = require('./src/utils/data-chunker');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}
const cfg = dc.loadChunkingConfig();

// a sheet of `rows` rows, `cols` formula cells per row, each referencing `ref`; plus one label per row
function sheet(rows, cols, ref, label = 'Item') {
  const f = [], t = [];
  for (let r = 1; r <= rows; r++) {
    for (let c = 0; c < cols; c++) f.push(`${String.fromCharCode(66 + c)}${r}: =${ref ? ref + '!' : ''}${String.fromCharCode(66 + c)}${r}*1.05+SUM(${String.fromCharCode(66 + c)}1:${String.fromCharCode(66 + c)}${r})`);
    t.push(`R${r}: A=${label} ${r}`);
  }
  return f.join('\n') + '\n\n# STATIC TEXT CELLS (labels, headings, notes; not formulas):\n' + t.join('\n');
}
const contentLines = payload => Object.values(payload).flatMap(t => t.split('\n')).filter(l => l && !l.startsWith('# STATIC') && !l.startsWith('# PART')).sort();

console.log('Capacity');
test('capacity is what the window leaves after the system prompt, the output reserve and the overhead', () => {
  const infra = dc.chunkCapacityTokens(cfg, 792000);          // the infrastructure prompt: 267k tokens
  const corp = dc.chunkCapacityTokens(cfg, 177000);           // the corporate prompt: ~60k tokens
  assert.ok(infra > 480000 && infra < 530000, String(infra));
  assert.ok(corp > 680000 && corp < 740000, String(corp));
  assert.ok(corp > infra);
  assert.strictEqual(dc.chunkCapacityTokens({ ...cfg, capacityOverrideTokens: 1234 }, 792000), 1234);
  assert.strictEqual(dc.chunkCapacityTokens({ ...cfg, systemCharsPerToken: 1, contextWindowTokens: 1000 }, 792000), 0);   // never negative
});

console.log('Splitting one sheet');
test('a sheet that fits is returned whole', () => {
  const t = sheet(5, 3, 'Input');
  const parts = dc.splitSheet('Calc', t, 100000, cfg);
  assert.strictEqual(parts.length, 1);
  assert.strictEqual(parts[0].name, 'Calc');
  assert.strictEqual(parts[0].text, t);
});
test('a big sheet is cut at row boundaries: every part fits, nothing is lost or repeated, labels stay with their rows', () => {
  const t = sheet(400, 6, 'Input');
  const total = dc.sheetTokens(t, cfg);
  const max = Math.ceil(total / 3.2);
  const parts = dc.splitSheet('Calc', t, max, cfg);
  assert.ok(parts.length >= 4, `expected 4+ parts, got ${parts.length}`);
  for (const p of parts) assert.ok(p.tokens <= max + 60, `${p.name} has ${p.tokens} > ${max}`);
  assert.deepStrictEqual(contentLines({ a: parts.map(p => p.text).join('\n') }), contentLines({ a: t }));
  assert.ok(/\[part 1\/\d+\]$/.test(parts[0].name));
  for (const p of parts) {                                    // the row a label belongs to is in the same part as its formulas
    const labelRows = [...p.text.matchAll(/^R(\d+):/gm)].map(m => +m[1]);
    const formulaRows = new Set([...p.text.matchAll(/^[A-Z]+(\d+): =/gm)].map(m => +m[1]));
    for (const r of labelRows) assert.ok(formulaRows.has(r), `label row ${r} separated from its formulas`);
  }
  assert.ok(/^# PART 1 OF \d+ of sheet "Calc" \(rows 1-\d+\)/.test(parts[0].text));
});
test('one huge row (thousands of cells) is cut by cells, not left as a single oversized piece', () => {
  const col = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const f = [];
  for (let c = 0; c < 6000; c++) f.push(`${col(c)}111: =Input!${col(c)}1*2+Input!${col(c)}2`);   // every cell on row 111
  f.push('A2: =Input!A1'); f.push('A3: =Input!A2');
  const t = f.join('\n');
  const total = dc.sheetTokens(t, cfg);
  const max = Math.ceil(total / 3);
  const parts = dc.splitSheet('Wide', t, max, cfg);
  assert.ok(parts.length >= 3, String(parts.length));
  assert.ok(f.filter(l => /^[A-Z]+111:/.test(l)).length === 6000, 'the test row really is one row');
  for (const p of parts) assert.ok(p.tokens <= max + 60, `${p.name} has ${p.tokens} > ${max}`);
  assert.deepStrictEqual(contentLines({ a: parts.map(p => p.text).join('\n') }), contentLines({ a: t }));
});
test('a text-only sheet (no formulas) is handled', () => {
  const rows = []; for (let r = 1; r <= 300; r++) rows.push(`R${r}: A=Note ${r} ${'x'.repeat(80)}`);
  const t = '# STATIC TEXT CELLS (labels, headings, notes; not formulas):\n' + rows.join('\n');
  const parts = dc.splitSheet('Notes', t, Math.ceil(dc.sheetTokens(t, cfg) / 2.5), cfg);
  assert.ok(parts.length >= 2);
  assert.deepStrictEqual(contentLines({ a: parts.map(p => p.text).join('\n') }), contentLines({ a: t }));
});

console.log('Reference graph');
test('references are counted by sheet, quoted and unquoted names, escaped apostrophes; self and unknown sheets are ignored', () => {
  const payload = {
    A: "B1: =Input!A1+Input!A2\nB2: ='Tax Pools'!C3\nB3: =A!B1\nB4: =[1]External!A1\nB5: =Nowhere!A1",
    Input: "A1: =1+1",
    'Tax Pools': "C3: =A!B1",
    "Bob's": "A1: =1",
    Z: "A1: ='Bob''s'!A1+'Bob''s'!A2\n\n# STATIC TEXT CELLS (labels):\nR1: A=Input!A1 is only a label",
  };
  const w = dc.buildReferenceWeights(payload);
  assert.strictEqual(w.get('A').get('Input'), 2);
  assert.strictEqual(w.get('A').get('Tax Pools'), 1);
  assert.ok(!w.get('A').has('A') && !w.get('A').has('External') && !w.get('A').has('Nowhere'));
  assert.strictEqual(w.get('Tax Pools').get('A'), 1);
  assert.strictEqual(w.get('Z').get("Bob's"), 2);
  assert.ok(!w.get('Z').has('Input'), 'a label that mentions a sheet is not a reference');
});

console.log('Planning');
test('every chunk fits, no line is lost or repeated, and the plan is the same every time', () => {
  const payload = {}; for (let i = 1; i <= 9; i++) payload['S' + i] = sheet(60 + i * 5, 4, i > 1 ? 'S' + (i - 1) : '');
  const total = Object.values(payload).reduce((n, t) => n + dc.sheetTokens(t, cfg), 0);
  const cap = Math.ceil(total / 3.3);
  const plan = dc.planDataChunks(payload, cap, cfg);
  assert.ok(plan.chunks.length >= 4 && plan.chunks.length <= 5, String(plan.chunks.length));
  for (const c of plan.chunks) assert.ok(c.tokens <= cap, `chunk ${c.index}: ${c.tokens} > ${cap}`);
  const all = {}; plan.chunks.forEach(c => Object.entries(c.payload).forEach(([k, v]) => { assert.ok(!(k in all), 'sheet in two chunks'); all[k] = v; }));
  assert.deepStrictEqual(contentLines(all), contentLines(payload));
  assert.deepStrictEqual(dc.planDataChunks(payload, cap, cfg).chunks.map(c => c.sheets), plan.chunks.map(c => c.sheets));
});
test('sheets that reference each other travel together, whatever order they sit in', () => {
  const payload = {
    Rev: sheet(80, 4, 'Cost'), Debt: sheet(80, 4, 'Tax'), Cost: sheet(80, 4, ''), Tax: sheet(80, 4, ''),
    Cover: sheet(2, 1, ''),
  };
  const one = dc.sheetTokens(payload.Rev, cfg);
  const plan = dc.planDataChunks(payload, one * 2 + 200, cfg);          // room for two big sheets per chunk
  const chunkOf = n => plan.chunks.find(c => c.sheets.includes(n)).index;
  assert.strictEqual(chunkOf('Rev'), chunkOf('Cost'));
  assert.strictEqual(chunkOf('Debt'), chunkOf('Tax'));
  assert.notStrictEqual(chunkOf('Rev'), chunkOf('Debt'));
});
test('a sheet bigger than a chunk is cut, and its parts are placed in chunks like any other sheet', () => {
  const payload = { Small: sheet(20, 3, ''), Big: sheet(500, 6, 'Small') };
  const cap = Math.ceil(dc.sheetTokens(payload.Big, cfg) / 2.2);
  const plan = dc.planDataChunks(payload, cap, cfg);
  const names = plan.chunks.flatMap(c => c.sheets);
  assert.ok(names.filter(n => n.startsWith('Big [part')).length >= 3, names.join(','));
  for (const c of plan.chunks) assert.ok(c.tokens <= cap);
});
test('describeChunk says which chunk this is and where the other sheets are', () => {
  const payload = { A: sheet(80, 4, ''), B: sheet(80, 4, ''), C: sheet(80, 4, '') };
  const plan = dc.planDataChunks(payload, dc.sheetTokens(payload.A, cfg) + 50, cfg);
  assert.strictEqual(plan.chunks.length, 3);
  const d = dc.describeChunk(plan, 2);
  assert.strictEqual(d.index, 2); assert.strictEqual(d.of, 3);
  assert.deepStrictEqual(d.sheetsInThisChunk, plan.chunks[1].sheets);
  assert.deepStrictEqual(Object.keys(d.sheetsInOtherChunks), ['chunk 1', 'chunk 3']);
});

console.log('Cost');
test('the estimate counts one system write, a data write per chunk, reads for the other calls, and output per rule per chunk', () => {
  const plan = { chunks: [{ tokens: 400000 }, { tokens: 400000 }, { tokens: 400000 }] };
  const prices = { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 };
  const c = dc.estimateChunkedCost(plan, { systemTokens: 270000, ruleCount: 130, callsPerChunk: 4 }, cfg, prices);
  const expected = (270000 * 6 + 1200000 * 3.75 + 1200000 * 3 * 0.3 + 270000 * 11 * 0.3 + 130 * 3 * cfg.outputTokensPerRule * 15) / 1e6;
  assert.ok(Math.abs(c.usd - expected) < 0.01, `${c.usd} vs ${expected}`);
  assert.strictEqual(c.calls, 12);
  const two = dc.estimateChunkedCost({ chunks: plan.chunks.slice(0, 2) }, { systemTokens: 270000, ruleCount: 130, callsPerChunk: 4 }, cfg, prices);
  assert.ok(two.usd < c.usd);
});
test('the shipped config is valid and conservative', () => {
  assert.strictEqual(typeof cfg.enabled, 'boolean');
  assert.ok(cfg.maxChunks >= 2 && cfg.maxChunks <= 8);
  assert.ok(cfg.contextWindowTokens - cfg.outputReserveTokens - cfg.requestOverheadTokens > 400000);
  assert.ok(cfg.safetyMargin >= 0.03 && cfg.safetyMargin < 0.3);
  assert.ok(cfg.maxEstimatedCostUsd > 0);
  assert.strictEqual(cfg.systemCacheTtl, '1h');
});

console.log(`\n${passed} check(s) passed${process.exitCode ? ' - WITH FAILURES' : ''}`);
