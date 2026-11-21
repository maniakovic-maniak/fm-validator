#!/usr/bin/env node
'use strict';
require('dotenv').config();
const { createStripeService } = require('../src/utils/stripe-payment');
const { stripeNotifications } = require('../src/notifier');
(async () => {
  const service = createStripeService({ notifications: stripeNotifications() });
  const arg = process.argv[2];
  if (arg === '--list') return console.log(JSON.stringify(service.pendingReconciliation(), null, 2));
  if (arg === '--all') return console.log(JSON.stringify(await service.reconcilePending(), null, 2));
  if (!/^ci_[a-f0-9]{64}$/.test(arg || '')) throw Error('Usage: node scripts/reconcile-stripe-checkout.js --list | --all | ci_<id>');
  const result = await service.reconcile(arg);
  console.log(JSON.stringify({ checkoutId: result.id, status: result.status, orderId: result.orderId || null }));
})().catch(err => { console.error(err.code || 'RECONCILIATION_FAILED'); process.exitCode = 1; });
