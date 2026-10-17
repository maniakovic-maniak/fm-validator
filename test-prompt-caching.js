#!/usr/bin/env node
// test-prompt-caching.js - proves the Tier 2 reviewer sends the workbook once as a cached prefix, that only the
// first call goes before the cache is warm, that a rejected cache setting falls back to a plain call, and that the
// cost line is computed from the usage the API reports. Uses a stand-in for the Anthropic SDK: no API calls, no cost.
'use strict';
const assert = require('assert');
const Module = require('module');
const path = require('path');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
}

// ---- stand-in SDK ---------------------------------------------------------------------------------------------
const calls = [];
let mode = 'normal';           // 'normal' | 'reject-cache'
const FAKE_RESULT = rules => JSON.stringify({ results: rules.map(r => ({ id: r.id, status: 'pass', confidence: 90, priority: 'P3', sheet: 'Calc', cell: 'C2', condition: 'ok' })) });
class FakeAnthropic {
  constructor() {
    this.messages = {
      stream: async params => {
        const rec = { startedAt: Date.now(), params, cached: false, firstEventAt: null };
        calls.push(rec);
        const blocks = Array.isArray(params.messages[0].content) ? params.messages[0].content : null;
        rec.cached = !!(blocks && blocks.some(b => b.cache_control));
        if (mode === 'reject-cache' && rec.cached) { const e = new Error('400 invalid_request_error: cache_control.ttl is not supported'); e.status = 400; throw e; }
        const text = blocks ? blocks[blocks.length - 1].text : params.messages[0].content;
        const ruleIds = [...text.matchAll(/"id":"(T2-[A-Z0-9-]+)"/g)].map(m => ({ id: m[1] }));
        const idx = calls.length;
        const usage = rec.cached
          ? (idx === 1 ? { input_tokens: 40, output_tokens: 1000, cache_creation_input_tokens: 300000, cache_read_input_tokens: 0 }
                       : { input_tokens: 40, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 300000 })
          : { input_tokens: 300040, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
        const events = [{ type: 'message_start' }, { type: 'content_block_start' },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: FAKE_RESULT(ruleIds) } }];
        return {
          async *[Symbol.asyncIterator]() {
            for (const ev of events) {
              await new Promise(r => setTimeout(r, 30));
              if (ev.type === 'content_block_start') rec.firstEventAt = Date.now();
              yield ev;
            }
          },
          async finalMessage() { return { stop_reason: 'end_turn', usage }; }
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
const pc = require('./src/utils/prompt-cache');

function workbook() {
  const wb = new ExcelJS.Workbook();
  const calc = wb.addWorksheet('Calc');
  calc.getCell('A2').value = 'Receivables'; calc.getCell('B2').value = 100; calc.getCell('C2').value = { formula: 'B2*1.1' };
  const cover = wb.addWorksheet('Cover'); cover.getCell('A1').value = 'Purpose of the model';
  return wb;
}
function parsedFrom(wb) {
  const sheets = {}; wb.eachSheet(ws => { sheets[ws.name] = []; });
  return { sheetNames: wb.worksheets.map(w => w.name), sheets, _raw: wb, fileName: 'x.xlsx' };
}
async function review() {
  calls.length = 0;
  const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  try {
    const res = await runTier2(parsedFrom(workbook()), { useFullParse: true, domain: '', domainFile: 'skill-generic.md', tier0Stats: {}, tier0Risks: {} });
    return { res, logs };
  } finally { console.log = origLoad === null ? origLog : origLog; }
}

(async () => {
  console.log('Prompt caching');
  let out;
  await test('the review makes several calls, and all of them carry the workbook as a cached prefix', async () => {
    out = await review();
    assert.ok(calls.length >= 3, `expected 3+ batch calls, got ${calls.length}`);
    assert.ok(calls.every(c => c.cached), 'every call should use the cached layout');
  });
  await test('the cached block is byte-identical in every call, and holds the data but not the rules', async () => {
    const first = calls[0].params.messages[0].content[0].text;
    for (const c of calls) assert.strictEqual(c.params.messages[0].content[0].text, first);
    assert.ok(first.includes('Receivables') && first.includes('"dataCoverage"') && !first.includes('"rules"'));
    assert.ok(calls.every(c => c.params.messages[0].content[1].text.includes('"rules"')));
  });
  await test('only the first call goes before the cache is warm; the rest start after its first content event', async () => {
    const sorted = [...calls].sort((a, b) => a.startedAt - b.startedAt);
    assert.ok(sorted[0].firstEventAt, 'first call never produced content');
    for (const c of sorted.slice(1)) assert.ok(c.startedAt >= sorted[0].firstEventAt, 'a later call started before the cache was warm');
  });
  await test('the cache setting is 5m by default', () => {
    assert.strictEqual(calls[0].params.messages[0].content[0].cache_control.ttl, '5m');
  });
  await test('a cache setting the API rejects is repeated as one plain call and the review still completes', async () => {
    mode = 'reject-cache';
    const r = await review();
    mode = 'normal';
    assert.ok(r.res.length > 0 && !r.res.some(x => x.id === 'T2-ERROR'), 'review should complete');
    assert.ok(calls.some(c => !c.cached), 'a plain call should follow the rejected one');
  });
  await test('the log carries a cost estimate built from the usage the API reported', () => {
    const line = out.logs.find(l => l.includes('Tier 2 API usage'));
    assert.ok(line && /cache-write/.test(line) && /\$\d+\.\d\d/.test(line), line);
  });
  await test('cost arithmetic: a cached review costs less than the same review uncached', () => {
    const cfg = pc.loadCostConfig();
    const plain = pc.createUsage(); for (let i = 0; i < 4; i++) pc.addUsage(plain, { input_tokens: 385000, output_tokens: 50000 });
    const cached = pc.createUsage();
    pc.addUsage(cached, { input_tokens: 40, output_tokens: 50000, cache_creation_input_tokens: 385000 });
    for (let i = 0; i < 3; i++) pc.addUsage(cached, { input_tokens: 40, output_tokens: 50000, cache_read_input_tokens: 385000 });
    assert.ok(pc.estimateCost(cached, cfg) < pc.estimateCost(plain, cfg) - 1, `${pc.estimateCost(cached, cfg)} vs ${pc.estimateCost(plain, cfg)}`);
  });
  await test('gate: second caller waits for open(), a timeout also releases it, a failed first call does not hang it', async () => {
    const g = pc.createCacheGate(60000);
    assert.strictEqual(await g.enter(), true);
    let released = false; const p = g.enter().then(v => { released = true; return v; });
    await new Promise(r => setTimeout(r, 20)); assert.strictEqual(released, false);
    g.open(); assert.strictEqual(await p, false);
    const keep = setInterval(() => {}, 10); // the gate's own timer is unref'd (real runs have the API call keeping the loop alive)
    const g2 = pc.createCacheGate(30); await g2.enter();
    const t0 = Date.now(); await g2.enter(); assert.ok(Date.now() - t0 < 500); clearInterval(keep);
  });
  await test('isCacheRejection only matches cache-related 400s', () => {
    assert.ok(pc.isCacheRejection(Object.assign(new Error('invalid_request: cache_control ttl'), { status: 400 })));
    assert.ok(!pc.isCacheRejection(Object.assign(new Error('overloaded'), { status: 529 })));
    assert.ok(!pc.isCacheRejection(Object.assign(new Error('invalid_request: max_tokens too large'), { status: 400 })));
  });
  console.log(`\n${passed} check(s) passed${process.exitCode ? ' - WITH FAILURES' : ''}`);
})();
