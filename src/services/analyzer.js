const { findDocument } = require('./checklist');

const STATUS_VALID = ['valid', 'perlu_perbaikan', 'tidak_sesuai'];

function buildPrompt(doc, professionLabel) {
  const rules = doc.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
  return `Kamu adalah petugas verifikasi dokumen KPR di bank. Periksa dokumen "${doc.name}" milik calon debitur berprofesi ${professionLabel}.

Aturan pemeriksaan:
${rules}

Periksa gambar/PDF yang dilampirkan terhadap aturan di atas. Balas HANYA dengan JSON (tanpa teks lain) dalam format:
{"status": "valid" | "perlu_perbaikan" | "tidak_sesuai", "issues": ["masalah yang ditemukan"], "suggestions": ["saran perbaikan"]}

Kriteria status:
- "valid": dokumen memenuhi semua aturan.
- "perlu_perbaikan": dokumen ada tapi ada kelemahan yang bisa diperbaiki (usia, tidak bercap, ejaan nama, dll).
- "tidak_sesuai": dokumen tidak relevan/tidak dapat dibaca/bukan dokumen yang diminta.
Gunakan bahasa Indonesia pada issues dan suggestions.`;
}

function extractJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('NO_JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

function feedbackText(doc, result) {
  const nama = doc.name;
  if (result.status === 'valid') return `✅ Dokumen "${nama}" dinyatakan valid. Tidak ditemukan masalah.`;
  if (result.status === 'perlu_perbaikan') {
    const issues = result.issues.map((i) => `  - ${i}`).join('\n');
    const sug = result.suggestions.map((s) => `  - ${s}`).join('\n');
    return `⚠️ Dokumen "${nama}" perlu perbaikan:\n${issues}\nSaran:\n${sug}`;
  }
  if (result.status === 'tidak_sesuai') {
    const issues = result.issues.map((i) => `  - ${i}`).join('\n');
    return `❌ Dokumen "${nama}" tidak sesuai:\n${issues}\nSilakan periksa kembali dan kirim ulang.`;
  }
  return `Dokumen "${nama}" sudah tersimpan, tetapi belum bisa diverifikasi otomatis. Petugas akan meninjaunya secara manual.`;
}

async function analyzeDocument({ professionKey, docKey, fileBuffer, mimeType, llm }) {
  const { getProfession } = require('./checklist');
  const doc = findDocument(professionKey, docKey);
  const profession = getProfession(professionKey);
  const prompt = buildPrompt(doc, profession.label);
  const parts = [{ text: prompt }, { inlineData: { mimeType, data: fileBuffer.toString('base64') } }];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await llm.generateContent({ parts });
      const parsed = extractJSON(text);
      const status = STATUS_VALID.includes(parsed.status) ? parsed.status : 'perlu_review_manual';
      const result = {
        status,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
      return { ...result, feedbackText: feedbackText(doc, result) };
    } catch {
      // retry sekali; jika gagal lagi keluar dari loop
    }
  }
  const fallback = { status: 'perlu_review_manual', issues: [], suggestions: [] };
  return { ...fallback, feedbackText: feedbackText(doc, fallback) };
}

module.exports = { analyzeDocument };
