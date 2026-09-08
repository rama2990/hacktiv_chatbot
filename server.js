require('dotenv').config();
const path = require('node:path');
const express = require('express');

const app = express();
app.use(express.json());

// Rate limit sederhana per IP (in-memory)
const RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || '20', 10);
const hits = new Map(); // ip -> { count, windowStart }
app.use((req, res, next) => {
  const now = Date.now();
  const ip = req.ip;
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    hits.set(ip, { count: 1, windowStart: now });
    return next();
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT) {
    return res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

const { router: sessionRouter } = require('./src/routes/session');
const { router: chatRouter } = require('./src/routes/chat');
app.use(sessionRouter);
app.use(chatRouter);

module.exports = { app };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Chatbot KPR berjalan di http://localhost:${PORT}`));
}
