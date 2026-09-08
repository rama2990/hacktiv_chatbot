// Skenario e2e TS-01..TS-14 (docs/test-scenarios/2026-09-08-kpr-document-chatbot-test-scenarios.md)
// LLM di-stub via require.cache (pola tests/routes.test.js). Perilaku stub dikendalikan
// per-test lewat `llmBehavior` / `llmImpl`.
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const request = require('supertest');
const db = require('../src/db/sqlite');
const models = require('../src/db/models');

process.env.RATE_LIMIT_PER_MIN = '1000000'; // test flow memicu >20 req/menit per IP

const geminiPath = require.resolve('../src/services/gemini');
let llmBehavior = () => JSON.stringify({ status: 'valid', issues: [], suggestions: [] });
let llmImpl = null; // override penuh (mis. reject untuk TS-10)
let llmCalls = 0;
require.cache[geminiPath] = {
  id: geminiPath, filename: geminiPath, loaded: true,
  exports: {
    generateContent: async (args) => {
      llmCalls += 1;
      if (llmImpl) return llmImpl(args);
      return { text: llmBehavior() };
    },
  },
};

const { app } = require('../server');

const ROOT = path.join(__dirname, '..');
const P = (persona, file) => path.join(ROOT, 'testdata', 'dummy-customers', persona, file);

const VALID = JSON.stringify({ status: 'valid', issues: [], suggestions: [] });
const PERLU = (issue, sug) => JSON.stringify({ status: 'perlu_perbaikan', issues: [issue], suggestions: [sug] });
const TIDAK = (issue, sug) => JSON.stringify({ status: 'tidak_sesuai', issues: [issue], suggestions: [sug] });

const mimeOf = (name) => name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.png') ? 'image/png' : 'image/jpeg';

beforeEach(() => {
  db.exec('DELETE FROM sessions; DELETE FROM messages; DELETE FROM documents;');
  llmBehavior = () => VALID;
  llmImpl = null;
  llmCalls = 0;
});

after(() => { if (child) { try { child.kill(); } catch {} } });

// ---------- helpers ----------
const cookieOf = (res) => res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');

async function newSession() {
  const res = await request(app).post('/api/session').send({});
  return { res, cookie: cookieOf(res), code: res.body.code };
}

async function chat(cookie, message, files = []) {
  let req = request(app).post('/api/chat').set('Cookie', cookie).field('message', message || '');
  for (const f of files) {
    const src = f.buf !== undefined ? f.buf : fs.createReadStream(f.p);
    req = req.attach('files', src, { filename: f.name, contentType: f.mime || mimeOf(f.name) });
  }
  return req;
}

async function startProfession(cookie, profText) {
  await chat(cookie, 'belum pernah');
  return chat(cookie, profText);
}

// Fixture persona-01: semua file asli; surat_nikah tidak tersedia di testdata (sintetis).
const P01 = {
  ktp: { p: P('persona-01', 'ktp.png'), name: 'ktp.png' },
  kartu_keluarga: { p: P('persona-01', 'kartu-keluarga.png'), name: 'kartu_keluarga.png' },
  npwp: { p: P('persona-01', 'npwp.png'), name: 'npwp.png' },
  surat_nikah: { buf: Buffer.from('%PDF-1.4 dummy surat nikah'), name: 'surat_nikah.pdf' },
  slip_gaji: { p: P('persona-01', 'slip-gaji-2026-08.pdf'), name: 'slip_gaji_2026_08.pdf' },
  skk: { p: P('persona-01', 'surat-keterangan-kerja.pdf'), name: 'skk-surat-keterangan-kerja.pdf' },
  rekening_koran: { p: P('persona-01', 'rekening-koran.png'), name: 'rekening_koran.png' },
  sertifikat: { p: P('persona-01', 'sertifikat-shm.png'), name: 'sertifikat.png' },
  imb_pbg: { p: P('persona-01', 'imb-pbg.pdf'), name: 'imb_pbg.pdf' },
  pbb: { p: P('persona-01', 'pbb-sppt.pdf'), name: 'pbb_sppt.pdf' },
  ajb: { p: P('persona-01', 'ajb.pdf'), name: 'ajb.pdf' },
};

const P03 = {
  ktp: P01.ktp,
  kartu_keluarga: P01.kartu_keluarga,
  npwp: P01.npwp, // persona-03 tidak punya npwp — pakai file persona-01 (adaptasi)
  surat_nikah: P01.surat_nikah,
  slip_gaji: { p: P('persona-03', 'slip-gaji-2026-06.pdf'), name: 'slip_gaji_2026_06.pdf' },
  skk: { p: P('persona-03', 'surat-keterangan-kerja.pdf'), name: 'skk-surat-keterangan-kerja.pdf' },
  rekening_koran: P01.rekening_koran, // persona-03 tidak punya — pakai file persona-01 (adaptasi)
  // persona-03 tidak punya file properti/nikah — buffer sintetis (adaptasi)
  sertifikat: { buf: Buffer.from('%PDF-1.4 dummy sertifikat'), name: 'sertifikat.pdf' },
  imb_pbg: { buf: Buffer.from('%PDF-1.4 dummy imb'), name: 'imb_pbg.pdf' },
  pbb: { buf: Buffer.from('%PDF-1.4 dummy pbb'), name: 'pbb_sppt.pdf' },
  ajb: { buf: Buffer.from('%PDF-1.4 dummy ajb'), name: 'ajb.pdf' },
};

const KARYAWAN_ORDER = ['ktp', 'kartu_keluarga', 'npwp', 'surat_nikah', 'slip_gaji', 'skk', 'rekening_koran', 'sertifikat', 'imb_pbg', 'pbb', 'ajb'];

async function fullKaryawanFlow(filesFor, statusFor = () => VALID) {
  const s = await newSession();
  await chat(s.cookie, 'belum pernah');
  await chat(s.cookie, 'karyawan');
  let last;
  for (const key of KARYAWAN_ORDER) {
    llmBehavior = () => statusFor(key);
    last = await chat(s.cookie, '', [filesFor(key)]);
  }
  llmBehavior = () => VALID;
  return { ...s, last };
}

// ---------- TS-01 ----------
test('TS-01: sesi baru → kode KPR-XXXXXX + cookie httpOnly/SameSite=Lax/30 hari, kode tampil saat sapa', async () => {
  const s = await newSession();
  assert.equal(s.res.status, 200);
  assert.equal(s.res.body.resumed, false);
  assert.match(s.res.body.code, /^KPR-[A-Z2-9]{6}$/);
  const cookie = s.res.headers['set-cookie'][0];
  assert.ok(cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax') && cookie.includes('Max-Age=2592000'), cookie);

  const r = await chat(s.cookie, 'belum pernah');
  assert.ok(r.body.reply.includes('Simpan kode sesi Anda'), r.body.reply);
  assert.ok(r.body.reply.includes(s.res.body.code), 'kode sesi tampil di balasan');
  assert.equal(r.body.code, s.res.body.code);
  // IMPLEMENTASI: state lanjut ke PROFESSION (prosedur: tetap GREETING) — deviasi semantik
  assert.equal(r.body.state, 'PROFESSION');
});

// ---------- TS-02 ----------
test('TS-02: resume otomatis via cookie → state & progress dimuat, tidak ada sesi baru', async () => {
  const s = await newSession();
  await chat(s.cookie, 'belum pernah');
  await chat(s.cookie, 'karyawan');
  const up = await chat(s.cookie, '', [P01.ktp]);
  assert.equal(up.body.state, 'COLLECTING');

  const r = await request(app).post('/api/session').set('Cookie', s.cookie).send({});
  assert.equal(r.status, 200);
  assert.equal(r.body.code, s.code, 'kode sama → tidak ada sesi baru');
  assert.equal(r.body.state, 'COLLECTING');
  assert.ok(r.body.messages.length > 0, 'riwayat dimuat');
  assert.equal(r.body.progress[0].key, 'ktp');
  assert.equal(r.body.progress[0].status, 'valid');
  // IMPLEMENTASI: flag `resumed` hanya true untuk resume via kode, bukan cookie
  assert.equal(r.body.resumed, false);
});

test('TS-02 varian: persona-10 (BUMN/PNS) baru KTP+KK → lanjut checklist BUMN berikutnya', async () => {
  const s = await newSession();
  await chat(s.cookie, 'belum pernah');
  await chat(s.cookie, 'pns');
  await chat(s.cookie, '', [{ p: P('persona-10', 'ktp.png'), name: 'ktp.png' }]);
  await chat(s.cookie, '', [{ p: P('persona-10', 'kartu-keluarga.png'), name: 'kartu_keluarga.png' }]);

  const r = await request(app).post('/api/session').set('Cookie', s.cookie).send({});
  assert.equal(r.body.state, 'COLLECTING');
  const keys = r.body.progress.map((x) => x.key);
  assert.ok(keys.includes('sk_pengangkatan') && keys.includes('sk_pangkat'), 'checklist BUMN');
  assert.equal(r.body.progress.find((x) => x.key === 'ktp').status, 'valid');
  assert.equal(r.body.progress.find((x) => x.key === 'kartu_keluarga').status, 'valid');
  assert.equal(r.body.progress.find((x) => x.key === 'sk_pengangkatan').status, null);
});

test('TS-02 varian: cookie dengan sesi DONE → IMPLEMENTASI tetap resume (prosedur: mulai sesi baru)', async () => {
  const s = await fullKaryawanFlow((key) => P01[key]);
  await chat(s.cookie, 'selesai');
  const r = await request(app).post('/api/session').set('Cookie', s.cookie).send({});
  // IMPLEMENTASI: lookup cookie tidak mengecek state DONE → sesi lama diresume
  assert.equal(r.body.code, s.code);
  assert.equal(r.body.state, 'DONE');
});

// ---------- TS-03 ----------
test('TS-03: resume manual via kode sesi valid di perangkat baru', async () => {
  const a = await newSession();
  await chat(a.cookie, 'belum pernah');
  await chat(a.cookie, 'karyawan'); // state COLLECTING, ktp belum dikirim

  const b = await newSession();
  const r1 = await chat(b.cookie, 'pernah');
  assert.equal(r1.body.state, 'ASK_CODE');
  assert.ok(r1.body.reply.includes('kode sesi'), r1.body.reply);

  const r2 = await chat(b.cookie, a.code);
  assert.ok(r2.body.reply.includes('Sesi ditemukan'), r2.body.reply);
  assert.equal(r2.body.state, 'COLLECTING');
  const newCookie = cookieOf(r2);
  assert.ok(newCookie.includes('kpr_session='), 'cookie baru ditunjuk ke sesi lama');

  const r3 = await chat(newCookie, '', [P01.ktp]);
  assert.equal(r3.body.state, 'COLLECTING');
  const docs = models.getDocuments(models.getSessionByCode(a.code).id);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].jenis, 'ktp');
});

// ---------- TS-04 ----------
test('TS-04: kode sesi salah 3× → 2× minta ulang, ke-3 tawaran mulai sesi baru', async () => {
  const s = await newSession();
  await chat(s.cookie, 'pernah');
  const r1 = await chat(s.cookie, 'KPR-XXXXXX');
  assert.ok(r1.body.reply.includes('Kode sesi tidak ditemukan'), r1.body.reply);
  const r2 = await chat(s.cookie, 'KPR-XXXXXX');
  assert.ok(r2.body.reply.includes('Kode sesi tidak ditemukan'), r2.body.reply);
  const r3 = await chat(s.cookie, 'KPR-XXXXXX');
  assert.ok(r3.body.reply.includes('Mari mulai sesi baru'), r3.body.reply);
  assert.ok(Array.isArray(r3.body.options) && r3.body.options.length === 4, 'tombol pilihan profesi');
  assert.equal(r3.body.state, 'PROFESSION');
});

// ---------- TS-05 ----------
test('TS-05: persona-07 → Profesional, checklist & minta dokumen pertama', async () => {
  const s = await newSession();
  const r = await startProfession(s.cookie, 'profesional');
  assert.equal(r.body.state, 'COLLECTING');
  assert.ok(r.body.reply.includes('KTP'), r.body.reply);
  const keys = r.body.progress.map((x) => x.key);
  assert.ok(keys.includes('sip') && keys.includes('rekening_koran') && keys.includes('sertifikat'), 'checklist Profesional');
  const msgs = models.getMessages(models.getSessionByCode(s.code).id).map((m) => m.content);
  assert.ok(msgs.some((m) => m.includes('Surat Izin Praktik (SIP)')), 'checklist tampil');
});

test('TS-05: persona-09 → PNS, SK pengangkatan + SK pangkat di checklist', async () => {
  const s = await newSession();
  const r = await startProfession(s.cookie, 'pns');
  assert.equal(r.body.state, 'COLLECTING');
  const keys = r.body.progress.map((x) => x.key);
  assert.ok(keys.includes('sk_pengangkatan') && keys.includes('sk_pangkat'), 'checklist BUMN/PNS');
});

test('TS-05: persona-10 → Karyawan BUMN, checklist tampil meski hampir semua dokumen belum ada', async () => {
  const s = await newSession();
  const r = await startProfession(s.cookie, 'bumn');
  assert.equal(r.body.state, 'COLLECTING');
  assert.equal(r.body.progress.filter((x) => x.status).length, 0);
  assert.ok(r.body.progress.length >= 10, 'checklist BUMN lengkap');
});

test('TS-05 varian: teks tak dikenal → bot tanya ulang (IMPLEMENTASI: tanpa batas 2×)', async () => {
  const s = await newSession();
  await chat(s.cookie, 'belum pernah');
  const r = await chat(s.cookie, 'pramugara');
  assert.ok(r.body.reply.includes('belum paham'), r.body.reply);
  assert.ok(Array.isArray(r.body.options), 'arahkan ke tombol pilihan');
  const r2 = await chat(s.cookie, 'astronaut');
  assert.ok(r2.body.reply.includes('belum paham'), r2.body.reply);
});

// ---------- TS-06 ----------
test('TS-06a: persona-01 ktp.png valid → feedback positif, tersimpan dengan nama server, minta dokumen berikutnya', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  const r = await chat(s.cookie, '', [P01.ktp]);
  assert.equal(r.body.state, 'COLLECTING');
  assert.ok(r.body.reply.includes('✅'), r.body.reply);
  assert.ok(r.body.reply.includes('Kartu Keluarga'), 'minta dokumen berikutnya');
  const row = models.getDocuments(models.getSessionByCode(s.code).id)[0];
  assert.equal(row.status, 'valid');
  assert.match(row.path, /^uploads[/\\][0-9a-f-]+[/\\]ktp-\d+\.png$/, `nama generate server, bukan asli: ${row.path}`);
  assert.ok(!row.path.includes('..'), 'aman dari path traversal');
});

test('TS-06b: persona-02 slip gaji lama → perlu_perbaikan, issue & saran tampil, status tercatat', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  for (const key of ['ktp', 'kartu_keluarga', 'npwp', 'surat_nikah']) await chat(s.cookie, '', [P01[key]]);
  const issue = 'Slip gaji lebih dari 4 bulan (2026-02), tidak memenuhi syarat 3 bulan terakhir.';
  const sug = 'Kirimkan slip gaji bulan terbaru.';
  llmBehavior = () => PERLU(issue, sug);
  const r = await chat(s.cookie, '', [{ p: P('persona-02', 'slip-gaji-2026-02.pdf'), name: 'slip_gaji_2026_02.pdf' }]);
  assert.ok(r.body.reply.includes('⚠️'), r.body.reply);
  assert.ok(r.body.reply.includes(issue), 'issue tampil di balasan bot');
  assert.ok(r.body.reply.includes(sug), 'saran tampil di balasan bot');
  const row = models.getDocuments(models.getSessionByCode(s.code).id).find((d) => d.jenis === 'slip_gaji');
  assert.equal(row.status, 'perlu_perbaikan');
  assert.ok(row.notes.includes('Slip gaji'), 'issue tercatat di DB');
});

test('TS-06c: persona-04 SK kerja ejaan "Hendayani" → perlu_perbaikan, inkonsistensi nama', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  for (const key of ['ktp', 'kartu_keluarga', 'npwp', 'surat_nikah', 'slip_gaji']) await chat(s.cookie, '', [P01[key]]);
  const issue = 'Ejaan nama "Hendayani" pada SK kerja tidak sama dengan KTP ("Handayani").';
  llmBehavior = () => PERLU(issue, 'Perbaiki ejaan nama sesuai KTP.');
  const r = await chat(s.cookie, '', [{ p: P('persona-04', 'surat-keterangan-kerja.pdf'), name: 'skk-surat-keterangan-kerja.pdf' }]);
  assert.ok(r.body.reply.includes(issue), r.body.reply);
  const row = models.getDocuments(models.getSessionByCode(s.code).id).find((d) => d.jenis === 'skk');
  assert.equal(row.status, 'perlu_perbaikan');
});

test('TS-06d: persona-06 NIB/SIUP kedaluwarsa → tidak_sesuai', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'wiraswasta');
  for (const key of ['ktp', 'kartu_keluarga', 'npwp', 'surat_nikah']) await chat(s.cookie, '', [P01[key]]);
  const issue = 'NIB kedaluwarsa sejak 01-03-2026.';
  llmBehavior = () => TIDAK(issue, 'Perbarui NIB melalui OSS.');
  const r = await chat(s.cookie, '', [{ p: P('persona-06', 'siup-nib.pdf'), name: 'nib-siup.pdf' }]);
  assert.ok(r.body.reply.includes('❌'), r.body.reply);
  assert.ok(r.body.reply.includes(issue), r.body.reply);
  const row = models.getDocuments(models.getSessionByCode(s.code).id).find((d) => d.jenis === 'nib_siup');
  assert.equal(row.status, 'tidak_sesuai');
});

test('TS-06e: persona-08 SIP kedaluwarsa → tidak_sesuai', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'profesional');
  for (const key of ['ktp', 'kartu_keluarga', 'npwp', 'surat_nikah']) await chat(s.cookie, '', [P01[key]]);
  const issue = 'SIP sudah kedaluwarsa.';
  llmBehavior = () => TIDAK(issue, 'Ajukan perpanjangan SIP ke instansi.');
  const r = await chat(s.cookie, '', [{ p: P('persona-08', 'surat-izin-praktik.pdf'), name: 'sip-surat-izin-praktik.pdf' }]);
  assert.ok(r.body.reply.includes(issue), r.body.reply);
  const row = models.getDocuments(models.getSessionByCode(s.code).id).find((d) => d.jenis === 'sip');
  assert.equal(row.status, 'tidak_sesuai');
});

// ---------- TS-07 ----------
test('TS-07: 4 file rekening koran sekaligus → diterima 200; IMPLEMENTASI hanya 1 dianalisis (prosedur: masing-masing)', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'wiraswasta');
  for (const key of ['ktp', 'kartu_keluarga', 'npwp', 'surat_nikah']) await chat(s.cookie, '', [P01[key]]);
  await chat(s.cookie, '', [{ p: P('persona-05', 'siup-nib.pdf'), name: 'nib-siup.pdf' }]);
  await chat(s.cookie, '', [{ p: P('persona-05', 'akta-pendirian-usaha.pdf'), name: 'akta_pendirian.pdf' }]);
  await chat(s.cookie, '', [{ p: P('persona-05', 'laporan-keuangan.pdf'), name: 'laporan_keuangan.pdf' }]);

  const before = llmCalls;
  const files = [3, 4, 5, 6].map((m) => ({ p: P('persona-05', `rekening-koran-usaha-2026-0${m}.pdf`), name: `rekening_koran_usaha_2026_0${m}.pdf` }));
  const r = await chat(s.cookie, '', files);
  assert.equal(r.status, 200, 'multer menerima 4 file (tepat di batas maks)');
  assert.equal(r.body.state, 'COLLECTING');
  assert.ok(r.body.reply.includes('Rekening Koran'), 'dokumen yang diminta dianalisis');
  const rows = models.getDocuments(models.getSessionByCode(s.code).id).filter((d) => d.jenis === 'rekening_koran');
  assert.equal(rows.length, 1, 'IMPLEMENTASI: hanya 1 dokumen rekening_koran dibuat — file lain diabaikan');
  assert.equal(llmCalls - before, 1, 'hanya satu panggilan LLM');
});

// ---------- TS-08 ----------
test('TS-08a: file .docx ditolak tanpa LLM', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  const before = llmCalls;
  const r = await chat(s.cookie, '', [{ buf: Buffer.from('dummy docx'), name: 'surat.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }]);
  assert.equal(r.status, 400);
  assert.ok(r.body.error.includes('PDF/JPG/PNG'), r.body.error);
  assert.equal(llmCalls, before, 'tanpa panggilan LLM');
  assert.equal(models.getDocuments(models.getSessionByCode(s.code).id).length, 0, 'tidak ada dokumen tersimpan');
  assert.equal(models.getSessionByCode(s.code).state, 'COLLECTING');
});

test('TS-08b: file 5 MB ditolak tanpa LLM', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  const before = llmCalls;
  const r = await chat(s.cookie, '', [{ buf: Buffer.alloc(5 * 1024 * 1024, 7), name: 'ktp.png' }]);
  assert.equal(r.status, 400);
  assert.ok(r.body.error.includes('4 MB'), r.body.error);
  assert.equal(llmCalls, before, 'tanpa panggilan LLM');
  assert.equal(models.getSessionByCode(s.code).state, 'COLLECTING');
});

test('TS-08c: 5 file sekaligus ditolak tanpa LLM', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  const before = llmCalls;
  const files = Array.from({ length: 5 }, (_, i) => ({ buf: Buffer.from('x'), name: `ktp${i}.png` }));
  const r = await chat(s.cookie, '', files);
  assert.equal(r.status, 400);
  assert.ok(r.body.error.includes('Maksimal 4 file'), r.body.error);
  assert.equal(llmCalls, before, 'tanpa panggilan LLM');
  assert.equal(models.getSessionByCode(s.code).state, 'COLLECTING');
});

test('TS-08d: nama file berbahaya ../../evil.pdf → aman, tidak match dokumen, tanpa LLM', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  const before = llmCalls;
  const r = await chat(s.cookie, '', [{ buf: Buffer.from('%PDF-1.4 evil'), name: '../../evil.pdf' }]);
  assert.equal(r.status, 200);
  assert.ok(r.body.reply.includes('tidak sesuai'), r.body.reply);
  assert.equal(llmCalls, before, 'tanpa panggilan LLM');
  assert.equal(models.getDocuments(models.getSessionByCode(s.code).id).length, 0, 'tidak ada dokumen tersimpan');
  assert.equal(models.getSessionByCode(s.code).state, 'COLLECTING');
  // bukti nama generate server (dari TS-06a & upload di test lain) tidak mengandung ..
  const allPaths = db.prepare('SELECT path FROM documents').all().map((x) => x.path);
  for (const p of allPaths) assert.ok(!p.includes('..'), p);
});

// ---------- TS-09 ----------
test('TS-09: route-level — upload persona-01 ktp.png dengan stub sukses → analisis berhasil', async () => {
  // Fallback Gemini→OpenRouter (429→fallback) sudah terverifikasi di unit test
  // tests/gemini.test.js 'fallback ke OpenRouter saat Gemini error 429' — di level rute
  // modul gemini di-stub utuh, kontrak rute saja yang diuji di sini.
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  const r = await chat(s.cookie, '', [P01.ktp]);
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'COLLECTING');
  assert.ok(r.body.reply.includes('✅'), r.body.reply);
  assert.equal(models.getDocuments(models.getSessionByCode(s.code).id)[0].status, 'valid');
});

// ---------- TS-10 ----------
test('TS-10: kedua provider gagal → 503, state tetap COLLECTING, tanpa baris dokumen', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  llmImpl = async () => { throw new Error('LLM_UNAVAILABLE'); };
  const r = await chat(s.cookie, '', [P01.ktp]);
  assert.equal(r.status, 503);
  assert.ok(r.body.error.includes('tidak tersedia'), r.body.error);
  const sess = models.getSessionByCode(s.code);
  assert.equal(sess.state, 'COLLECTING');
  assert.equal(sess.current_index, 0, 'indeks dokumen tidak maju');
  assert.equal(models.getDocuments(sess.id).length, 0, 'tidak ada dokumen terverifikasi');
});

// ---------- TS-11 ----------
test('TS-11: respon LLM JSON rusak → retry sekali lalu perlu_review_manual + feedback generik', async () => {
  const s = await newSession();
  await startProfession(s.cookie, 'karyawan');
  const before = llmCalls;
  llmBehavior = () => 'Maaf, saya tidak bisa merespons dalam format apapun.';
  const r = await chat(s.cookie, '', [P01.ktp]);
  assert.equal(llmCalls - before, 2, 'retry sekali setelah percobaan pertama gagal');
  assert.equal(r.body.state, 'COLLECTING');
  assert.ok(r.body.reply.includes('belum bisa diverifikasi otomatis'), r.body.reply);
  assert.ok(r.body.reply.includes('meninjaunya secara manual'), r.body.reply);
  const row = models.getDocuments(models.getSessionByCode(s.code).id)[0];
  assert.equal(row.status, 'perlu_review_manual');
});

// ---------- TS-12 ----------
test('TS-12a: persona-01 semua dokumen valid → RECAP tampil; upload ulang npwp → dianalisis ulang, langsung kembali ke RECAP', async () => {
  const s = await fullKaryawanFlow((key) => P01[key]);
  assert.equal(s.last.body.state, 'RECAP', '11 dokumen selesai → RECAP');
  assert.ok(s.last.body.reply.includes('Rekap dokumen Anda'), s.last.body.reply);
  const recapValid = (s.last.body.reply.match(/✅/g) || []).length;
  assert.ok(recapValid >= 11, `semua baris ✅ (dapat ${recapValid})`);

  const issue = 'Alamat NPWP tidak sinkron dengan KTP.';
  llmBehavior = () => PERLU(issue, 'Perbarui alamat NPWP.');
  const r = await chat(s.cookie, '', [P01.npwp]);
  // IMPLEMENTASI: re-analisis langsung kembali ke RECAP (prosedur: lewat COLLECTING dulu)
  assert.equal(r.body.state, 'RECAP');
  assert.ok(r.body.reply.includes(issue), 'issue baru tampil di rekap');
  const row = models.getDocuments(models.getSessionByCode(s.code).id).find((d) => d.jenis === 'npwp');
  assert.equal(row.status, 'perlu_perbaikan', 'status npwp terupdate di DB');
});

test('TS-12b: persona-03 (tanpa NPWP & rekening koran asli) → RECAP menandai keduanya bermasalah', async () => {
  const statusFor = (key) => (key === 'npwp' || key === 'rekening_koran')
    ? PERLU('Dokumen bermasalah (simulasi NPWP/rekening koran tidak tersedia).', 'Lengkapi dokumen.') : VALID;
  const s = await fullKaryawanFlow((key) => P03[key], statusFor);
  assert.equal(s.last.body.state, 'RECAP');
  assert.ok(s.last.body.reply.includes('⚠️'), 'ada baris perlu_perbaikan di rekap');
  const rows = models.getDocuments(models.getSessionByCode(s.code).id);
  assert.equal(rows.find((d) => d.jenis === 'npwp').status, 'perlu_perbaikan');
  assert.equal(rows.find((d) => d.jenis === 'rekening_koran').status, 'perlu_perbaikan');
});

// ---------- TS-13 ----------
test('TS-13: "selesai" di RECAP → DONE + kode sesi ditampilkan', async () => {
  const s = await fullKaryawanFlow((key) => P01[key]);
  const r = await chat(s.cookie, 'selesai');
  assert.equal(r.body.state, 'DONE');
  assert.ok(r.body.reply.includes('Verifikasi dokumen Anda selesai'), r.body.reply);
  assert.ok(r.body.reply.includes(s.code), 'kode sesi tampil di penutup');
  assert.equal(r.body.code, s.code);
});

// ---------- TS-14 ----------
let child = null;
const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = require('node:http');

// pakai node:http (bukan global fetch) agar tidak ada keep-alive socket
// yang menahan event loop proses test sampai exit
function httpJson(method, path, { cookie, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${BASE}${path}`, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      agent: new http.Agent({ keepAlive: false }),
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), setCookie: res.headers['set-cookie'] }); }
        catch { resolve({ status: res.statusCode, body: data, setCookie: res.headers['set-cookie'] }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await httpJson('GET', '/api/health');
      if (res.status === 200) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

async function spawnServer() {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      GEMINI_API_KEY: '', // tanpa kunci → tanpa panggilan LLM nyata
      OPENROUTER_API_KEY: '',
      RATE_LIMIT_PER_MIN: '1000000',
    },
    stdio: 'ignore',
  });
  const ok = await waitHealthy();
  assert.ok(ok, 'server child process siap dalam 5s');
}

async function chatHttp(cookie, message) {
  return httpJson('POST', '/api/chat', { cookie, body: { message } });
}

test('TS-14: sesi bertahan setelah server restart (child process nyata, SQLite persist)', async () => {
  await spawnServer();
  const s = await httpJson('POST', '/api/session', { body: {} });
  const sBody = s.body;
  const cookie = (s.setCookie || [])[0]?.split(';')[0] || (s.setCookie || '').split(';')[0];
  assert.match(sBody.code, /^KPR-/);

  const r1 = await chatHttp(cookie, 'belum pernah');
  assert.equal(r1.body.state, 'PROFESSION');
  const r2 = await chatHttp(cookie, 'karyawan');
  assert.equal(r2.body.state, 'COLLECTING');

  child.kill();
  child = null;
  await sleep(500); // beri waktu port lepas di Windows

  await spawnServer(); // restart di port sama — SQLite & folder uploads diinisialisasi ulang
  const r = await httpJson('POST', '/api/session', { cookie, body: {} });
  const rBody = r.body;
  assert.equal(rBody.code, sBody.code, 'sesi sama, bukan sesi baru');
  assert.equal(rBody.state, 'COLLECTING', 'state dilanjutkan dari posisi terakhir');
  assert.ok(rBody.messages.length >= 4, 'riwayat pesan utuh dari SQLite');
  assert.equal(rBody.progress.length, KARYAWAN_ORDER.length, 'progress profesi karyawan dipulihkan');
}, { timeout: 30000 });

test('TS-14 cleanup: matikan child server setelah test', async () => {
  if (child) { try { child.kill(); } catch {} child = null; }
});
