// data-chunker.js - splits a full-parse payload (sheet name -> formula lines + static text) into data chunks that each
// fit one request, for models too big for the single-request full-parse route.
//
// Why this exists: the full-parse route gives the reviewer the model's formulas and wording, which is what lets it
// check formula LOGIC. Above the single-request limit the platform fell back to the curated route (extracted values
// and partial formulas), which is weaker (GT1, Fm-00041: 50% completion against 77% on models that fit). Chunking keeps
// the full-parse view for those models by reviewing the workbook in several pieces.
//
// What a chunk is: whole sheets, grouped so sheets that reference each other travel together (a review of a sheet
// that reads another is only as good as its view of that other sheet). A sheet that is too big for one chunk is cut
// at row boundaries, formula lines and static text lines together, so a label stays next to the formula it labels.
//
// Pure functions: no I/O apart from loading the config file.
'use strict';
const fs = require('fs');
const path = require('path');

const TEXT_MARKER = '# STATIC TEXT CELLS';
const DEFAULTS = {
  enabled: true, maxChunks: 4, contextWindowTokens: 1000000, outputReserveTokens: 128000, requestOverheadTokens: 70000,
  safetyMargin: 0.05, systemCharsPerToken: 2.9, formulaCharsPerToken: 1.15, textCharsPerToken: 2.4, systemCacheTtl: '1h',
  skipRulesAlreadyRaised: true, maxEstimatedCostUsd: 25, outputTokensPerRule: 1550, capacityOverrideTokens: null
};

function loadChunkingConfig(file = path.join(__dirname, '..', '..', 'config', 'chunking.json')) {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (_) { return { ...DEFAULTS }; }
}

/** Tokens one chunk may carry: what the window leaves after the system prompt, reserved output and request overhead. */
function chunkCapacityTokens(cfg, systemPromptChars) {
  if (Number.isFinite(cfg.capacityOverrideTokens) && cfg.capacityOverrideTokens > 0) return Math.floor(cfg.capacityOverrideTokens);
  const systemTokens = Math.ceil((systemPromptChars || 0) / cfg.systemCharsPerToken);
  const room = cfg.contextWindowTokens - cfg.outputReserveTokens - cfg.requestOverheadTokens - systemTokens;
  return Math.max(0, Math.floor(room * (1 - cfg.safetyMargin)));
}

function lineTokens(line, isText, cfg) {
  return (line.length + 1) / (isText ? cfg.textCharsPerToken : cfg.formulaCharsPerToken);
}

/** Splits one sheet's payload text into its formula lines and its static-text lines. */
function parseSheetText(text) {
  const at = text.indexOf(TEXT_MARKER);
  const formulaPart = at < 0 ? text : text.slice(0, at);
  let textHeader = null, textLines = [];
  if (at >= 0) {
    const rest = text.slice(at);
    const nl = rest.indexOf('\n');
    textHeader = nl < 0 ? rest : rest.slice(0, nl);
    textLines = nl < 0 ? [] : rest.slice(nl + 1).split('\n').filter(l => l !== '');
  }
  return { formulaLines: formulaPart.split('\n').filter(l => l !== ''), textHeader, textLines };
}

function sheetTokens(text, cfg) {
  const p = parseSheetText(text);
  let t = 0;
  for (const l of p.formulaLines) t += lineTokens(l, false, cfg);
  for (const l of p.textLines) t += lineTokens(l, true, cfg);
  return Math.ceil(t);
}

/**
 * Cuts a sheet that is bigger than maxTokens into row ranges. Formula lines ("C12: =...") and text lines ("R12: ...")
 * are grouped by row number so the label stays with its formulas; a line that carries no row number joins the row
 * before it.
 * @returns {Array<{ name: string, text: string, tokens: number }>}
 */
function splitSheet(name, text, maxTokens, cfg) {
  const total = sheetTokens(text, cfg);
  if (total <= maxTokens) return [{ name, text, tokens: total }];
  const p = parseSheetText(text);
  const rows = new Map();
  let cur = 0;
  const rowOf = (line, isText) => {
    const m = isText ? /^R(\d+):/.exec(line) : /^[A-Z]{1,3}(\d+):/.exec(line);
    if (m) cur = parseInt(m[1], 10);
    if (!rows.has(cur)) rows.set(cur, { f: [], t: [], tokens: 0 });
    return rows.get(cur);
  };
  for (const l of p.formulaLines) { const r = rowOf(l, false); r.f.push(l); r.tokens += lineTokens(l, false, cfg); }
  cur = 0;
  for (const l of p.textLines) { const r = rowOf(l, true); r.t.push(l); r.tokens += lineTokens(l, true, cfg); }
  const rowNumbers = [...rows.keys()].sort((a, b) => a - b);
  const pieces = Math.ceil(total / maxTokens);
  const limit = Math.min(maxTokens, Math.ceil(total / pieces) * 1.05);
  // units: a row, or - when one row alone is a large share of a chunk (a sheet can have a row of thousands of cells) -
  // that row's cells one by one, in order
  const units = [];
  for (const rn of rowNumbers) {
    const r = rows.get(rn);
    if (r.tokens <= limit / 2) { units.push({ row: rn, f: r.f, t: r.t, tokens: r.tokens }); continue; }
    for (const l of r.f) units.push({ row: rn, f: [l], t: [], tokens: lineTokens(l, false, cfg) });
    for (const l of r.t) units.push({ row: rn, f: [], t: [l], tokens: lineTokens(l, true, cfg) });
  }
  const groups = [];
  let part = null;
  const flush = () => { if (part) groups.push(part); part = null; };
  for (const u of units) {
    if (part && part.tokens + u.tokens > limit) flush();
    if (!part) part = { f: [], t: [], tokens: 0, first: u.row, last: u.row };
    part.f.push(...u.f); part.t.push(...u.t); part.tokens += u.tokens; part.last = u.row;
  }
  flush();
  return groups.map((g, i) => {
    const body = g.f.join('\n');
    const labels = g.t.length ? (body ? '\n\n' : '') + (p.textHeader || TEXT_MARKER) + '\n' + g.t.join('\n') : '';
    const head = `# PART ${i + 1} OF ${groups.length} of sheet "${name}" (rows ${g.first}-${g.last}); the other parts are in other data chunks.\n`;
    return { name: `${name} [part ${i + 1}/${groups.length}]`, text: head + body + labels, tokens: Math.ceil(g.tokens) + 30 };
  });
}

/** Cross-sheet reference counts: weights.get(a).get(b) = number of formula references in sheet a to sheet b. */
function buildReferenceWeights(payload) {
  const names = new Set(Object.keys(payload));
  const re = /(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!/g;
  const weights = new Map();
  for (const [name, text] of Object.entries(payload)) {
    const at = text.indexOf(TEXT_MARKER);
    const formulas = at < 0 ? text : text.slice(0, at);
    const counts = new Map();
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(formulas))) {
      const target = (m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]);
      if (target !== name && names.has(target)) counts.set(target, (counts.get(target) || 0) + 1);
    }
    weights.set(name, counts);
  }
  return weights;
}

/**
 * Groups the sheets of a payload into chunks of at most `capacity` tokens.
 * Heavily linked sheets are merged first (heaviest link first, while the result still fits); what is left is packed
 * first-fit-decreasing, preferring the chunk it is most linked to.
 * @returns {{ capacity: number, totalTokens: number, chunks: Array<{ index: number, tokens: number, sheets: string[], payload: Object }> }}
 */
function planDataChunks(payload, capacity, cfg = DEFAULTS) {
  const weights = buildReferenceWeights(payload);
  const pairWeight = new Map();            // "a\u0000b" (a < b) -> references both ways
  const add = (a, b, w) => { const k = a < b ? a + '\u0000' + b : b + '\u0000' + a; pairWeight.set(k, (pairWeight.get(k) || 0) + w); };
  for (const [a, counts] of weights) for (const [b, w] of counts) add(a, b, w);
  const link = (a, b) => (a === b ? 0 : (pairWeight.get(a < b ? a + '\u0000' + b : b + '\u0000' + a) || 0));

  // items: whole sheets, or row-range parts of a sheet that is bigger than a chunk
  const items = [];
  let order = 0;
  for (const [name, text] of Object.entries(payload)) {
    for (const part of splitSheet(name, text, capacity, cfg)) items.push({ ...part, base: name, order: order++ });
  }
  const totalTokens = items.reduce((n, i) => n + i.tokens, 0);

  // 1. heavy-link merging
  let clusters = items.map((it, i) => ({ id: i, items: [it], tokens: it.tokens, bases: new Set([it.base]) }));
  const clusterLink = (A, B) => { let w = 0; for (const a of A.bases) for (const b of B.bases) w += link(a, b); return w; };
  for (;;) {
    let best = null;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        if (clusters[i].tokens + clusters[j].tokens > capacity) continue;
        const w = clusterLink(clusters[i], clusters[j]);
        if (w <= 0) continue;
        const size = clusters[i].tokens + clusters[j].tokens;
        if (!best || w > best.w || (w === best.w && size < best.size)) best = { i, j, w, size };
      }
    }
    if (!best) break;
    const A = clusters[best.i], B = clusters[best.j];
    A.items.push(...B.items); A.tokens += B.tokens; B.bases.forEach(x => A.bases.add(x));
    clusters.splice(best.j, 1);
  }

  // 2. first-fit-decreasing, preferring the bin the cluster is most linked to
  clusters.sort((a, b) => b.tokens - a.tokens || a.items[0].order - b.items[0].order);
  const bins = [];
  for (const c of clusters) {
    let pick = null;
    for (const bin of bins) {
      if (bin.tokens + c.tokens > capacity) continue;
      const w = clusterLink(bin, c);
      if (!pick || w > pick.w || (w === pick.w && bin.tokens > pick.bin.tokens)) pick = { bin, w };
    }
    if (pick) { pick.bin.items.push(...c.items); pick.bin.tokens += c.tokens; c.bases.forEach(x => pick.bin.bases.add(x)); }
    else bins.push({ items: [...c.items], tokens: c.tokens, bases: new Set(c.bases) });
  }

  // stable, readable order: chunks by their first sheet in the workbook, sheets inside a chunk in workbook order
  for (const b of bins) b.items.sort((x, y) => x.order - y.order);
  bins.sort((x, y) => x.items[0].order - y.items[0].order);
  const chunks = bins.map((b, i) => {
    const chunkPayload = {};
    for (const it of b.items) chunkPayload[it.name] = it.text;
    return { index: i + 1, tokens: b.tokens, sheets: b.items.map(it => it.name), payload: chunkPayload };
  });
  return { capacity, totalTokens, chunks };
}

/** What the reviewer is told about the chunk it holds and where everything else is. */
function describeChunk(plan, chunkIndex1) {
  const others = {};
  for (const c of plan.chunks) if (c.index !== chunkIndex1) others[`chunk ${c.index}`] = c.sheets;
  const mine = plan.chunks.find(c => c.index === chunkIndex1);
  return { index: chunkIndex1, of: plan.chunks.length, sheetsInThisChunk: mine ? mine.sheets : [], sheetsInOtherChunks: others };
}

/**
 * Estimated cost of a chunked review, from the plan and the rule count: one 1-hour system write, one data write per
 * chunk, cache reads for the other calls of that chunk, and output proportional to the rules asked. An upper-ish figure:
 * it does not credit the rules skipped in later chunks.
 */
function estimateChunkedCost(plan, { systemTokens, ruleCount, callsPerChunk }, cfg, prices) {
  const p = prices || { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 };
  const K = plan.chunks.length;
  const calls = K * callsPerChunk;
  const systemWrite = systemTokens * p.cacheWrite1h;
  const dataWrite = plan.chunks.reduce((n, c) => n + c.tokens, 0) * p.cacheWrite5m;
  const dataRead = plan.chunks.reduce((n, c) => n + c.tokens * Math.max(0, callsPerChunk - 1), 0) * p.cacheRead;
  const systemRead = systemTokens * Math.max(0, calls - 1) * p.cacheRead;
  const output = ruleCount * K * cfg.outputTokensPerRule * p.output;
  const usd = (systemWrite + dataWrite + dataRead + systemRead + output) / 1e6;
  return { usd: Math.round(usd * 100) / 100, calls, parts: { systemWrite: systemWrite / 1e6, dataWrite: dataWrite / 1e6, reads: (dataRead + systemRead) / 1e6, output: output / 1e6 } };
}

module.exports = { loadChunkingConfig, chunkCapacityTokens, sheetTokens, parseSheetText, splitSheet, buildReferenceWeights, planDataChunks, describeChunk, estimateChunkedCost, TEXT_MARKER, DEFAULTS };
