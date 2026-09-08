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
