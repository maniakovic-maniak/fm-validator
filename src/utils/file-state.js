'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lockfile = require('proper-lockfile');
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
function anchor(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.closeSync(fs.openSync(file, 'a', 0o600));
  return file;
}
const options = { realpath: false, stale: 120000, update: 20000 };
async function withLock(file, fn) {
  const release = await lockfile.lock(anchor(file), { ...options, retries: { retries: 40, minTimeout: 100, maxTimeout: 250 } });
  try { return await fn(); } finally { await release(); }
}
function withLockSync(file, fn) {
  anchor(file);
  let release;
  for (let i = 0; i < 100; i++) {
    try { release = lockfile.lockSync(file, options); break; }
    catch (e) { if (e.code !== 'ELOCKED' || i === 99) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); }
  }
  try { return fn(); } finally { release(); }
}
module.exports = { readJson, writeJson, withLock, withLockSync };
