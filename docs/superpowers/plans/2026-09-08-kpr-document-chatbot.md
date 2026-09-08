# Chatbot Verifikasi Dokumen KPR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chatbot web (vanilla JS + Express) yang memandu customer mengunggah dokumen KPR sesuai profesi, memeriksa isinya dengan Gemini multimodal, memberi feedback, dan bisa dilanjutkan di sesi/perangkat berbeda.

**Architecture:** Server-driven wizard — Express memegang state machine sesi, client hanyalah chat UI tipis. LLM dipanggil hanya untuk analisis dokumen. State tersimpan di SQLite sehingga sesi bisa di-resume via cookie atau kode sesi.

**Tech Stack:** Node.js (>=20), Express, better-sqlite3, multer, dotenv, Gemini API (fallback OpenRouter), vanilla JS, node:test + supertest.

**Spec:** `docs/superpowers/specs/2026-09-08-kpr-document-chatbot-design.md`

## Global Constraints

- File yang diterima: PDF/JPG/PNG, maks 4 MB per file, maks 4 file per pesan.
- Kode sesi format `KPR-XXXXXX` (6 karakter alfanumerik uppercase).
- Cookie: httpOnly, SameSite=Lax, usia 30 hari.
- LLM: Gemini primary → OpenRouter (model Gemini) fallback sekali. Key via `.env` (gitignored).
- API key tidak pernah di-hardcode; `.env.example` hanya placeholder.
- Test tidak pernah memanggil API LLM sungguhan — LLM selalu di-mock via injection.
- Nama file upload di-generate server (anti path traversal), disimpan di `src/uploads/` (gitignored).
- Rate limit: 20 request/menit per IP, config via `.env` (`RATE_LIMIT_PER_MIN`).
- State machine states: `GREETING, ASK_CODE, PROFESSION, CHECKLIST, COLLECTING, RECAP, DONE`.
- Status dokumen: `valid | perlu_perbaikan | tidak_sesuai | perlu_review_manual`.
- Respons API chat: `{ reply, options?, code?, progress, state }`.
- Bahasa UI dan seluruh teks bot: Indonesia.

---

### Task 1: Scaffold Proyek & Server Express

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `server.js`
- Test: `tests/server.test.js`

**Interfaces:**
- Produces: Express app diekspor dari `server.js` (`module.exports = { app }`) agar supertest bisa mengimpor; entry point `node server.js` menjalankan `app.listen(PORT)` hanya saat dijalankan langsung (`require.main === module`).

- [ ] **Step 1: Buat package.json, .gitignore, .env.example**

`package.json`:

```json
{
  "name": "kpr-document-chatbot",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "start": "node server.js",
    "test": "node --test tests/"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

`.gitignore`:

```
node_modules/
.env
src/uploads/
*.db
```

`.env.example`:

```
PORT=3000
GEMINI_API_KEY=your-gemini-api-key-here
GEMINI_MODEL=gemini-2.5-flash
OPENROUTER_API_KEY=your-openrouter-api-key-here
OPENROUTER_MODEL=google/gemini-2.5-flash
RATE_LIMIT_PER_MIN=20
```

- [ ] **Step 2: Install dependensi**

Run: `npm install`
Expected: folder `node_modules/` terbentuk tanpa error.

- [ ] **Step 3: Buat server.js**

```js
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

module.exports = { app };

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Chatbot KPR berjalan di http://localhost:${PORT}`));
}
```

- [ ] **Step 4: Tulis test server**

`tests/server.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { app } = require('../server');

test('GET /api/health mengembalikan ok', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
```

- [ ] **Step 5: Jalankan test**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore .env.example server.js tests/server.test.js
git commit -m "feat: scaffold express server dengan rate limit"
```

---

### Task 2: Database SQLite & Models

**Files:**
- Create: `src/db/sqlite.js`
- Create: `src/db/models.js`
- Test: `tests/db.test.js`

**Interfaces:**
- Consumes: `better-sqlite3`.
- Produces:
  - `sqlite.js`: `const db = require('../db/sqlite')` — instance better-sqlite3 di `src/data/chatbot.db` (diabaikan git).
  - `models.js` (semua synchronous, better-sqlite3):
    - `createSession({ id, code, cookieToken })` → row session
    - `getSession(id)`, `getSessionByCode(code)`, `getSessionByToken(token)` → row | undefined
    - `updateSession(id, { state, profession, currentIndex })`
    - `addMessage(sessionId, role, content)` → row
    - `getMessages(sessionId)` → array row (urut id ASC)
    - `addDocument({ sessionId, jenis, path, mime, status, notes })` → row
    - `updateDocument(id, { status, notes })`
    - `getDocuments(sessionId)` → array row (urut id ASC)

- [ ] **Step 1: Tulis test db**

`tests/db.test.js`:

```js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const models = require('../src/db/models');
const db = require('../src/db/sqlite');

beforeEach(() => {
  db.exec("DELETE FROM sessions; DELETE FROM messages; DELETE FROM documents;");
});

test('createSession & getSession', () => {
  models.createSession({ id: 's1', code: 'KPR-ABC123', cookieToken: 'tok1' });
  const s = models.getSession('s1');
  assert.equal(s.state, 'GREETING');
  assert.equal(s.currentIndex, 0);
  assert.equal(models.getSessionByCode('KPR-ABC123').id, 's1');
  assert.equal(models.getSessionByToken('tok1').id, 's1');
});

test('updateSession mengubah state/profesi/index', () => {
  models.createSession({ id: 's2', code: 'KPR-XYZ789', cookieToken: 'tok2' });
  models.updateSession('s2', { state: 'COLLECTING', profession: 'karyawan', currentIndex: 2 });
  const s = models.getSession('s2');
  assert.equal(s.state, 'COLLECTING');
  assert.equal(s.profession, 'karyawan');
  assert.equal(s.currentIndex, 2);
});

test('messages tersimpan & terurut', () => {
  models.createSession({ id: 's3', code: 'KPR-MMM333', cookieToken: 'tok3' });
  models.addMessage('s3', 'bot', 'Halo');
  models.addMessage('s3', 'user', 'Hai');
  const msgs = models.getMessages('s3');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'bot');
  assert.equal(msgs[1].content, 'Hai');
});

test('documents tersimpan & bisa diupdate', () => {
  models.createSession({ id: 's4', code: 'KPR-DDD444', cookieToken: 'tok4' });
  const d = models.addDocument({ sessionId: 's4', jenis: 'ktp', path: 'x/ktp-1.png', mime: 'image/png', status: 'valid', notes: 'OK' });
  models.updateDocument(d.id, { status: 'perlu_perbaikan', notes: 'Nama beda' });
  const docs = models.getDocuments('s4');
  assert.equal(docs[0].status, 'perlu_perbaikan');
});
```

- [ ] **Step 2: Jalankan test — gagal karena modul belum ada**

Run: `npm test`
Expected: FAIL ("Cannot find module '../src/db/models'").

- [ ] **Step 3: Implementasi sqlite.js & models.js**

`src/db/sqlite.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'chatbot.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  cookie_token TEXT UNIQUE NOT NULL,
  profession TEXT,
  state TEXT NOT NULL DEFAULT 'GREETING',
  current_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  jenis TEXT NOT NULL,
  path TEXT NOT NULL,
  mime TEXT NOT NULL,
  status TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
```

`src/db/models.js`:

```js
const db = require('./sqlite');

const createSession = ({ id, code, cookieToken }) =>
  db.prepare('INSERT INTO sessions (id, code, cookie_token) VALUES (?, ?, ?)').run(id, code, cookieToken);

const getSession = (id) => db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
const getSessionByCode = (code) => db.prepare('SELECT * FROM sessions WHERE code = ?').get(code);
const getSessionByToken = (token) => db.prepare('SELECT * FROM sessions WHERE cookie_token = ?').get(token);

const updateSession = (id, { state, profession, currentIndex } = {}) => {
  const s = getSession(id);
  db.prepare(`UPDATE sessions SET state = ?, profession = ?, current_index = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(state ?? s.state, profession ?? s.profession, currentIndex ?? s.currentIndex, id);
  return getSession(id);
};

const addMessage = (sessionId, role, content) =>
  db.prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)').run(sessionId, role, content);

const getMessages = (sessionId) =>
  db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC').all(sessionId);

const addDocument = ({ sessionId, jenis, path, mime, status = null, notes = null }) => {
  const info = db.prepare('INSERT INTO documents (session_id, jenis, path, mime, status, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sessionId, jenis, path, mime, status, notes);
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid);
};

const updateDocument = (id, { status, notes }) =>
  db.prepare('UPDATE documents SET status = ?, notes = ? WHERE id = ?').run(status, notes, id);

const getDocuments = (sessionId) =>
  db.prepare('SELECT * FROM documents WHERE session_id = ? ORDER BY id ASC').all(sessionId);

module.exports = {
  createSession, getSession, getSessionByCode, getSessionByToken,
  updateSession, addMessage, getMessages, addDocument, updateDocument, getDocuments,
};
```

- [ ] **Step 4: Jalankan test**

Run: `npm test`
Expected: PASS (semua test).

- [ ] **Step 5: Commit**

```bash
git add src/db tests/db.test.js
git commit -m "feat: sqlite schema dan models sesi/pesan/dokumen"
```

---

### Task 3: Knowledge Base Checklist per Profesi

**Files:**
- Create: `src/services/checklist.js`
- Test: `tests/checklist.test.js`

**Interfaces:**
- Produces:
  - `PROFESSIONS`: object key → `{ key, label, documents: [{ key, name, rules: [string] }] }` (urutan = urutan pengumpulan).
  - `getProfession(key)` → profession | undefined.
  - `findDocument(professionKey, docKey)` → document | undefined.
  - Keys profesi: `karyawan`, `wiraswasta`, `profesional`, `bumn_pns`.
- Aturan pemeriksaan diambil dari riset: usia dokumen (slip gaji 1–3 bulan, SKK ≤ 1 bulan, rekening koran 3–6 bulan), legalisir (stempel basah), konsistensi nama, masa berlaku (NIB/SIP aktif), legalitas properti (SHM/SHGB atas nama penjual, sisa masa berlaku > tenor, bebas sengketa; IMB/PBG wajib; PBB tahun terakhir lunas).

- [ ] **Step 1: Tulis test checklist**

`tests/checklist.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { PROFESSIONS, getProfession, findDocument } = require('../src/services/checklist');

test('empat profesi terdaftar dengan label Indonesia', () => {
  assert.deepEqual(Object.keys(PROFESSIONS).sort(), ['bumn_pns', 'karyawan', 'profesional', 'wiraswasta']);
  assert.equal(getProfession('karyawan').label, 'Karyawan');
});

test('dokumen inti ada di semua profesi', () => {
  for (const p of Object.values(PROFESSIONS)) {
    const keys = p.documents.map((d) => d.key);
    for (const wajib of ['ktp', 'kartu_keluarga', 'npwp']) {
      assert.ok(keys.includes(wajib), `${p.key} harus punya ${wajib}`);
    }
  }
});

test('karyawan punya slip gaji & rekening koran dengan aturan usia', () => {
  const slip = findDocument('karyawan', 'slip_gaji');
  assert.ok(slip.rules.some((r) => r.includes('bulan terakhir')));
  const rekKor = findDocument('karyawan', 'rekening_koran');
  assert.ok(rekKor.rules.some((r) => r.toLowerCase().includes('3 bulan')));
});

test('wiraswasta punya NIB & akta pendirian; profesional punya SIP', () => {
  assert.ok(findDocument('wiraswasta', 'nib_siup'));
  assert.ok(findDocument('wiraswasta', 'akta_pendirian'));
  const sip = findDocument('profesional', 'sip');
  assert.ok(sip.rules.some((r) => r.toLowerCase().includes('masih berlaku')));
});

test('dokumen properti ada di semua profesi', () => {
  for (const p of Object.values(PROFESSIONS)) {
    const keys = p.documents.map((d) => d.key);
    assert.ok(keys.includes('sertifikat'), `${p.key} harus punya sertifikat`);
    assert.ok(keys.includes('imb_pbg'));
    assert.ok(keys.includes('pbb'));
  }
});

test('setiap dokumen punya minimal 1 aturan pemeriksaan', () => {
  for (const p of Object.values(PROFESSIONS)) {
    for (const d of p.documents) assert.ok(d.rules.length >= 1, `${p.key}.${d.key} tanpa aturan`);
  }
});
```

- [ ] **Step 2: Jalankan test — gagal**

Run: `npm test`
Expected: FAIL ("Cannot find module '../src/services/checklist'").

- [ ] **Step 3: Implementasi checklist.js**

`src/services/checklist.js`:

```js
const IDENTITAS = [
  {
    key: 'ktp', name: 'KTP (pemohon & pasangan bila menikah)',
    rules: [
      'KTP masih berlaku dan NIK terdaftar Dukcapil.',
      'Ejaan nama harus sama persis dengan semua dokumen lain (KK, NPWP, slip gaji).',
    ],
  },
  {
    key: 'kartu_keluarga', name: 'Kartu Keluarga',
    rules: ['Data KK sesuai KTP; status perkawinan tercantum.'],
  },
  {
    key: 'npwp', name: 'NPWP pribadi',
    rules: ['NPWP aktif dan SPT tahunan sudah dilaporkan; alamat NPWP sinkron dengan KTP.'],
  },
  {
    key: 'surat_nikah', name: 'Surat Nikah / Akta Cerai (jika relevan)',
    rules: ['Diperlukan bila pemohon menikah/pernah menikah; data sesuai KK.'],
  },
];

const PROPERTI = [
  {
    key: 'sertifikat', name: 'Sertifikat SHM/SHGB',
    rules: [
      'Sertifikat harus atas nama penjual (properti second) atau atas nama pemohon (take over).',
      'Sisa masa berlaku SHGB/HGB harus lebih panjang dari tenor kredit.',
      'Tidak sedang dijaminkan, diblokir, atau sengketa.',
    ],
  },
  {
    key: 'imb_pbg', name: 'IMB / PBG',
    rules: ['Wajib ada; nama pemilik sesuai sertifikat. Tanpa IMB/PBG pengajuan ditolak.'],
  },
  {
    key: 'pbb', name: 'PBB (SPPT) + bukti bayar terakhir',
    rules: ['SPPT tahun terakhir sudah lunas; nama wajib pajak sesuai sertifikat.'],
  },
  {
    key: 'ajb', name: 'AJB (Akta Jual Beli)',
    rules: ['Wajib untuk properti second; nama dan luas tanah sesuai sertifikat.'],
  },
];

const PROFESSIONS = {
  karyawan: {
    key: 'karyawan', label: 'Karyawan',
    documents: [
      ...IDENTITAS,
      {
        key: 'slip_gaji', name: 'Slip Gaji (1–3 bulan terakhir)',
        rules: [
          'Slip gaji maksimal 3 bulan terakhir (idealnya 1 bulan).',
          'Harus bercap/stempel basah HRD; tanpa stempel dianggap tidak valid.',
          'Penghasilan di slip gaji harus konsisten dengan mutasi rekening koran.',
        ],
      },
      {
        key: 'skk', name: 'Surat Keterangan Kerja',
        rules: [
          'Berusia maksimal 1 bulan sejak diterbitkan.',
          'Memuat kop perusahaan, nomor surat, tanggal, status kepegawaian, masa kerja, dan stempel basah.',
        ],
      },
      {
        key: 'rekening_koran', name: 'Rekening Koran (3 bulan terakhir)',
        rules: ['Mutasi 3 bulan terakhir, dicetak/stempel bank; pola gaji masuk rutin.'],
      },
      ...PROPERTI,
    ],
  },
  wiraswasta: {
    key: 'wiraswasta', label: 'Wiraswasta / Wirausaha',
    documents: [
      ...IDENTITAS,
      {
        key: 'nib_siup', name: 'NIB / SIUP / TDP',
        rules: ['Status izin harus aktif/berlaku; kadaluarsa = ditolak.'],
      },
      {
        key: 'akta_pendirian', name: 'Akta Pendirian & Perubahan Terakhir',
        rules: ['Versi perubahan terkini; akta pengesahan Menkeh untuk PT/CV.'],
      },
      {
        key: 'laporan_keuangan', name: 'Laporan Keuangan / Neraca & Laba Rugi',
        rules: ['Laporan keuangan 2 tahun terakhir (neraca + laba rugi) dan konsisten dengan mutasi rekening.'],
      },
      {
        key: 'rekening_koran', name: 'Rekening Koran Usaha (6 bulan terakhir)',
        rules: ['Mutasi 6 bulan terakhir untuk penghasilan non-fixed income.'],
      },
      ...PROPERTI,
    ],
  },
  profesional: {
    key: 'profesional', label: 'Profesional (Dokter, Notaris, Arsitek, dll.)',
    documents: [
      ...IDENTITAS,
      {
        key: 'sip', name: 'Surat Izin Praktik (SIP)',
        rules: ['SIP harus masih berlaku/aktif; kadaluarsa perlu surat perpanjangan dari instansi.'],
      },
      {
        key: 'rekening_koran', name: 'Rekening Koran (3–6 bulan terakhir)',
        rules: ['Mutasi 3–6 bulan terakhir; penghasilan dinilai dari rata-rata mutasi, bukan satu bulan.'],
      },
      ...PROPERTI,
    ],
  },
  bumn_pns: {
    key: 'bumn_pns', label: 'Karyawan BUMN / BUMD / PNS / Bank',
    documents: [
      ...IDENTITAS,
      {
        key: 'sk_pengangkatan', name: 'SK Pengangkatan (pertama / pegawai)',
        rules: ['SK pengangkatan resmi dari instansi; data sesuai KTP.'],
      },
      {
        key: 'sk_pangkat', name: 'SK Pangkat/Jabatan Terakhir',
        rules: ['SK pangkat terakhir harus sesuai jabatan saat ini.'],
      },
      {
        key: 'slip_gaji', name: 'Slip Gaji (3 bulan terakhir)',
        rules: ['Slip gaji 3 bulan terakhir, bercap basah instansi.'],
      },
      {
        key: 'rekening_koran', name: 'Rekening Koran (3 bulan terakhir)',
        rules: ['Mutasi 3 bulan terakhir dengan stempel bank.'],
      },
      ...PROPERTI,
    ],
  },
};

const getProfession = (key) => PROFESSIONS[key];
const findDocument = (professionKey, docKey) =>
  PROFESSIONS[professionKey]?.documents.find((d) => d.key === docKey);

module.exports = { PROFESSIONS, getProfession, findDocument };
```

- [ ] **Step 4: Jalankan test**

Run: `npm test`
Expected: PASS (semua test).

- [ ] **Step 5: Commit**

```bash
git add src/services/checklist.js tests/checklist.test.js
git commit -m "feat: knowledge base checklist dokumen KPR per profesi"
```

---

### Task 4: Klien LLM (Gemini + Fallback OpenRouter)

**Files:**
- Create: `src/services/gemini.js`
- Test: `tests/gemini.test.js`

**Interfaces:**
- Consumes: `fetch` bawaan Node 20 (di-inject untuk test).
- Produces:
  - `generateContent({ parts, fetchImpl })` → `{ text }` — bagian `parts` sudah format Gemini: `[{ text }, { inlineData: { mimeType, data } }]`.
  - Melempar `Error('LLM_UNAVAILABLE')` bila kedua provider gagal.
  - Primary: `POST https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=...`
  - Fallback: OpenAI-style `POST https://openrouter.ai/api/v1/chat/completions`, model `OPENROUTER_MODEL`, `parts` dikonversi ke konten multimodal OpenAI (teks + `image_url`/`file` base64).

- [ ] **Step 1: Tulis test gemini**

`tests/gemini.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { generateContent } = require('../src/services/gemini');

const okGemini = () => async (url, opts) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text: 'halo' }] } }] }),
});

test('primary Gemini sukses mengembalikan teks', async () => {
  const res = await generateContent({ parts: [{ text: 'hai' }], fetchImpl: okGemini() });
  assert.equal(res.text, 'halo');
});

test('fallback ke OpenRouter saat Gemini error 429', async () => {
  let calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('generativelanguage')) {
      return { ok: false, status: 429, json: async () => ({}) };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'fallback' } }] }),
    };
  };
  const res = await generateContent({ parts: [{ text: 'hai' }], fetchImpl });
  assert.equal(res.text, 'fallback');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('openrouter'));
});

test('lempar LLM_UNAVAILABLE bila keduanya gagal', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(
    () => generateContent({ parts: [{ text: 'hai' }], fetchImpl }),
    /LLM_UNAVAILABLE/,
  );
});
```

- [ ] **Step 2: Jalankan test — gagal**

Run: `npm test`
Expected: FAIL ("Cannot find module '../src/services/gemini'").

- [ ] **Step 3: Implementasi gemini.js**

`src/services/gemini.js`:

```js
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callGemini(parts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('LLM_UNAVAILABLE');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
  });
  if (!res.ok) throw new Error(`GEMINI_HTTP_${res.status}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? '';
  if (!text) throw new Error('GEMINI_EMPTY');
  return text;
}

function partToOpenAI(part) {
  if (part.text) return { type: 'text', text: part.text };
  if (part.inlineData) {
    const dataUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    const type = part.inlineData.mimeType === 'application/pdf' ? 'file' : 'image_url';
    return { type, [type === 'file' ? 'file' : 'image_url']: { url: dataUrl } };
  }
  return { type: 'text', text: '' };
}

async function callOpenRouter(parts) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('LLM_UNAVAILABLE');
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Chatbot KPR',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: 'user', content: parts.map(partToOpenAI) }],
    }),
  });
  if (!res.ok) throw new Error(`OPENROUTER_HTTP_${res.status}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('OPENROUTER_EMPTY');
  return text;
}

async function generateContent({ parts, fetchImpl = fetch }) {
  // fetchImpl di-inject hanya untuk test; provider internal tetap module-level
  if (fetchImpl !== fetch) {
    const saved = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      return { text: await callGemini(parts) };
    } catch {
      try {
        return { text: await callOpenRouter(parts) };
      } finally {
        globalThis.fetch = saved;
      }
    }
  }
  try {
    return { text: await callGemini(parts) };
  } catch {
    return { text: await callOpenRouter(parts) };
  }
}

module.exports = { generateContent };
```

- [ ] **Step 4: Jalankan test**

Run: `npm test`
Expected: PASS (semua test).

- [ ] **Step 5: Commit**

```bash
git add src/services/gemini.js tests/gemini.test.js
git commit -m "feat: klien gemini dengan fallback openrouter"
```

---

### Task 5: Analyzer Dokumen (Prompt Multimodal + Parsing JSON)

**Files:**
- Create: `src/services/analyzer.js`
- Test: `tests/analyzer.test.js`

**Interfaces:**
- Consumes: `generateContent` dari Task 4 (di-inject), `findDocument` dari Task 3.
- Produces:
  - `analyzeDocument({ professionKey, docKey, fileBuffer, mimeType, llm })` → `{ status, issues: string[], suggestions: string[], feedbackText: string }`.
  - `status` ∈ `valid | perlu_perbaikan | tidak_sesuai | perlu_review_manual`.
  - `llm` = `{ generateContent }` (injection untuk test; produksi pakai `require('./gemini')`).
  - Parsing: JSON di antara ```json fences atau objek langsung; gagal → retry sekali; gagal lagi → status `perlu_review_manual`.

- [ ] **Step 1: Tulis test analyzer**

`tests/analyzer.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { analyzeDocument } = require('../src/services/analyzer');

const VALID_JSON = JSON.stringify({
  status: 'valid', issues: [], suggestions: [],
});

test('respons JSON valid diparse & feedback dirangkai', async () => {
  const llm = { generateContent: async () => ({ text: VALID_JSON }) };
  const res = await analyzeDocument({
    professionKey: 'karyawan', docKey: 'ktp',
    fileBuffer: Buffer.from('x'), mimeType: 'image/png', llm,
  });
  assert.equal(res.status, 'valid');
  assert.equal(typeof res.feedbackText, 'string');
  assert.ok(res.feedbackText.length > 0);
});

test('JSON dalam code fence tetap diparse', async () => {
  const llm = { generateContent: async () => ({ text: '```json\n' + VALID_JSON + '\n```' }) };
  const res = await analyzeDocument({
    professionKey: 'karyawan', docKey: 'ktp',
    fileBuffer: Buffer.from('x'), mimeType: 'image/png', llm,
  });
  assert.equal(res.status, 'valid');
});

test('JSON rusak → retry sekali lalu sukses', async () => {
  let calls = 0;
  const llm = {
    generateContent: async () => {
      calls += 1;
      return calls === 1 ? { text: 'bukan json' } : { text: VALID_JSON };
    },
  };
  const res = await analyzeDocument({
    professionKey: 'karyawan', docKey: 'ktp',
    fileBuffer: Buffer.from('x'), mimeType: 'image/png', llm,
  });
  assert.equal(calls, 2);
  assert.equal(res.status, 'valid');
});

test('JSON rusak dua kali → perlu_review_manual', async () => {
  const llm = { generateContent: async () => ({ text: 'rusak' }) };
  const res = await analyzeDocument({
    professionKey: 'karyawan', docKey: 'ktp',
    fileBuffer: Buffer.from('x'), mimeType: 'image/png', llm,
  });
  assert.equal(res.status, 'perlu_review_manual');
});

test('status di luar nilai valid dipetakan ke perlu_review_manual', async () => {
  const llm = { generateContent: async () => ({ text: JSON.stringify({ status: 'aneh', issues: [], suggestions: [] }) }) };
  const res = await analyzeDocument({
    professionKey: 'karyawan', docKey: 'ktp',
    fileBuffer: Buffer.from('x'), mimeType: 'image/png', llm,
  });
  assert.equal(res.status, 'perlu_review_manual');
});
```

- [ ] **Step 2: Jalankan test — gagal**

Run: `npm test`
Expected: FAIL ("Cannot find module '../src/services/analyzer'").

- [ ] **Step 3: Implementasi analyzer.js**

`src/services/analyzer.js`:

```js
const { findDocument } = require('./checklist');

const STATUS_VALID = ['valid', 'perlu_perbaikan', 'tidak_sesuai'];

function buildPrompt(doc, professionLabel) {
  const rules = doc.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `Kamu adalah petugas verifikasi dokumen KPR di bank. Periksa dokumen "${doc.name}" milik calon debitur berprofesi ${professionLabel}.

Aturan pemeriksaan:
${rules}

Periksa gambar/PDF yang dilampirkan terhadap aturan di atas. Balas HANYA dengan JSON (tanpa teks lain) dalam format:
{"status": "valid" | "perlu_perbaikan" | "tidak_sesuai", "issues": ["masalah yang ditemukan"], "suggestions": ["saran perbaikan"]}

Kriteria status:
- "valid": dokumen memenuhi semua aturan.
- "perlu_perbaikan": dokumen ada tapi ada kelemahan yang bisa diperbaiki (usia, tidak bercap, ejaan nama, dll).
- "tidak_sesuai": dokumen tidak relevan/tidak dapat dibaca/bukan dokumen yang diminta.
Gunakan bahasa Indonesia pada issues dan suggestions.`;
}

function extractJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('NO_JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

function feedbackText(doc, result) {
  const nama = doc.name;
  if (result.status === 'valid') return `✅ Dokumen "${nama}" dinyatakan valid. Tidak ditemukan masalah.`;
  if (result.status === 'perlu_perbaikan') {
    const issues = result.issues.map((i) => `  - ${i}`).join('\n');
    const sug = result.suggestions.map((s) => `  - ${s}`).join('\n');
    return `⚠️ Dokumen "${nama}" perlu perbaikan:\n${issues}\nSaran:\n${sug}`;
  }
  if (result.status === 'tidak_sesuai') {
    const issues = result.issues.map((i) => `  - ${i}`).join('\n');
    return `❌ Dokumen "${nama}" tidak sesuai:\n${issues}\nSilakan periksa kembali dan kirim ulang.`;
  }
  return `Dokumen "${nama}" sudah tersimpan, tetapi belum bisa diverifikasi otomatis. Petugas akan meninjaunya secara manual.`;
}

async function analyzeDocument({ professionKey, docKey, fileBuffer, mimeType, llm }) {
  const { getProfession } = require('./checklist');
  const doc = findDocument(professionKey, docKey);
  const profession = getProfession(professionKey);
  const prompt = buildPrompt(doc, profession.label);
  const parts = [{ text: prompt }, { inlineData: { mimeType, data: fileBuffer.toString('base64') } }];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await llm.generateContent({ parts });
      const parsed = extractJSON(text);
      const status = STATUS_VALID.includes(parsed.status) ? parsed.status : 'perlu_review_manual';
      const result = {
        status,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
      return { ...result, feedbackText: feedbackText(doc, result) };
    } catch {
      // retry sekali; jika gagal lagi keluar dari loop
    }
  }
  const fallback = { status: 'perlu_review_manual', issues: [], suggestions: [] };
  return { ...fallback, feedbackText: feedbackText(doc, fallback) };
}

module.exports = { analyzeDocument };
```

- [ ] **Step 4: Jalankan test**

Run: `npm test`
Expected: PASS (semua test).

- [ ] **Step 5: Commit**

```bash
git add src/services/analyzer.js tests/analyzer.test.js
git commit -m "feat: analyzer dokumen multimodal dengan parsing json dan retry"
```

---

### Task 6: State Machine Wizard

**Files:**
- Create: `src/services/stateMachine.js`
- Test: `tests/stateMachine.test.js`

**Interfaces:**
- Consumes: `PROFESSIONS/getProfession/findDocument` (Task 3), `analyzeDocument` (Task 5), `models` (Task 2) — semuanya via objek `deps` agar testable: `deps = { models, llm }`.
- Produces:
  - `newSessionId()` → string UUID.
  - `newSessionCode()` → `KPR-XXXXXX`.
  - `startNewSession({ cookieToken, deps })` → row session (state `GREETING`).
  - `handleMessage({ session, text = '', files = [], deps })` → `{ reply, options?, code?, progress, state }` — **side-effectful**: menyimpan pesan, mengubah state sesi, menyimpan & menganalisis dokumen. `files` = `[{ buffer, mimetype, originalname }]`.
  - `progress(session)` → array `{ key, name, status }` dari checklist profesi × tabel documents (status `null` = belum diunggah).
  - Pemrosesan file: jika dokumen yang dikirim tidak cocok dengan jenis yang sedang diminta, bot menolak dengan pesan (tanpa LLM) — pencocokan berdasarkan `originalname` mengandung key dokumen (misal `slip_gaji` → `slip-gaji.pdf`), fallback: file pertama dianggap dokumen yang diminta bila nama tidak dikenali.

- [ ] **Step 1: Tulis test state machine**

`tests/stateMachine.test.js`:

```js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const sm = require('../src/services/stateMachine');
const models = require('../src/db/models');
const db = require('../src/db/sqlite');

function fakeDots(overrides = {}) {
  return {
    models,
    llm: {
      generateContent: overrides.generateContent || (async () => ({
        text: JSON.stringify({ status: 'valid', issues: [], suggestions: [] }),
      })),
    },
  };
}

beforeEach(() => {
  db.exec('DELETE FROM sessions; DELETE FROM messages; DELETE FROM documents;');
});

test('kode sesi berformat KPR-XXXXXX', () => {
  assert.match(sm.newSessionCode(), /^KPR-[A-Z0-9]{6}$/);
});

test('GREETING: jawaban "tidak" → PROFESSION, sesi baru punya kode', async () => {
  const session = sm.startNewSession({ cookieToken: 't1', deps: fakeDots() });
  const res = await sm.handleMessage({ session, text: 'belum pernah', deps: fakeDots() });
  assert.equal(res.state, 'PROFESSION');
  assert.ok(res.reply.includes('profesi'));
  assert.ok(res.options.length >= 4);
  const fresh = models.getSession(session.id);
  assert.match(fresh.code, /^KPR-/);
  assert.ok(res.code.startsWith('KPR-'));
});

test('GREETING: jawaban "pernah" → ASK_CODE; kode valid meresume sesi lain', async () => {
  const old = sm.startNewSession({ cookieToken: 't-old', deps: fakeDots() });
  models.updateSession(old.id, { state: 'COLLECTING', profession: 'karyawan', currentIndex: 1 });
  const cur = sm.startNewSession({ cookieToken: 't-cur', deps: fakeDots() });
  const res = await sm.handleMessage({ session: cur, text: 'sudah pernah', deps: fakeDots() });
  assert.equal(res.state, 'ASK_CODE');
  const res2 = await sm.handleMessage({ session: cur, text: old.code, deps: fakeDots() });
  assert.match(res2.reply, /melanjutkan/i);
  assert.equal(models.getSession(cur.id).state, 'DONE_ABORTED');
});

test('PROFESSION: pilih karyawan → CHECKLIST lalu COLLECTING dengan dokumen pertama', async () => {
  const session = models.createSession({ id: 'sp', code: 'KPR-AAA111', cookieToken: 'tp' });
  const s = models.getSession('sp');
  const res = await sm.handleMessage({ session: s, text: 'karyawan', deps: fakeDots() });
  assert.equal(res.state, 'COLLECTING');
  assert.ok(res.reply.includes('KTP'));
  assert.equal(models.getSession('sp').profession, 'karyawan');
});

test('COLLECTING: file valid → dianalisis, status tersimpan, lanjut dokumen berikut', async () => {
  const session = models.createSession({ id: 'sc', code: 'KPR-BBB222', cookieToken: 'tc' });
  models.updateSession('sc', { state: 'COLLECTING', profession: 'karyawan', currentIndex: 0 });
  const s = models.getSession('sc');
  const res = await sm.handleMessage({
    session: s, text: '',
    files: [{ buffer: Buffer.from('pdf'), mimetype: 'image/png', originalname: 'ktp.png' }],
    deps: fakeDots(),
  });
  assert.ok(res.reply.includes('valid'));
  assert.equal(res.state, 'COLLECTING');
  const docs = models.getDocuments('sc');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].status, 'valid');
  assert.equal(models.getSession('sc').currentIndex, 1);
});

test('COLLECTING: file dengan nama tidak sesuai diminta ulang tanpa LLM', async () => {
  const session = models.createSession({ id: 'sr', code: 'KPR-CCC333', cookieToken: 'tr' });
  models.updateSession('sr', { state: 'COLLECTING', profession: 'karyawan', currentIndex: 0 });
  const s = models.getSession('sr');
  const llm = { generateContent: async () => { throw new Error('tidak boleh dipanggil'); } };
  const res = await sm.handleMessage({
    session: s, text: '',
    files: [{ buffer: Buffer.from('pdf'), mimetype: 'application/pdf', originalname: 'certificate-of-ownership.pdf' }],
    deps: { models, llm },
  });
  assert.ok(res.reply.includes('tidak sesuai') || res.reply.includes('diminta'));
  assert.equal(models.getDocuments('sr').length, 0);
  assert.equal(models.getSession('sr').currentIndex, 0);
});

test('dokumen terakhir selesai → RECAP berisi rekap semua dokumen', async () => {
  const session = models.createSession({ id: 'sz', code: 'KPR-DDD444', cookieToken: 'tz' });
  models.updateSession('sz', { state: 'COLLECTING', profession: 'karyawan', currentIndex: 0 });
  const s = models.getSession('sz');
  // kirim semua dokumen karyawan satu per satu
  const docs = require('../src/services/checklist').getProfession('karyawan').documents;
  let res;
  for (const d of docs) {
    res = await sm.handleMessage({
      session: models.getSession('sz'), text: '',
      files: [{ buffer: Buffer.from('f'), mimetype: 'image/png', originalname: `${d.key}.png` }],
      deps: fakeDots(),
    });
  }
  assert.equal(res.state, 'RECAP');
  assert.ok(res.reply.includes('Rekap'));
  assert.equal(res.progress.filter((p) => p.status === 'valid').length, docs.length);
});

test('RECAP: "selesai" → DONE', async () => {
  const session = models.createSession({ id: 'sd', code: 'KPR-EEE555', cookieToken: 'td' });
  models.updateSession('sd', { state: 'RECAP', profession: 'karyawan', currentIndex: 10 });
  const res = await sm.handleMessage({ session: models.getSession('sd'), text: 'selesai', deps: fakeDots() });
  assert.equal(res.state, 'DONE');
});

test('PROFESSION: input tak dikenal 2x → dipaksa pilih opsi', async () => {
  const session = models.createSession({ id: 'sx', code: 'KPR-FFF666', cookieToken: 'tx' });
  models.updateSession('sx', { state: 'PROFESSION' });
  const res = await sm.handleMessage({ session: models.getSession('sx'), text: 'hmm entahlah', deps: fakeDots() });
  assert.equal(res.state, 'PROFESSION');
  assert.ok(res.reply.includes('pilih') || res.reply.includes('Pilih'));
});
```

- [ ] **Step 2: Jalankan test — gagal**

Run: `npm test`
Expected: FAIL ("Cannot find module '../src/services/stateMachine'").

- [ ] **Step 3: Implementasi stateMachine.js**

`src/services/stateMachine.js`:

```js
const crypto = require('node:crypto');
const { PROFESSIONS, getProfession } = require('./checklist');

const newSessionId = () => crypto.randomUUID();
const newSessionCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) suffix += chars[crypto.randomInt(chars.length)];
  return `KPR-${suffix}`;
};

const startNewSession = ({ cookieToken, deps }) => {
  const id = newSessionId();
  deps.models.createSession({ id, code: newSessionCode(), cookieToken });
  return deps.models.getSession(id);
};

const progress = (session, models) => {
  if (!session || !session.profession) return [];
  const prof = getProfession(session.profession);
  const docs = models.getDocuments(session.id);
  return prof.documents.map((d) => ({
    key: d.key,
    name: d.name,
    status: docs.find((x) => x.jenis === d.key)?.status ?? null,
  }));
};

function normalize(str) {
  return (str || '').toLowerCase().trim();
}

const PROF_ALIAS = {
  karyawan: ['karyawan', '1', 'peg', 'pegawai'],
  wiraswasta: ['wiraswasta', 'wirausaha', '2', 'usaha'],
  profesional: ['profesional', '3', 'dokter', 'notaris'],
  bumn_pns: ['bumn', 'pns', 'bumn_pns', '4', 'instansi'],
};

function matchProfession(text) {
  const t = normalize(text);
  for (const [key, aliases] of Object.entries(PROF_ALIAS)) {
    if (aliases.some((a) => t === a || t.includes(a))) return key;
  }
  return undefined;
}

function botSay(session, text) {
  session.deps.models.addMessage(session.id, 'bot', text);
}

// NOTE: session.deps diset di handleMessage sebelum dipakai
function reply(session, text, extra = {}) {
  session.deps.models.addMessage(session.id, 'bot', text);
  return { reply: text, progress: progress(session, session.deps.models), state: session.deps.models.getSession(session.id).state, ...extra };
}

function nextCollectingReply(session) {
  const prof = getProfession(session.deps.models.getSession(session.id).profession);
  const idx = session.deps.models.getSession(session.id).currentIndex;
  if (idx >= prof.documents.length) {
    session.deps.models.updateSession(session.id, { state: 'RECAP' });
    return recapReply(session);
  }
  const doc = prof.documents[idx];
  const done = progress(session, session.deps.models).filter((p) => p.status).length;
  return reply(session,
    `Terima kasih. Sekarang mohon unggah dokumen (${done + 1}/${prof.documents.length}): ${doc.name}. Format PDF/JPG/PNG, maksimal 4 MB.`);
}

function recapReply(session) {
  const p = progress(session, session.deps.models);
  const lines = p.map((x) => {
    const icon = x.status === 'valid' ? '✅' : x.status === 'perlu_perbaikan' ? '⚠️' : x.status === 'tidak_sesuai' ? '❌' : x.status === 'perlu_review_manual' ? '🔍' : '⬜';
    return `${icon} ${x.name}: ${x.status ?? 'belum diunggah'}`;
  });
  return reply(session,
    `Rekap dokumen Anda:\n${lines.join('\n')}\n\nKetik "selesai" untuk mengakhiri, atau unggah ulang dokumen yang perlu diperbaiki (sebutkan nama dokumennya).`);
}

function fileMatchesDoc(originalname, docKey) {
  const n = normalize(originalname).replace(/[^a-z0-9]+/g, '_');
  return n.includes(docKey);
}

async function handleCollecting(session, { text, files }) {
  const cur = session.deps.models.getSession(session.id);
  const prof = getProfession(cur.profession);
  const doc = prof.documents[cur.currentIndex];
  const { llm } = session.deps;

  if (files.length > 0) {
    const file = files.find((f) => fileMatchesDoc(f.originalname, doc.key));
    if (!file) {
      return reply(session, `File yang Anda kirim tidak sesuai dengan dokumen yang diminta: ${doc.name}. Mohon unggah dokumen yang benar (beri nama file sesuai dokumen, misal ${doc.key}.pdf).`);
    }
    const { analyzeDocument } = require('./analyzer');
    const result = await analyzeDocument({
      professionKey: cur.profession, docKey: doc.key,
      fileBuffer: file.buffer, mimeType: file.mimetype, llm,
    });
    const saved = session.deps.models.addDocument({
      sessionId: session.id, jenis: doc.key,
      path: `pending-${Date.now()}`, mime: file.mimetype,
      status: result.status, notes: JSON.stringify({ issues: result.issues, suggestions: result.suggestions }),
    });
    session.deps.onSaveDocument?.(saved, file);
    session.deps.models.updateSession(session.id, { currentIndex: cur.currentIndex + 1 });
    const next = session.deps.models.getSession(session.id);
    const feedback = `${result.feedbackText}`;
    botSay(session, feedback);
    if (next.currentIndex >= prof.documents.length) {
      session.deps.models.updateSession(session.id, { state: 'RECAP' });
      return { reply: `${feedback}\n\n${recapReply(session).reply}`, progress: progress(next, session.deps.models), state: 'RECAP' };
    }
    const nextDoc = prof.documents[next.currentIndex];
    const done = progress(next, session.deps.models).filter((p) => p.status).length;
    const ask = `Sekarang mohon unggah dokumen (${done + 1}/${prof.documents.length}): ${nextDoc.name}.`;
    botSay(session, ask);
    return { reply: `${feedback}\n\n${ask}`, progress: progress(next, session.deps.models), state: 'COLLECTING' };
  }

  if (normalize(text)) {
    return reply(session, `Mohon unggah file dokumen ${doc.name} (PDF/JPG/PNG, maks 4 MB).`);
  }
  return reply(session, `Silakan unggah dokumen ${doc.name}.`);
}

async function handleMessage({ session, text = '', files = [], deps }) {
  session.deps = deps;
  deps.models.addMessage(session.id, 'user', text || `[file: ${files.map((f) => f.originalname).join(', ')}]`);
  const cur = deps.models.getSession(session.id);

  switch (cur.state) {
    case 'GREETING': {
      const t = normalize(text);
      if (/pernah|sudah|ya\b/.test(t) && !/belum|tidak|belum pernah/.test(t)) {
        deps.models.updateSession(session.id, { state: 'ASK_CODE' });
        return reply(session, 'Baik, mohon masukkan kode sesi Anda (format KPR-XXXXXX).');
      }
      deps.models.updateSession(session.id, { state: 'PROFESSION' });
      const fresh = deps.models.getSession(session.id);
      return reply(session,
        `Halo! Saya asisten verifikasi dokumen KPR. Sebelum mulai, simpan kode sesi Anda: *${fresh.code}* — gunakan kode ini bila ingin melanjutkan di perangkat lain.\n\nApakah Anda pernah mengunggah dokumen sebelumnya? Jika belum, mari mulai. Apa profesi Anda?`,
        {
          code: fresh.code,
          options: Object.values(PROFESSIONS).map((p) => p.label),
        });
    }
    case 'ASK_CODE': {
      const t = (text || '').trim().toUpperCase();
      const target = deps.models.getSessionByCode(t);
      if (target) {
        // tandai sesi sementara ini tidak dipakai, lanjut sesi lama
        deps.models.updateSession(session.id, { state: 'DONE_ABORTED' });
        const old = deps.models.getSession(target.id);
        return {
          reply: `Sesi ditemukan. Melanjutkan sesi ${old.code} dari posisi terakhir.`,
          progress: progress(old, deps.models),
          state: old.state,
          resumeSessionId: old.id,
        };
      }
      const tries = (session.askCodeTries = (session.askCodeTries || 0) + 1);
      if (tries >= 3) {
        deps.models.updateSession(session.id, { state: 'PROFESSION' });
        return reply(session, 'Kode tidak ditemukan setelah beberapa kali. Mari mulai sesi baru. Apa profesi Anda?',
          { options: Object.values(PROFESSIONS).map((p) => p.label) });
      }
      return reply(session, 'Kode sesi tidak ditemukan. Mohon periksa lagi (format KPR-XXXXXX), atau ketik "baru" untuk memulai sesi baru.');
    }
    case 'PROFESSION': {
      if (normalize(text) === 'baru') {
        return reply(session, 'Baik, sesi baru. Apa profesi Anda?',
          { options: Object.values(PROFESSIONS).map((p) => p.label) });
      }
      const key = matchProfession(text);
      if (!key) {
        return reply(session, 'Maaf, saya belum paham. Silakan pilih profesi Anda:',
          { options: Object.values(PROFESSIONS).map((p) => p.label) });
      }
      deps.models.updateSession(session.id, { profession: key, state: 'CHECKLIST' });
      const prof = getProfession(key);
      const list = prof.documents.map((d) => `  - ${d.name}`).join('\n');
      botSay(session, `Berikut dokumen yang perlu Anda siapkan untuk profesi ${prof.label}:\n${list}`);
      deps.models.updateSession(session.id, { state: 'COLLECTING' });
      return nextCollectingReply(session);
    }
    case 'CHECKLIST':
      deps.models.updateSession(session.id, { state: 'COLLECTING' });
      return nextCollectingReply(session);
    case 'COLLECTING':
      return handleCollecting(session, { text, files });
    case 'RECAP': {
      const t = normalize(text);
      if (/selesai|sudah|cukup/.test(t) && files.length === 0) {
        deps.models.updateSession(session.id, { state: 'DONE' });
        const code = deps.models.getSession(session.id).code;
        return reply(session, `Terima kasih! Verifikasi dokumen Anda selesai. Kode sesi Anda ${code} — simpan untuk keperluan selanjutnya.`);
      }
      if (files.length > 0 || t) return handleRecapReupload(session, { text, files });
      return recapReply(session);
    }
    case 'DONE':
      return reply(session, 'Verifikasi sudah selesai. Terima kasih!');
    default:
      deps.models.updateSession(session.id, { state: 'GREETING' });
      return reply(session, 'Halo! Saya asisten verifikasi dokumen KPR. Ada yang bisa saya bantu?');
  }
}

function handleRecapReupload(session, { text, files }) {
  const cur = session.deps.models.getSession(session.id);
  const prof = getProfession(cur.profession);
  if (files.length > 0) {
    // cari dokumen yang dituju dari nama file, lalu analisis ulang
    const target = prof.documents.find((d) => files.some((f) => fileMatchesDoc(f.originalname, d.key)));
    const doc = target ?? prof.documents[cur.currentIndex - 1] ?? prof.documents[0];
    const { analyzeDocument } = require('./analyzer');
    return analyzeDocument({
      professionKey: cur.profession, docKey: doc.key,
      fileBuffer: files[0].buffer, mimeType: files[0].mimetype, llm: session.deps.llm,
    }).then((result) => {
      const prev = session.deps.models.getDocuments(session.id).find((x) => x.jenis === doc.key);
      if (prev) session.deps.models.updateDocument(prev.id, { status: result.status, notes: JSON.stringify({ issues: result.issues, suggestions: result.suggestions }) });
      else session.deps.models.addDocument({ sessionId: session.id, jenis: doc.key, path: `pending-${Date.now()}`, mime: files[0].mimetype, status: result.status, notes: JSON.stringify({ issues: result.issues, suggestions: result.suggestions }) });
      botSay(session, result.feedbackText);
      return { reply: `${result.feedbackText}\n\n${recapReply(session).reply}`, progress: progress(session.deps.models.getSession(session.id), session.deps.models), state: 'RECAP' };
    });
  }
  return recapReply(session);
}

module.exports = { newSessionId, newSessionCode, startNewSession, handleMessage, progress };
```

- [ ] **Step 4: Jalankan test — perbaiki sampai lulus**

Run: `npm test`
Expected: PASS (semua test, termasuk Task 1–5).

- [ ] **Step 5: Commit**

```bash
git add src/services/stateMachine.js tests/stateMachine.test.js
git commit -m "feat: state machine wizard percakapan kpr"
```

---

### Task 7: Routes Session & Chat (multipart, penyimpanan file)

**Files:**
- Create: `src/routes/session.js`
- Create: `src/routes/chat.js`
- Modify: `server.js` (pasang router)
- Test: `tests/routes.test.js`

**Interfaces:**
- Consumes: `models` (Task 2), `stateMachine` (Task 6), `gemini.generateContent` (Task 4) untuk LLM produksi.
- Produces:
  - `POST /api/session` — body `{ code? }`, cookie `kpr_session`. Respons `{ resumed: bool, messages, state, progress, code? }`. Cookie token baru selalu di-set; bila `code` valid → state/riwayat diambil dari sesi kode tersebut.
  - `POST /api/chat` — multipart: fields `message` (string, opsional), `files` (0–4 file, ≤ 4 MB, PDF/JPG/PNG). Respons `{ reply, options?, code?, progress, state }`. Sesi dicari dari cookie; tanpa sesi valid → HTTP 401 `{ error: 'NO_SESSION' }`.
  - `handleMessage` menerima `deps.onSaveDocument(doc, file)` — route memakainya untuk menulis file ke `src/uploads/<sessionId>/<jenis>-<timestamp>.<ext>` lalu memperbarui path dokumen.

- [ ] **Step 1: Tulis test routes**

`tests/routes.test.js`:

```js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const db = require('../src/db/sqlite');
const models = require('../src/db/models');
const sm = require('../src/services/stateMachine');

// injeksi LLM fake: modul gemini di-stub lewat environment path
// cara termudah: chat.js memanggil sm.handleMessage dengan deps.llm dari ./gemini
// untuk test kita PATCH modul gemini dengan require.cache
const geminiPath = require.resolve('../src/services/gemini');
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: { generateContent: async () => ({ text: JSON.stringify({ status: 'valid', issues: [], suggestions: [] }) }) },
};

const { app } = require('../server');

beforeEach(() => {
  db.exec('DELETE FROM sessions; DELETE FROM messages; DELETE FROM documents;');
});

test('POST /api/session baru → kode sesi & cookie', async () => {
  const res = await request(app).post('/api/session').send({});
  assert.equal(res.status, 200);
  assert.match(res.body.code, /^KPR-/);
  assert.equal(res.body.resumed, false);
  assert.ok(res.headers['set-cookie'][0].includes('HttpOnly'));
});

test('POST /api/session dengan kode valid → resume', async () => {
  const first = await request(app).post('/api/session').send({});
  const code = first.body.code;
  // buat sesi kedua lalu resume pakai kode
  const second = await request(app).post('/api/session').send({ code });
  assert.equal(second.status, 200);
  assert.equal(second.body.resumed, true);
  assert.equal(second.body.code, code);
});

test('POST /api/chat tanpa sesi → 401', async () => {
  const res = await request(app).post('/api/chat').field('message', 'halo');
  assert.equal(res.status, 401);
});

test('POST /api/chat alur lengkap: sapa → profesi → upload ktp', async () => {
  const s = await request(app).post('/api/session').send({});
  const cookie = s.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');

  const r1 = await request(app).post('/api/chat').set('Cookie', cookie).field('message', 'belum pernah');
  assert.equal(r1.body.state, 'PROFESSION');

  const r2 = await request(app).post('/api/chat').set('Cookie', cookie).field('message', 'karyawan');
  assert.equal(r2.body.state, 'COLLECTING');
  assert.ok(r2.body.reply.includes('KTP'));

  const r3 = await request(app).post('/api/chat').set('Cookie', cookie)
    .field('message', '')
    .attach('files', Buffer.from('pngdata'), { filename: 'ktp.png', contentType: 'image/png' });
  assert.equal(r3.body.state, 'COLLECTING');
  assert.ok(r3.body.reply.includes('valid'));
  const docs = models.getDocuments(models.getSessionByCode(s.body.code).id);
  assert.equal(docs[0].status, 'valid');
  assert.match(docs[0].path, /uploads[/\\]/);
});

test('POST /api/chat menolak file > 4 MB dan tipe terlarang', async () => {
  const s = await request(app).post('/api/session').send({});
  const cookie = s.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  const big = Buffer.alloc(5 * 1024 * 1024, 7);
  const res1 = await request(app).post('/api/chat').set('Cookie', cookie)
    .field('message', '').attach('files', big, { filename: 'ktp.png', contentType: 'image/png' });
  assert.equal(res1.status, 400);
  const res2 = await request(app).post('/api/chat').set('Cookie', cookie)
    .field('message', '').attach('files', Buffer.from('x'), { filename: 'virus.exe', contentType: 'application/octet-stream' });
  assert.equal(res2.status, 400);
});
```

- [ ] **Step 2: Jalankan test — gagal**

Run: `npm test`
Expected: FAIL (route belum ada → 404).

- [ ] **Step 3: Implementasi routes**

`src/routes/session.js`:

```js
const express = require('express');
const crypto = require('node:crypto');
const models = require('../db/models');
const sm = require('../services/stateMachine');
const gemini = require('../services/gemini');

const router = express.Router();
const deps = { models, llm: gemini };
const COOKIE = 'kpr_session';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // detik

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((c) => c.trim().split('=').map(decodeURIComponent)).filter((p) => p[0]));
}

router.post('/api/session', (req, res) => {
  const code = (req.body?.code || '').trim().toUpperCase();
  let token = parseCookies(req)[COOKIE];
  let session = token ? models.getSessionByToken(token) : undefined;
  let resumed = false;

  if (code) {
    const target = models.getSessionByCode(code);
    if (target) {
      session = target;
      token = target.cookie_token;
      resumed = true;
    }
  }

  if (!session) {
    token = crypto.randomUUID();
    session = sm.startNewSession({ cookieToken: token, deps });
  }

  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`);
  const messages = models.getMessages(session.id).map((m) => ({ role: m.role, content: m.content }));
  res.json({
    resumed,
    code: session.code,
    state: session.state,
    messages,
    progress: sm.progress(session, models),
  });
});

module.exports = { router, parseCookies, COOKIE };
```

`src/routes/chat.js`:

```js
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const db = require('../db/sqlite');
const models = require('../db/models');
const sm = require('../services/stateMachine');
const gemini = require('../services/gemini');
const { parseCookies, COOKIE } = require('./session');

const router = express.Router();
const deps = { models, llm: gemini };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 4 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimetype);
    cb(ok ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname), ok);
  },
});

function chatErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload ditolak: ${err.message}. Maksimal 4 file, masing-masing 4 MB, format PDF/JPG/PNG.` });
  }
  next(err);
}

router.post('/api/chat', upload.array('files', 4), chatErrorHandler, async (req, res, next) => {
  try {
    const token = parseCookies(req)[COOKIE];
    const session = token ? models.getSessionByToken(token) : undefined;
    if (!session) return res.status(401).json({ error: 'NO_SESSION' });

    const files = (req.files || []).map((f) => ({ buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname }));

    // onSaveDocument: tulis file ke uploads setelah baris dokumen tersimpan
    const onSaveDocument = (docRow, file) => {
      const ext = file.mimetype === 'application/pdf' ? 'pdf' : file.mimetype === 'image/png' ? 'png' : 'jpg';
      const rel = path.join('uploads', session.id, `${docRow.jenis}-${Date.now()}.${ext}`);
      fs.mkdirSync(path.join(__dirname, '..', 'uploads', session.id), { recursive: true });
      fs.writeFileSync(path.join(__dirname, '..', rel), file.buffer);
      db.prepare('UPDATE documents SET path = ? WHERE id = ?').run(rel, docRow.id);
    };

    const result = await sm.handleMessage({
      session: models.getSession(session.id),
      text: req.body.message || '',
      files,
      deps: { ...deps, onSaveDocument },
    });

    if (result.resumeSessionId) {
      // pindahkan cookie ke sesi lama agar chat berikutnya memakai sesi itu
      const target = models.getSession(result.resumeSessionId);
      res.setHeader('Set-Cookie',
        `${COOKIE}=${encodeURIComponent(target.cookie_token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`);
    }

    const codeSession = result.resumeSessionId ? models.getSession(result.resumeSessionId) : session;
    res.json({
      reply: result.reply,
      options: result.options,
      code: result.code ?? codeSession.code,
      progress: result.progress,
      state: result.state,
    });
  } catch (err) {
    if (err.message === 'LLM_UNAVAILABLE') {
      return res.status(503).json({ error: 'Layanan analisis sedang tidak tersedia. Dokumen Anda tersimpan; silakan coba kirim ulang nanti.' });
    }
    next(err);
  }
});

module.exports = { router };
```

Modify `server.js` — tambahkan sebelum `module.exports`:

```js
const { router: sessionRouter } = require('./src/routes/session');
const { router: chatRouter } = require('./src/routes/chat');
app.use(sessionRouter);
app.use(chatRouter);
```

- [ ] **Step 4: Jalankan test**

Run: `npm test`
Expected: PASS (semua test).

- [ ] **Step 5: Commit**

```bash
git add src/routes server.js tests/routes.test.js
git commit -m "feat: routes session dan chat dengan upload multipart"
```

---

### Task 8: Frontend Chat (vanilla JS)

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`
- Create: `public/app.js`
- Test: manual smoke test (langkah 5) — UI divalidasi dengan menjalankan server dan membuka browser; perilaku inti sudah tercover test routes.

**Interfaces:**
- Consumes: `POST /api/session`, `POST /api/chat`, respons `{ reply, options?, code?, progress, state }`, cookie otomatis via `credentials: 'same-origin'`.
- Produces: halaman chat dengan: bubble bot/user, tombol `options`, input file (multiple, accept pdf/png/jpg), indikator progress checklist, banner kode sesi.

- [ ] **Step 1: Buat index.html**

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Asisten Dokumen KPR</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="chat-app">
    <header class="chat-header">
      <h1>Asisten Dokumen KPR</h1>
      <span id="session-code" class="session-code" title="Simpan kode ini untuk lanjut di perangkat lain"></span>
    </header>
    <div id="messages" class="messages"></div>
    <div id="options" class="options"></div>
    <div id="progress" class="progress"></div>
    <form id="chat-form" class="chat-form">
      <label class="attach" for="file-input" title="Lampirkan dokumen">📎</label>
      <input id="file-input" type="file" multiple accept=".pdf,.png,.jpg,.jpeg" hidden />
      <span id="file-names" class="file-names"></span>
      <input id="text-input" type="text" placeholder="Ketik pesan…" autocomplete="off" />
      <button type="submit">Kirim</button>
    </form>
  </main>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Buat style.css**

```css
* { box-sizing: border-box; margin: 0; }
body { font-family: system-ui, sans-serif; background: #f0f2f5; height: 100vh; }
.chat-app { max-width: 640px; margin: 0 auto; height: 100vh; display: flex; flex-direction: column; background: #fff; }
.chat-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #1a5f2a; color: #fff; }
.session-code { font-family: monospace; background: rgba(255,255,255,.2); padding: 2px 8px; border-radius: 6px; }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; white-space: pre-wrap; }
.msg.bot { align-self: flex-start; background: #e8e8e8; }
.msg.user { align-self: flex-end; background: #1a5f2a; color: #fff; }
.options { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 8px; }
.options button { padding: 8px 14px; border: 1px solid #1a5f2a; background: #fff; color: #1a5f2a; border-radius: 18px; cursor: pointer; }
.progress { padding: 4px 16px 8px; font-size: 12px; color: #555; }
.chat-form { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #ddd; }
.chat-form input[type="text"] { flex: 1; padding: 10px 12px; border: 1px solid #ccc; border-radius: 20px; }
.chat-form button { padding: 10px 18px; border: 0; border-radius: 20px; background: #1a5f2a; color: #fff; cursor: pointer; }
.attach { font-size: 20px; cursor: pointer; align-self: center; }
.file-names { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; align-self: center; font-size: 12px; color: #666; }
```

- [ ] **Step 3: Buat app.js**

```js
const $ = (sel) => document.querySelector(sel);
const messagesEl = $('#messages');
const optionsEl = $('#options');
const progressEl = $('#progress');
const form = $('#chat-form');
const textInput = $('#text-input');
const fileInput = $('#file-input');
const fileNamesEl = $('#file-names');

function addMessage(role, content) {
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  div.textContent = content;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderOptions(options) {
  optionsEl.innerHTML = '';
  (options || []).forEach((label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.addEventListener('click', () => send({ message: label }));
    optionsEl.appendChild(btn);
  });
}

function renderProgress(progress) {
  if (!progress || progress.length === 0) { progressEl.textContent = ''; return; }
  const icons = { valid: '✅', perlu_perbaikan: '⚠️', tidak_sesuai: '❌', perlu_review_manual: '🔍' };
  progressEl.textContent = progress.map((p) => `${icons[p.status] ?? '⬜'} ${p.key}`).join('  ');
}

function renderSessionCode(code) {
  if (code) $('#session-code').textContent = code;
}

async function send({ message = '', files = [] } = {}) {
  if (!message && files.length === 0) return;
  if (message) addMessage('user', message);
  else addMessage('user', `📎 ${files.map((f) => f.name).join(', ')}`);
  optionsEl.innerHTML = '';
  const fd = new FormData();
  fd.append('message', message);
  files.forEach((f) => fd.append('files', f));
  textInput.value = ''; fileInput.value = ''; fileNamesEl.textContent = '';
  try {
    const res = await fetch('/api/chat', { method: 'POST', body: fd, credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) { addMessage('bot', data.error || 'Terjadi kesalahan.'); return; }
    addMessage('bot', data.reply);
    renderOptions(data.options);
    renderProgress(data.progress);
    renderSessionCode(data.code);
  } catch {
    addMessage('bot', 'Tidak dapat menghubungi server. Coba lagi.');
  }
}

fileInput.addEventListener('change', () => {
  fileNamesEl.textContent = [...fileInput.files].map((f) => f.name).join(', ');
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  send({ message: textInput.value.trim(), files: [...fileInput.files] });
});

(async function init() {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    credentials: 'same-origin',
  });
  const data = await res.json();
  renderSessionCode(data.code);
  renderProgress(data.progress);
  (data.messages || []).forEach((m) => addMessage(m.role === 'bot' ? 'bot' : 'user', m.content));
  if (!data.resumed) send({ message: 'mulai' });
})();
```

> Catatan: saat init sesi baru, `send({ message: 'mulai' })` memicu sapaan bot. Sesi resume akan merender riwayat yang ada tanpa mengirim pesan.

- [ ] **Step 4: Jalankan semua test**

Run: `npm test`
Expected: PASS (semua test backend tetap lulus).

- [ ] **Step 5: Smoke test manual**

Run: `npm start`, buka `http://localhost:3000` di browser.
Expected: chat muncul, bot menyapa + kode sesi di header, pilih profesi → checklist → upload file dari `D:\Project\Chatbot\testdata\dummy-customers\persona-01\` → feedback muncul, progress terupdate. Refresh halaman → riwayat kembali (resume cookie). Simpan kode sesi, hapus cookie (DevTools), buka lagi → pilih "pernah" → masukkan kode → sesi dilanjutkan.

- [ ] **Step 6: Commit**

```bash
git add public
git commit -m "feat: frontend chat vanilla js dengan upload dan resume"
```

---

### Task 9: Hardening Akhir, .env, dan README

**Files:**
- Create: `README.md`
- Create: `src/uploads/.gitkeep`
- Modify: `.gitignore` (pastikan `src/uploads/*` kecuali `.gitkeep`)
- Test: `tests/security.test.js`

**Interfaces:**
- Consumes: seluruh aplikasi dari Task 1–8.
- Produces: aplikasi siap jalankan; `README.md` berisi cara setup `.env` (copy dari `.env.example`, isi `GEMINI_API_KEY`/`OPENROUTER_API_KEY`), cara menjalankan, cara menjalankan test, dan dokumentasi folder testdata 10 persona.

- [ ] **Step 1: Tulis test keamanan**

`tests/security.test.js`:

```js
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const db = require('../src/db/sqlite');
const { app } = require('../server');

beforeEach(() => {
  db.exec('DELETE FROM sessions; DELETE FROM messages; DELETE FROM documents;');
});

test('cookie flag HttpOnly & SameSite=Lax ter-set', async () => {
  const res = await request(app).post('/api/session').send({});
  const c = res.headers['set-cookie'][0];
  assert.ok(c.includes('HttpOnly'));
  assert.ok(c.includes('SameSite=Lax'));
});

test('file dengan nama berbahaya disimpan dengan nama generate server', async () => {
  const s = await request(app).post('/api/session').send({});
  const cookie = s.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  // jalankan alur sampai COLLECTING
  await request(app).post('/api/chat').set('Cookie', cookie).field('message', 'belum pernah');
  await request(app).post('/api/chat').set('Cookie', cookie).field('message', 'karyawan');
  const res = await request(app).post('/api/chat').set('Cookie', cookie)
    .field('message', '')
    .attach('files', Buffer.from('x'), { filename: '../../evil.png', contentType: 'image/png' });
  assert.equal(res.status, 200);
  const docs = db.prepare('SELECT path FROM documents').all();
  for (const d of docs) assert.ok(!d.path.includes('..'));
});
```

- [ ] **Step 2: Jalankan test — perbaiki bila gagal**

Run: `npm test`
Expected: PASS. Bila path masih mengandung `..`, pastikan `chat.js` hanya memakai `docRow.jenis` + timestamp + ekstensi yang di-whitelist.

- [ ] **Step 3: Rapikan .gitignore**

`.gitignore` final:

```
node_modules/
.env
src/data/
src/uploads/*
!src/uploads/.gitkeep
*.db
```

Buat `src/uploads/.gitkeep` (file kosong).

- [ ] **Step 4: Tulis README.md**

```markdown
# Chatbot Verifikasi Dokumen KPR

Chatbot web yang memandu customer mengunggah dan memverifikasi dokumen KPR sesuai profesi (Karyawan, Wiraswasta, Profesional, BUMN/PNS/Bank). Dokumen dianalisis dengan Gemini multimodal; feedback diberikan per dokumen dan direkap di akhir.

## Setup

1. `npm install`
2. `cp .env.example .env` lalu isi:
   - `GEMINI_API_KEY` — key dari Google AI Studio
   - `OPENROUTER_API_KEY` — opsional, sebagai fallback
3. `npm start` → buka http://localhost:3000

## Test

`npm test` — semua test memakai LLM mock, tidak memanggil API sungguhan.

## Data testing

10 persona dummy dengan tingkat kelengkapan bervariasi tersedia di `testdata/dummy-customers/` (lihat README di folder itu). Upload dokumen persona tersebut melalui chat untuk menguji berbagai jalur verifikasi.

## Fitur

- Guided wizard: profesi → checklist → upload per dokumen → feedback → rekap.
- Analisis dokumen LLM (PDF/JPG/PNG, maks 4 MB) dengan fallback provider.
- Resume sesi via cookie otomatis atau kode sesi (`KPR-XXXXXX`) lintas perangkat.
```

- [ ] **Step 5: Jalankan seluruh test + smoke test manual singkat**

Run: `npm test`
Expected: PASS semua.

Run: `npm start`, upload 2–3 dokumen persona-05 (wiraswasta lengkap).
Expected: feedback & rekap muncul; tidak ada error di console server.

- [ ] **Step 6: Commit**

```bash
git add README.md .gitignore src/uploads/.gitkeep tests/security.test.js
git commit -m "chore: hardening keamanan, readme, dan persiapan folder uploads"
```
