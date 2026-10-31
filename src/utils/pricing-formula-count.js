'use strict';
// pricing-formula-count.js - Patch 50. The unique-formula count that prices a quote.
//
// This count is deliberately independent of the formula-family identity the audit uses (normalizeFormula in validator-tier0.js).
// The audit's families are exact (R1C1 offsets, anchors, constants), and may be refined again. A quote must not move when
// the audit's identity changes: Patch 30 made the families exact and the same ESO model went from 311 to 757 unique formulas,
// raising its price 2.4 times with no change to the model.
//
// The key below is FROZEN. Every cell address becomes the word CELL, whitespace is collapsed, case is folded. It reproduces
// the counts quoted before Patch 30 (ESO: 311 unique, 293 Low / 17 Moderate / 1 High). Do not "improve" it. A change to how
// quotes are counted is a pricing decision, and needs a new, named version, not an edit.
const KEY_VERSION = 'pricing-key-v1';

function pricingKey(formula) {
  return String(formula)
    .replace(/\$?[A-Z]{1,3}\$?[0-9]{1,7}/g, 'CELL')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

class PricingCounter {
  // bandOf(formula) is called once per new key, on the first formula seen with that key, so the band is that formula's own.
  constructor(bandOf) {
    this.bandOf = bandOf;
    this.seen = new Set();
    this.dist = { Low: 0, Moderate: 0, High: 0, Critical: 0 };
  }
  add(formula) {
    const k = pricingKey(formula);
    if (this.seen.has(k)) return false;
    this.seen.add(k);
    const band = this.bandOf(formula);
    this.dist[band] = (this.dist[band] || 0) + 1;
    return true;
  }
  result() { return { version: KEY_VERSION, uniqueFormulaCount: this.seen.size, fscoreDist: Object.assign({}, this.dist) }; }
}

module.exports = { PricingCounter, pricingKey, KEY_VERSION };
