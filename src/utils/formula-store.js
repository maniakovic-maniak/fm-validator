'use strict';
// formula-store.js - Patch 30. Keeps the complete text of every formula that Tier 0 shortens for display.
//
// Tier 0 keeps a 300-character copy of each formula in cellScoreIndex (and 500 for a family representative) so that
// memory stays small on a model like Hidden Gem (about 1.15 million formula cells). Several checks, including the
// circular-reference detector, read that copy, so a reference past the cut was never seen. The fix keeps the short
// copy for display and puts the full text of the formulas that were cut into this store:
//   - a formula of 300 characters or fewer is complete in cellScoreIndex already and is not stored again,
//   - a longer one is appended to a temporary file and only {offset, length} is held in memory.
// fullFormula(index, key, info) returns the complete text either way, so a caller never has to know which it was.
//
// If the temporary file cannot be opened, the store falls back to memory and says so (store.mode), rather than failing.

const fs = require('fs');
const os = require('os');
const path = require('path');

const FLUSH_BYTES = 1 << 20;

class FormulaStore {
  constructor(dir) {
    this.index = new Map();      // key -> [offset, byteLength]
    this.mem = null;             // Map used only in the fallback mode
    this.mode = 'disk';
    this.pending = [];
    this.pendingBytes = 0;
    this.written = 0;
    this.fd = null;
    try {
      const base = fs.mkdtempSync(path.join(dir || os.tmpdir(), 'fmstore-'));
      const file = path.join(base, 'formulas.dat');
      this.fd = fs.openSync(file, 'w+');
      // the file is only reachable through the open descriptor: it disappears when the process ends, even on a crash
      try { fs.unlinkSync(file); fs.rmdirSync(base); } catch (_) { /* keep going; cleanup is best effort */ }
    } catch (_) {
      this.fd = null; this.mode = 'memory'; this.mem = new Map();
    }
  }

  put(key, formula) {
    if (this.mode === 'memory') { this.mem.set(key, formula); this.index.set(key, null); return; }
    const buf = Buffer.from(formula, 'utf8');
    this.index.set(key, [this.written + this.pendingBytes, buf.length]);
    this.pending.push(buf); this.pendingBytes += buf.length;
    if (this.pendingBytes >= FLUSH_BYTES) this.flush();
  }

  flush() {
    if (!this.pending.length || this.fd === null) return;
    const all = Buffer.concat(this.pending);
    fs.writeSync(this.fd, all, 0, all.length, this.written);
    this.written += all.length; this.pending = []; this.pendingBytes = 0;
  }

  has(key) { return this.index.has(key); }

  get(key) {
    const loc = this.index.get(key);
    if (loc === undefined) return undefined;
    if (this.mode === 'memory') return this.mem.get(key);
    this.flush();
    const buf = Buffer.alloc(loc[1]);
    fs.readSync(this.fd, buf, 0, loc[1], loc[0]);
    return buf.toString('utf8');
  }

  get size() { return this.index.size; }

  close() {
    try { if (this.fd !== null) fs.closeSync(this.fd); } catch (_) { /* ignore */ }
    this.fd = null; this.pending = []; this.pendingBytes = 0;
  }
}

// The store is attached to the cellScoreIndex object as a non-enumerable property, so Object.entries(index) and
// JSON.stringify(index) are unchanged and every existing caller keeps working.
function attachStore(cellScoreIndex, store) {
  Object.defineProperty(cellScoreIndex, '__formulaStore', { value: store, enumerable: false, configurable: true });
  return cellScoreIndex;
}

function getStore(cellScoreIndex) {
  return (cellScoreIndex && cellScoreIndex.__formulaStore) || null;
}

// Complete text of the formula at `key`. `info` is the cellScoreIndex entry (looked up if omitted).
function fullFormula(cellScoreIndex, key, info) {
  const entry = info || (cellScoreIndex && cellScoreIndex[key]);
  if (!entry) return undefined;
  if (entry.formulaTruncated) {
    const store = getStore(cellScoreIndex);
    const full = store && store.get(key);
    if (typeof full === 'string') return full;
  }
  return entry.formulaText;
}

module.exports = { FormulaStore, attachStore, getStore, fullFormula };
