/**
 * Prompt caching for the Tier 2 reviewer, and the cost estimate printed in the log.
 *
 * A full-parse review sends the same workbook data (formulas, static text, named ranges, Tier 0 context) in every
 * batch; only the list of rules changes. The Fm-00037 run paid for that data four times, once of them to retry a
 * single skipped rule. Sending it as a cached prefix lets the later calls read it at about a tenth of the price.
 *
 * Calls run in parallel, and a cache entry only exists once the first call has started to answer, so the first call
 * goes alone and the rest wait at the gate until its first streamed event (or a timeout, or a failure).
 */
const fs = require('fs');
const path = require('path');

const COST_PATH = path.join(__dirname, '..', '..', 'config', 'cost.json');
const DEFAULTS = {
  promptCaching: { enabled: true, ttl: '1h', warmupWaitMs: 120000 },
  pricePerMillion: { input: 3, output: 15, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3 }
};

function loadCostConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(COST_PATH, 'utf8'));
    return {
      promptCaching: Object.assign({}, DEFAULTS.promptCaching, c.promptCaching || {}),
      pricePerMillion: Object.assign({}, DEFAULTS.pricePerMillion, c.pricePerMillion || {})
    };
  } catch (_) { return DEFAULTS; }
}

function createCacheGate(waitMs = 120000) {
  let claimed = false;
  let release;
  const ready = new Promise(r => { release = r; });
  let timer = null;
  return {
    // Resolves true for the one call that goes first, false for the rest once the cache is warm (or the wait ran out).
    async enter() {
      if (!claimed) {
        claimed = true;
        timer = setTimeout(release, waitMs);
        if (timer.unref) timer.unref();
        return true;
      }
      await ready;
      return false;
    },
    open() { if (timer) clearTimeout(timer); release(); }
  };
}

function createUsage() { return { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }; }

function addUsage(total, u) {
  if (!total || !u) return;
  total.calls += 1;
  total.input += u.input_tokens || 0;
  total.output += u.output_tokens || 0;
  total.cacheWrite += u.cache_creation_input_tokens || 0;
  total.cacheRead += u.cache_read_input_tokens || 0;
}

function estimateCost(total, cfg = loadCostConfig()) {
  const p = cfg.pricePerMillion;
  const writeRate = cfg.promptCaching.ttl === '5m' ? p.cacheWrite5m : p.cacheWrite1h;
  const usd = (total.input * p.input + total.output * p.output + total.cacheWrite * writeRate + total.cacheRead * p.cacheRead) / 1e6;
  return Math.round(usd * 100) / 100;
}

// The API rejected the cache setting itself (older API behaviour, an unsupported ttl): worth repeating without it.
function isCacheRejection(err) {
  const msg = String((err && err.message) || '');
  return !!err && (err.status === 400 || /invalid_request/i.test(msg)) && /cache|ttl/i.test(msg);
}

module.exports = { loadCostConfig, createCacheGate, createUsage, addUsage, estimateCost, isCacheRejection };
