const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { generateContent } = require('../src/services/gemini');

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.OPENROUTER_API_KEY = 'test-or-key';
});
after(() => {
  process.env.GEMINI_API_KEY = ORIGINAL_ENV.GEMINI_API_KEY;
  process.env.OPENROUTER_API_KEY = ORIGINAL_ENV.OPENROUTER_API_KEY;
});

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
