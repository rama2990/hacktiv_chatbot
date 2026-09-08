require('dotenv').config();
const path = require('node:path');
const express = require('express');

const app = express();
app.use(express.json());

// CORS untuk Live Server (frontend statis di port 5500/5501 memanggil API di sini)
const ALLOWED_ORIGINS = ['http://127.0.0.1:5500', 'http://localhost:5500', 'http://127.0.0.1:5501', 'http://localhost:5501'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

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
  const { exec } = require('node:child_process');
  app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log(`Chatbot KPR berjalan di ${url}`);
    if (process.env.OPEN_BROWSER !== 'false') {
      const cmd = process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
          ? `open "${url}"`
          : `xdg-open "${url}"`;
      exec(cmd, (err) => { if (err) console.log(`Buka manual: ${url}`); });
    }
  });
}
