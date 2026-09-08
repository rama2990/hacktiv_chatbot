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
