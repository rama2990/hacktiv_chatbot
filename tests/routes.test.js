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
