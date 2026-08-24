const express = require('express');
const path = require('path');
const { listOrders, getOrder } = require('../src/utils/order-store');

const app = express();
const PORT = process.env.ADMIN_PORT || 3001;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * Real order data, read directly from the same order-store.js the main
 * app writes to — no duplicated storage, no separate database. This is
 * a genuinely separate process from the public-facing app (different
 * port, different PM2 process, different nginx auth), but it reads the
 * exact same on-disk records.
 */
app.get('/api/orders', (req, res) => {
  try {
    const orders = listOrders();
    res.json({ orders });
  } catch (err) {
    console.error('   \u26a0\ufe0f  Failed to list orders:', err.message);
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

app.get('/api/orders/:orderId', (req, res) => {
  const order = getOrder(req.params.orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }
  res.json({ order });
});

app.listen(PORT, () => console.log(`FM Validator Admin running on http://localhost:${PORT}`));
