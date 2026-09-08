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
