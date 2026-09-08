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
  if (!prof) return [];
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

function botSay(deps, sessionId, text) {
  deps.models.addMessage(sessionId, 'bot', text);
}

function reply(deps, session, text, extra = {}) {
  deps.models.addMessage(session.id, 'bot', text);
  return {
    reply: text,
    progress: progress(deps.models.getSession(session.id), deps.models),
    state: deps.models.getSession(session.id).state,
    ...extra,
  };
}

const professionOptions = () => Object.values(PROFESSIONS).map((p) => p.label);

function nextDocumentAsk(deps, session, prefix = '') {
  const cur = deps.models.getSession(session.id);
  const prof = getProfession(cur.profession);
  const doc = prof.documents[cur.currentIndex];
  const done = progress(cur, deps.models).filter((p) => p.status).length;
  return `${prefix}Sekarang mohon unggah dokumen (${done + 1}/${prof.documents.length}): ${doc.name}. Format PDF/JPG/PNG, maksimal 4 MB.`;
}

function recapReply(deps, session, prefix = '') {
  const cur = deps.models.getSession(session.id);
  const p = progress(cur, deps.models);
  const lines = p.map((x) => {
    const icon = x.status === 'valid' ? '✅' : x.status === 'perlu_perbaikan' ? '⚠️' : x.status === 'tidak_sesuai' ? '❌' : x.status === 'perlu_review_manual' ? '🔍' : '⬜';
    return `${icon} ${x.name}: ${x.status ?? 'belum diunggah'}`;
  });
  return reply(deps, session,
    `${prefix}Rekap dokumen Anda:\n${lines.join('\n')}\n\nKetik "selesai" untuk mengakhiri, atau unggah ulang dokumen yang perlu diperbaiki (beri nama file sesuai dokumennya).`);
}

function fileMatchesDoc(originalname, docKey) {
  const n = normalize(originalname).replace(/[^a-z0-9]+/g, '_');
  return n.includes(docKey);
}

async function handleCollecting(deps, session, { text, files }) {
  const cur = deps.models.getSession(session.id);
  const prof = getProfession(cur.profession);
  const doc = prof.documents[cur.currentIndex];

  if (files.length > 0) {
    const file = files.find((f) => fileMatchesDoc(f.originalname, doc.key));
    if (!file) {
      return reply(deps, session,
        `File yang Anda kirim tidak sesuai dengan dokumen yang diminta: ${doc.name}. Mohon unggah ${doc.name} (beri nama file sesuai dokumen, misal ${doc.key}.pdf).`);
    }
    const { analyzeDocument } = require('./analyzer');
    const result = await analyzeDocument({
      professionKey: cur.profession,
      docKey: doc.key,
      fileBuffer: file.buffer,
      mimeType: file.mimetype,
      llm: deps.llm,
    });
    const docRow = deps.models.addDocument({
      sessionId: session.id,
      jenis: doc.key,
      path: `pending-${Date.now()}`,
      mime: file.mimetype,
      status: result.status,
      notes: JSON.stringify({ issues: result.issues, suggestions: result.suggestions }),
    });
    if (deps.onSaveDocument) deps.onSaveDocument(docRow, file);
    deps.models.updateSession(session.id, { currentIndex: cur.currentIndex + 1 });
    const next = deps.models.getSession(session.id);
    const feedback = result.feedbackText;
    botSay(deps, session.id, feedback);
    if (next.currentIndex >= prof.documents.length) {
      deps.models.updateSession(session.id, { state: 'RECAP' });
      return recapReply(deps, session, `${feedback}\n\n`);
    }
    const nextDoc = prof.documents[next.currentIndex];
    const done = progress(next, deps.models).filter((p) => p.status).length;
    const ask = `Sekarang mohon unggah dokumen (${done + 1}/${prof.documents.length}): ${nextDoc.name}.`;
    botSay(deps, session.id, ask);
    return {
      reply: `${feedback}\n\n${ask}`,
      progress: progress(next, deps.models),
      state: 'COLLECTING',
    };
  }

  if (normalize(text)) {
    return reply(deps, session, `Mohon unggah file dokumen ${doc.name} (PDF/JPG/PNG, maks 4 MB).`);
  }
  return reply(deps, session, `Silakan unggah dokumen ${doc.name}.`);
}

function handleRecapReupload(deps, session, { text, files }) {
  const cur = deps.models.getSession(session.id);
  const prof = getProfession(cur.profession);
  if (files.length > 0) {
    const target = prof.documents.find((d) => files.some((f) => fileMatchesDoc(f.originalname, d.key)));
    const doc = target ?? prof.documents[(cur.currentIndex || 1) - 1] ?? prof.documents[0];
    const { analyzeDocument } = require('./analyzer');
    return analyzeDocument({
      professionKey: cur.profession,
      docKey: doc.key,
      fileBuffer: files[0].buffer,
      mimeType: files[0].mimetype,
      llm: deps.llm,
    }).then((result) => {
      const prev = deps.models.getDocuments(session.id).find((x) => x.jenis === doc.key);
      const notes = JSON.stringify({ issues: result.issues, suggestions: result.suggestions });
      if (prev) {
        deps.models.updateDocument(prev.id, { status: result.status, notes });
        const updated = deps.models.getDocuments(session.id).find((x) => x.id === prev.id);
        if (deps.onSaveDocument) deps.onSaveDocument(updated ?? prev, files[0]);
      } else {
        const docRow = deps.models.addDocument({
          sessionId: session.id, jenis: doc.key, path: `pending-${Date.now()}`,
          mime: files[0].mimetype, status: result.status, notes,
        });
        if (deps.onSaveDocument) deps.onSaveDocument(docRow, files[0]);
      }
      botSay(deps, session.id, result.feedbackText);
      return recapReply(deps, session, `${result.feedbackText}\n\n`);
    });
  }
  return recapReply(deps, session);
}

// jumlah percobaan kode sesi yang salah, per id sesi (proses berjalan)
const askCodeTries = new Map();

async function handleMessage({ session, text = '', files = [], deps }) {
  deps.models.addMessage(session.id, 'user', text || `[file: ${files.map((f) => f.originalname).join(', ')}]`);
  const cur = deps.models.getSession(session.id);

  switch (cur.state) {
    case 'GREETING': {
      const t = normalize(text);
      if (/pernah|sudah|ya\b/.test(t) && !/belum|tidak/.test(t)) {
        deps.models.updateSession(session.id, { state: 'ASK_CODE' });
        return reply(deps, session, 'Baik, mohon masukkan kode sesi Anda (format KPR-XXXXXX).');
      }
      const key = matchProfession(text);
      if (key) {
        deps.models.updateSession(session.id, { profession: key, state: 'COLLECTING' });
        const prof = getProfession(key);
        const list = prof.documents.map((d) => `  - ${d.name}`).join('\n');
        botSay(deps, session.id, `Berikut dokumen yang perlu Anda siapkan untuk profesi ${prof.label}:\n${list}`);
        const fresh = deps.models.getSession(session.id);
        const full = `Simpan kode sesi Anda: *${fresh.code}* — gunakan untuk melanjutkan di perangkat lain.\n\n${nextDocumentAsk(deps, session)}`;
        botSay(deps, session.id, full);
        return {
          reply: full,
          progress: progress(fresh, deps.models),
          state: 'COLLECTING',
          code: fresh.code,
          options: professionOptions(),
        };
      }
      deps.models.updateSession(session.id, { state: 'PROFESSION' });
      const fresh = deps.models.getSession(session.id);
      return reply(deps, session,
        `Halo! Saya asisten verifikasi dokumen KPR. Simpan kode sesi Anda: *${fresh.code}* — gunakan kode ini bila ingin melanjutkan di perangkat lain.\n\nApa profesi Anda?`,
        { code: fresh.code, options: professionOptions() });
    }
    case 'ASK_CODE': {
      const t = (text || '').trim().toUpperCase();
      const target = deps.models.getSessionByCode(t);
      if (target) {
        askCodeTries.delete(session.id);
        if (target.id === session.id) {
          deps.models.updateSession(session.id, { state: 'PROFESSION' });
          return reply(deps, session, 'Ini adalah kode sesi Anda saat ini. Mari mulai: apa profesi Anda?',
            { options: professionOptions() });
        }
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
      const tries = (askCodeTries.get(session.id) || 0) + 1;
      askCodeTries.set(session.id, tries);
      if (tries >= 3) {
        askCodeTries.delete(session.id);
        deps.models.updateSession(session.id, { state: 'PROFESSION' });
        return reply(deps, session, 'Kode tidak ditemukan setelah beberapa kali. Mari mulai sesi baru. Apa profesi Anda?',
          { options: professionOptions() });
      }
      return reply(deps, session, 'Kode sesi tidak ditemukan. Mohon periksa lagi (format KPR-XXXXXX), atau ketik "baru" untuk memulai sesi baru.');
    }
    case 'PROFESSION': {
      if (normalize(text) === 'baru') {
        return reply(deps, session, 'Baik, sesi baru. Apa profesi Anda?', { options: professionOptions() });
      }
      const key = matchProfession(text);
      if (!key) {
        return reply(deps, session, 'Maaf, saya belum paham. Silakan pilih profesi Anda:', { options: professionOptions() });
      }
      deps.models.updateSession(session.id, { profession: key, state: 'COLLECTING' });
      const prof = getProfession(key);
      const list = prof.documents.map((d) => `  - ${d.name}`).join('\n');
      botSay(deps, session.id, `Berikut dokumen yang perlu Anda siapkan untuk profesi ${prof.label}:\n${list}`);
      const ask = nextDocumentAsk(deps, session);
      botSay(deps, session.id, ask);
      return {
        reply: ask,
        progress: progress(deps.models.getSession(session.id), deps.models),
        state: 'COLLECTING',
      };
    }
    case 'COLLECTING':
      return handleCollecting(deps, session, { text, files });
    case 'RECAP': {
      const t = normalize(text);
      if (/selesai|sudah|cukup/.test(t) && files.length === 0) {
        deps.models.updateSession(session.id, { state: 'DONE' });
        const code = deps.models.getSession(session.id).code;
        return reply(deps, session, `Terima kasih! Verifikasi dokumen Anda selesai. Kode sesi Anda ${code} — simpan untuk keperluan selanjutnya.`);
      }
      if (files.length > 0 || t) return handleRecapReupload(deps, session, { text, files });
      return recapReply(deps, session);
    }
    case 'DONE':
      return reply(deps, session, 'Verifikasi sudah selesai. Terima kasih!');
    default:
      deps.models.updateSession(session.id, { state: 'GREETING' });
      return reply(deps, session, 'Halo! Saya asisten verifikasi dokumen KPR. Ada yang bisa saya bantu?');
  }
}

module.exports = { newSessionId, newSessionCode, startNewSession, handleMessage, progress };
