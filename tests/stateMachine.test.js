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

test('ASK_CODE: kode sesi sendiri -> PROFESSION dengan opsi', async () => {
  const session = models.createSession({ id: 'ss', code: 'KPR-SSS001', cookieToken: 'ts' });
  models.updateSession('ss', { state: 'ASK_CODE' });
  const res = await sm.handleMessage({ session: models.getSession('ss'), text: 'KPR-SSS001', deps: fakeDots() });
  assert.equal(res.state, 'PROFESSION');
  assert.ok(res.reply.includes('saat ini'));
  assert.ok(res.options.length >= 4);
});
