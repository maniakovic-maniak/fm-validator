#!/usr/bin/env node
// test-chunked-fullparse.js - proves a model too big for one request is reviewed in data chunks through runTier2:
// the chunks hold disjoint sheets and are reviewed one after another, only the first call of a chunk goes before its
// cache is warm, the system prompt is cached for an hour, rules an earlier chunk raised are not asked again, answers are
// merged (issue > pass > uncertain), a failed call in one chunk does not fail a rule another chunk answered, and a plan
// above the cost limit falls back to the curated route. Uses a stand-in for the Anthropic SDK: no API calls, no cost.
'use strict';
const assert = require('assert');
const Module = require('module');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// ---- stand-in SDK ---------------------------------------------------------------------------------------------
let calls = [];
let scenario = {};
let raisedId = null;
const result = (id, status) => ({ id, status, confidence: 90, priority: status === 'P1' ? 'P1' : 'P3', sheet: 'Rev', cell: 'B2', condition: status === 'pass' ? 'ok' : 'a problem', reason: 'r' });
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: async params => {
        const content = params.messages[0].content;
        const blocks = Array.isArray(content) ? content : null;
        const rec = { startedAt: Date.now(), endedAt: null, firstEventAt: null, params, cached: !!(blocks && blocks.some(b => b.cache_control)), chunk: null, dataKeys: null, payload: null, ruleIds: [] };
        calls.push(rec);
        if (blocks) {
          const dataText = blocks[0].text;
          rec.payload = JSON.parse(dataText.slice(dataText.indexOf('\n') + 1));
          rec.chunk = rec.payload.dataChunk ? rec.payload.dataChunk.index : null;
          rec.dataKeys = Object.keys(rec.payload.data || {});
        }
        const rulesText = blocks ? blocks[blocks.length - 1].text : content;
        rec.ruleIds = [...rulesText.matchAll(/"id":"(T2-[A-Z0-9-]+)"/g)].map(m => m[1]);
        if (scenario.rejectLongTtl && params.system[0].cache_control && params.system[0].cache_control.ttl) {
          rec.rejected = true; rec.endedAt = Date.now();
          const e = new Error('400 invalid_request_error: cache_control.ttl 1h is not supported'); e.status = 400; throw e;
        }
        if (scenario.failWhen && scenario.failWhen(rec)) throw new Error('simulated API failure');
        const first = rec.chunk === 1 || rec.chunk === null;
        if (raisedId === null && rec.ruleIds.length) raisedId = rec.ruleIds[0];
        const out = rec.ruleIds.map(id => result(id, first ? (id === raisedId ? 'P1' : 'uncertain') : 'pass'));
        const usage = { input_tokens: 40, output_tokens: 1000, cache_creation_input_tokens: rec.cached ? 1000 : 0, cache_read_input_tokens: 0 };
        const events = [{ type: 'message_start' }, { type: 'content_block_start', content_block: { type: 'text' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify({ results: out }) } }];
        return {
          async *[Symbol.asyncIterator]() {
            for (const ev of events) {
              await new Promise(r => setTimeout(r, 25));
              if (ev.type === 'content_block_start') rec.firstEventAt = Date.now();
              yield ev;
            }
          },
          async finalMessage() { rec.endedAt = Date.now(); return { stop_reason: 'end_turn', usage }; }
        };
      }
    };
  }
}
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === '@anthropic-ai/sdk' ? FakeAnthropic : origLoad.call(this, request, ...rest); };
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key';

const ExcelJS = require('exceljs');
const { runTier2 } = require('./src/validator-tier2');
const dc = require('./src/utils/data-chunker');
const fp = require('./src/validator-tier2-fullparse');

const NAMES = ['Rev', 'Cost', 'Debt', 'Tax', 'Cash'];
function workbook() {
  const wb = new ExcelJS.Workbook();
  const cover = wb.addWorksheet('Cover'); cover.getCell('A1').value = 'Purpose of the model';
  NAMES.forEach((n, i) => {
    const ws = wb.addWorksheet(n);
    const ref = NAMES[(i + 1) % 2 === 1 && i % 2 === 0 ? i + 1 : i - 1] || NAMES[0];   // Rev<->Cost, Debt<->Tax, Cash->Rev
    for (let r = 1; r <= 200; r++) { ws.getCell(`A${r}`).value = `Line ${r}`; ws.getCell(`B${r}`).value = { formula: `${ref}!B${r}*1.05+SUM(B1:B${r})` }; }
  });
  return wb;
}
const parsedFrom = wb => { const sheets = {}; wb.eachSheet(ws => { sheets[ws.name] = []; }); return { sheetNames: wb.worksheets.map(w => w.name), sheets, _raw: wb, fileName: 'x.xlsx' }; };
// each big sheet is ~6,500 tokens: a capacity of 15,000 holds two of them
const CAP = 15000;
const SIZE = (() => { const b = fp.buildFullParsePayloadWithText(workbook()); return Object.values(b.payload).reduce((n, t) => n + dc.sheetTokens(t, dc.loadChunkingConfig()), 0); })();

async function review(opts = {}) {
  calls = []; raisedId = null;
  const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const res = await runTier2(parsedFrom(workbook()), {
      useFullParse: false, domain: '', domainFile: 'skill-generic.md', tier0Stats: {}, tier0Risks: {},
      routeEstimateTokens: SIZE, chunkingOverride: { capacityOverrideTokens: CAP, maxEstimatedCostUsd: 1e6 }, ...opts
    });
    return { res, logs };
  } finally { console.log = orig; }
}

(async () => {
  console.log('Chunked full-parse');
  console.log(`  (test workbook ~${SIZE.toLocaleString()} tokens, chunk capacity ${CAP.toLocaleString()})`);
  let out;
  await test('a model too big for one request is reviewed in several data chunks holding disjoint sheets', async () => {
    out = await review();
    const chunks = [...new Set(calls.map(c => c.chunk))].sort();
    assert.ok(chunks.length >= 3 && chunks.every(c => c !== null), `chunks seen: ${chunks}`);
    const seen = new Set();
    for (const k of chunks) {
      const keys = calls.filter(c => c.chunk === k)[0].dataKeys;
      for (const key of keys) { assert.ok(!seen.has(key), `${key} in two chunks`); seen.add(key); }
      for (const c of calls.filter(c => c.chunk === k)) assert.deepStrictEqual(c.dataKeys, keys, 'every call of a chunk holds the same sheets');
    }
    assert.deepStrictEqual([...seen].sort(), ['Cash', 'Cost', 'Cover', 'Debt', 'Rev', 'Tax']);
  });
  await test('linked sheets are in the same chunk, and each call is told which chunk it holds and what coverage that is', async () => {
    const chunkOf = n => calls.find(c => c.dataKeys.includes(n)).chunk;
    assert.strictEqual(chunkOf('Rev'), chunkOf('Cost'));
    assert.strictEqual(chunkOf('Debt'), chunkOf('Tax'));
    for (const c of calls) {
      assert.strictEqual(c.payload.dataCoverage, 'partial_view');
      assert.strictEqual(c.payload.dataChunk.of, new Set(calls.map(x => x.chunk)).size);
      assert.deepStrictEqual(c.payload.dataChunk.sheetsInThisChunk, c.dataKeys);
      assert.ok(Object.keys(c.payload.dataChunk.sheetsInOtherChunks).length === c.payload.dataChunk.of - 1);
    }
  });
  await test('chunks run one after another; inside a chunk only the first call goes before the cache is warm', async () => {
    const ks = [...new Set(calls.map(c => c.chunk))].sort();
    for (let i = 1; i < ks.length; i++) {
      const prevEnd = Math.max(...calls.filter(c => c.chunk === ks[i - 1]).map(c => c.endedAt));
      const nextStart = Math.min(...calls.filter(c => c.chunk === ks[i]).map(c => c.startedAt));
      assert.ok(nextStart >= prevEnd, `chunk ${ks[i]} started before chunk ${ks[i - 1]} finished`);
    }
    for (const k of ks) {
      const cs = calls.filter(c => c.chunk === k).sort((a, b) => a.startedAt - b.startedAt);
      assert.ok(cs.length >= 2);
      for (const c of cs.slice(1)) assert.ok(c.startedAt >= cs[0].firstEventAt, `chunk ${k}: a later call started before the first one began to answer`);
    }
  });
  await test('the system prompt is cached for an hour, the chunk data for the default time, and the prompt explains chunked review', async () => {
    for (const c of calls) {
      assert.strictEqual(c.params.system[0].cache_control.ttl, '1h');
      assert.ok(c.params.system[0].text.includes('CHUNKED REVIEW'));
      assert.ok(c.params.system[0].text.includes('IMPORTANT DIFFERENCE FROM YOUR USUAL DATA'));
      assert.strictEqual(c.params.messages[0].content[0].cache_control.ttl, '5m');
    }
  });
  await test('a rule an earlier chunk raised is not asked again, and the merged answer keeps the issue; the rest merge to pass', async () => {
    assert.ok(raisedId);
    const later = calls.filter(c => c.chunk > 1);
    assert.ok(later.length > 0);
    for (const c of later) assert.ok(!c.ruleIds.includes(raisedId), `${raisedId} asked again in chunk ${c.chunk}`);
    const byId = new Map(out.res.map(r => [r.id, r]));
    assert.strictEqual(byId.get(raisedId).status, 'P1');
    const others = out.res.filter(r => r.id !== raisedId && !/-ERROR$/.test(r.id));
    assert.ok(others.length > 20);
    assert.ok(others.every(r => r.status === 'pass'), 'pass beats uncertain across chunks');
    assert.strictEqual(new Set(out.res.map(r => r.id)).size, out.res.length, 'one answer per rule');
  });
  await test('the log names the plan, each chunk, and the estimated cost; the absence policy stays off', async () => {
    const plan = out.logs.find(l => l.includes('Chunked full-parse plan:'));
    assert.ok(plan && /\d+ data chunk/.test(plan) && /estimated cost about \$/.test(plan), plan);
    assert.ok(out.logs.some(l => /Data chunk 1\/\d+:/.test(l)));
    assert.ok(!out.logs.some(l => l.includes('Absence policy:')));
  });
  await test('a model the router already sent to full-parse is chunked too when it would overflow one request', async () => {
    const r = await review({ useFullParse: true });
    assert.ok(calls.every(c => c.chunk !== null), 'every call carries a chunk');
    assert.ok(r.logs.some(l => l.includes('does not fit one request')));
  });
  await test('a model that fits one request is not chunked', async () => {
    await review({ useFullParse: true, chunkingOverride: { capacityOverrideTokens: SIZE * 3, maxEstimatedCostUsd: 1e6 } });
    assert.ok(calls.length >= 3 && calls.every(c => c.chunk === null && !c.payload.dataChunk));
    assert.ok(calls.every(c => c.params.system[0].cache_control.ttl === undefined));
  });
  await test('a failed call in one chunk does not fail a rule another chunk answered', async () => {
    scenario = { failWhen: c => c.chunk === 2 && c.ruleIds.length && c.ruleIds[0].includes('-S1-') };
    try {
      const r = await review();
      assert.ok(calls.some(c => c.chunk === 2 && c.ruleIds[0] && c.ruleIds[0].includes('-S1-')), 'the failing call happened');
      const s1 = r.res.filter(x => x.id.includes('-S1-') && !/-ERROR$/.test(x.id));
      assert.ok(s1.length > 0 && s1.every(x => x.status === 'pass' || x.status === 'P1'), 'structure rules still answered');
      assert.ok(!r.res._batchFailures || r.res._batchFailures.every(f => !f.ruleIds.some(id => id.includes('-S1-'))), 'no failure recorded for rules another chunk answered');
    } finally { scenario = {}; }
  });
  await test('if the API refuses the 1-hour system lifetime, the review repeats with the default once and keeps the data cached', async () => {
    scenario = { rejectLongTtl: true };
    try {
      const r = await review();
      const rejected = calls.filter(c => c.rejected);
      assert.strictEqual(rejected.length, 1, `rejected attempts: ${rejected.length}`);
      const good = calls.filter(c => !c.rejected);
      assert.ok(good.length >= 9 && good.every(c => c.cached && c.params.system[0].cache_control.ttl === undefined), 'later calls use the default lifetime and keep the data cached');
      assert.ok(r.res.filter(x => !/-ERROR$/.test(x.id)).length > 20, 'the review still completes');
      assert.ok(r.logs.some(l => l.includes('rejected the longer cache lifetime')));
    } finally { scenario = {}; }
  });
  await test('a plan above the cost limit is not used: the curated route runs instead', async () => {
    const r = await review({ useFullParse: true, chunkingOverride: { capacityOverrideTokens: CAP, maxEstimatedCostUsd: 0.0001 } });
    assert.ok(calls.length >= 3 && calls.every(c => c.chunk === null && !c.cached), 'plain curated calls: no chunk, no cached data block');
    assert.ok(r.logs.some(l => l.includes('not used - the estimated cost is above the limit')));
    assert.ok(r.logs.some(l => l.includes('curated route instead')));
    assert.ok(!calls.some(c => c.params.system[0].text.includes('IMPORTANT DIFFERENCE FROM YOUR USUAL DATA')), 'the curated route is not told it has the full formula list');
  });
  await test('switched off in config: nothing is chunked', async () => {
    await review({ chunkingOverride: { enabled: false } });
    assert.ok(calls.every(c => c.chunk === null));
  });
  await test('a small model sent to the curated route stays there', async () => {
    await review({ routeEstimateTokens: 100, chunkingOverride: { capacityOverrideTokens: CAP } });
    assert.ok(calls.every(c => c.chunk === null));
  });
  console.log(`\n${passed} check(s) passed${process.exitCode ? ' - WITH FAILURES' : ''}`);
})();
