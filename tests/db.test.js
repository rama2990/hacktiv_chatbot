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
