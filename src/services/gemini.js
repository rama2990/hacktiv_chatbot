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
    if (type === 'file') {
      return { type: 'file', file: { filename: 'document.pdf', file_data: dataUrl } };
    }
    return { type: 'image_url', image_url: { url: dataUrl } };
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
  const useInjected = fetchImpl !== fetch;
  const saved = globalThis.fetch;
  if (useInjected) globalThis.fetch = fetchImpl;
  try {
    try {
      return { text: await callGemini(parts) };
    } catch {
      try {
        return { text: await callOpenRouter(parts) };
      } catch {
        // Kedua provider gagal — kontrak untuk route: err.message === 'LLM_UNAVAILABLE'
        throw new Error('LLM_UNAVAILABLE');
      }
    }
  } finally {
    if (useInjected) globalThis.fetch = saved;
  }
}

module.exports = { generateContent, partToOpenAI };
