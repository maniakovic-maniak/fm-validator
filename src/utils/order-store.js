'use strict';
const fs = require('fs');
const path = require('path');
const { readJson, writeJson, withLockSync } = require('./file-state');
function createOrderStore(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, '.orders');
  const file = id => /^Fm-\d{5,}$/.test(String(id)) ? path.join(dir, `${id}.json`) : null;
  function getOrder(id) { const p = file(id); return p ? readJson(p) : null; }
  function listOrders() {
    return fs.readdirSync(dir).filter(n => /^Fm-\d{5,}\.json$/.test(n)).map(n => readJson(path.join(dir, n)))
      .filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  function allocate(data, records) {
    const highest = records.reduce((n, r) => Math.max(n, Number(r.orderId.slice(3))), 0);
    const orderId = `Fm-${String(highest + 1).padStart(5, '0')}`;
    const record = { ...data, orderId, createdAt: new Date().toISOString() };
    writeJson(file(orderId), record); return record;
  }
  function createOrder(data) { return withLockSync(lock, () => allocate(data, listOrders())); }
  function createPaidOrderOnce(checkoutId, data) {
    if (!/^ci_[a-f0-9]{64}$/.test(checkoutId)) throw new Error('Invalid checkout ID');
    return withLockSync(lock, () => {
      const orders = listOrders();
      // The order itself is the durable idempotency record. Recovery cannot allocate twice.
      const existing = orders.find(o => o.checkoutId === checkoutId);
      if (existing) {
        const keys = ['sourceSha256', 'amountCents', 'currency', 'pricingVersion'];
        const moneyKeys = ['provider', 'status', 'sessionId', 'paymentIntentId', 'accountId', 'live'];
        if (keys.some(k => existing[k] !== data[k]) || moneyKeys.some(k => existing.payment?.[k] !== data.payment?.[k])) throw Object.assign(new Error('Existing order payment binding does not match.'), { code: 'ORDER_BINDING_MISMATCH', status: 409 });
        return existing;
      }
      return allocate({ ...data, checkoutId }, orders);
    });
  }
  function updateOrder(id, updates) {
    return withLockSync(lock, () => {
      const order = getOrder(id); if (!order) return null;
      const patch = { ...updates };
      for (const key of ['orderId', 'createdAt', 'checkoutId', 'payment', 'sourceSha256', 'amountCents', 'pricingVersion']) delete patch[key];
      const next = { ...order, ...patch }; writeJson(file(id), next); return next;
    });
  }
  function scrubOrderPii(id) {
    return !!updateOrder(id, { fullName: null, company: null, email: null, originalName: null, storedAs: null, ip: null, piiScrubbedAt: new Date().toISOString() });
  }
  return { createOrder, createPaidOrderOnce, getOrder, updateOrder, listOrders, scrubOrderPii, ORDERS_DIR: dir };
}
const ORDERS_DIR = process.env.ORDER_DATA_DIR || path.join(__dirname, '..', '..', 'orders');
module.exports = { ...createOrderStore(ORDERS_DIR), createOrderStore };
