# Design: Chatbot Verifikasi Dokumen KPR

Tanggal: 2026-09-08
Status: Disetujui (brainstorming selesai)

## Tujuan

Chatbot web (vanilla JS + Express) yang memandu customer mengajukan dan memverifikasi dokumen KPR:

1. Customer menyapa, chatbot memulai percakapan.
2. Chatbot memberikan checklist kebutuhan dokumen sesuai profesi customer.
3. Customer mengunggah dokumen; chatbot memeriksa isinya menggunakan LLM.
4. Chatbot memberikan feedback per dokumen dan rekap akhir.

Customer dapat melanjutkan pengiriman dokumen di sesi/perangkat berbeda.

## Keputusan Utama

| Aspek | Keputusan |
|---|---|
| Frontend | Vanilla JS, satu halaman chat |
| Backend | Node.js + Express |
| LLM | Gemini (primary) → OpenRouter dengan model Gemini (fallback), key di `.env` |
| Analisis dokumen | Multimodal LLM (PDF/JPG/PNG), feedback konten dokumen |
| Alur | Guided wizard server-driven (state machine di server) |
| Profesi | Karyawan, Wiraswasta, Profesional, Karyawan BUMN/PNS/Bank |
| File upload | Via chat, PDF/JPG/PNG, maks 4 MB per file, maks 4 file per pesan |
| Penyimpanan | SQLite (better-sqlite3) + folder `src/uploads/` |
| Resume sesi | Cookie otomatis (httpOnly, 30 hari) + kode sesi manual (`KPR-XXXXXX`); bot menanyakan di awal apakah customer pernah upload sebelumnya |
| Cakupan feedback | Kelengkapan & kelayakan dokumen saja — tanpa simulasi DSR, tanpa rekomendasi bank |
| Testing | `node:test` + supertest, LLM di-mock |

## Arsitektur

Pendekatan terpilih: **server-driven wizard + LLM untuk analisis dokumen**. Express memegang state machine sesi; client hanya chat UI tipis. LLM dipanggil hanya untuk analisis dokumen dan perumusan feedback — alur, validasi, dan penyimpanan deterministik di server. Alasan: alur terkontrol & mudah dites, hemat token, resume lintas sesi mudah karena state ada di SQLite.

Alternatif yang ditolak:
- LLM-driven function calling — alur sulit dijamin, mahal token, resume rumit.
- Client-driven wizard — progress tidak bisa dilanjutkan di perangkat lain, logika terduplikasi.

### Struktur Proyek

```
D:\Project\Chatbot\
├── server.js                 # entry: Express app, static + API
├── src/
│   ├── routes/
│   │   ├── session.js        # POST /api/session (baru/lanjut via kode)
│   │   └── chat.js           # POST /api/chat (pesan + upload file)
│   ├── services/
│   │   ├── stateMachine.js   # alur wizard
│   │   ├── gemini.js         # client Gemini + fallback OpenRouter
│   │   ├── analyzer.js       # prompt + analisis dokumen multimodal
│   │   └── checklist.js      # knowledge base dokumen per profesi
│   ├── db/
│   │   ├── sqlite.js         # setup better-sqlite3
│   │   └── models.js         # query sesi, pesan, dokumen
│   └── uploads/              # file dokumen customer (gitignored)
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .env.example              # GEMINI_API_KEY, OPENROUTER_API_KEY, PORT
└── package.json
```

### Komponen

- **public/ (vanilla JS)** — chat UI: kirim `POST /api/chat` (multipart: teks + files), render balasan + progress checklist. Tidak memuat aturan bisnis.
- **routes/** — endpoint tipis: validasi request, panggil service, kembalikan JSON `{reply, attachments?, state, progress}`.
- **services/stateMachine.js** — otak alur; tiap state punya handler input (teks/file).
- **services/checklist.js** — dokumen per profesi + aturan pemeriksaan (usia dokumen, legalisir, konsistensi nama) berdasarkan riset dokumen KPR 2025–2026 (bank BCA, Mandiri, BNI, BRI, BTN, CIMB). Data statis di kode.
- **services/gemini.js** — wrapper LLM: Gemini dulu, fallback OpenRouter (model Gemini) saat error/rate limit. Key dari `.env`.
- **services/analyzer.js** — kirim file + aturan pemeriksaan dokumen terkait ke Gemini multimodal → output JSON terstruktur `{status, issues[], suggestions[]}` → dirangkai jadi feedback natural.
- **db/** — tabel:
  - `sessions` (id, kode_sesi, profesi, state, cookie_token, created_at, updated_at)
  - `messages` (id, session_id, role, content, created_at)
  - `documents` (id, session_id, jenis_dokumen, path, mime, status_verifikasi, catatan_feedback, created_at)

## Alur Data & Percakapan

### Mulai / lanjut sesi

1. Browser buka halaman → `POST /api/session` (cookie token jika ada).
2. Cookie valid & sesi belum `DONE` → server memuat riwayat + progress, bot lanjut dari state terakhir (resume otomatis).
3. Tidak ada sesi → bot menyapa dan bertanya apakah customer pernah mengajukan dokumen sebelumnya:
   - Ya → minta kode sesi; valid → muat sesi itu di perangkat mana pun; salah → minta ulang (maks 3×) atau mulai baru.
   - Tidak → sesi baru: server generate `session_id` + kode sesi `KPR-XXXXXX` + cookie token (httpOnly, SameSite=Lax, 30 hari). Bot menampilkan kode sesi sekali: "Simpan kode ini untuk melanjutkan di perangkat lain."

### State machine

| State | Bot | Input customer | Transisi |
|---|---|---|---|
| `GREETING` | Sapa + tanya pernah upload? | teks | → `ASK_CODE` / `PROFESSION` |
| `ASK_CODE` | Minta kode sesi | teks kode | valid → resume sesi lama; invalid → minta ulang / mulai baru |
| `PROFESSION` | Tanya profesi (tombol pilihan) | pilihan/teks | → `CHECKLIST` |
| `CHECKLIST` | Tampilkan checklist dokumen profesi | — | → `COLLECTING` |
| `COLLECTING` | Minta dokumen satu per satu sesuai urutan checklist | file (bisa beberapa sekaligus) | cocok → analisis → feedback → dokumen berikutnya; tidak relevan → diminta ulang |
| `RECAP` | Rekap status semua dokumen + saran | teks / upload ulang | upload ulang → `COLLECTING` (satu dokumen); "selesai" → `DONE` |
| `DONE` | Salam penutup + ringkasan kode sesi | — | — |

### Alur upload file (state `COLLECTING`)

1. Client kirim multipart (`message` + `files[]`, maks 4 file × 4 MB, PDF/JPG/PNG).
2. Server validasi tipe & ukuran → simpan ke `src/uploads/<sessionId>/{jenis_dokumen}-{timestamp}.pdf` (nama generate server, bukan nama asli) → catat di tabel `documents`.
3. `analyzer.js` kirim file + aturan pemeriksaan dokumen tersebut (dari `checklist.js`) ke Gemini multimodal.
4. Gemini balas JSON `{status: valid|perlu_perbaikan|tidak_sesuai, issues[], suggestions[]}` → feedback natural.
5. Bot kirim feedback + minta dokumen berikutnya. Request-response sinkron (tanpa streaming).

### Fallback LLM

Gemini langsung → jika 429/5xx/network error → OpenRouter (model Gemini) sekali → jika gagal juga, bot meminta customer mengirim ulang nanti; dokumen & state tetap tersimpan (`COLLECTING`).

## Error Handling

- Tipe file salah / > 4 MB / > 4 file → bot menjelaskan batasan, minta ulang (tanpa panggil LLM).
- Kedua provider LLM gagal → pesan maaf + minta ulang nanti; sesi aman.
- Respon Gemini bukan JSON valid → retry sekali dengan prompt perbaikan; tetap gagal → dokumen ditandai `perlu_review_manual` + feedback generik.
- Input teks tak dikenal → tanya ulang dengan opsi, maks 2× sebelum diarahkan ke tombol pilihan.
- Kode sesi salah 3× → tawarkan mulai sesi baru.
- Server restart → state aman (SQLite + folder uploads).

## Keamanan

- API key hanya di `.env` (gitignored); `.env.example` berisi placeholder.
- Nama file generate server (anti path traversal); file tidak di-serve publik.
- Cookie httpOnly + SameSite=Lax; sesi hanya bisa diakses via cookie token atau kode sesi.
- Rate limit sederhana per IP (20 request/menit, config via `.env`).
- Checklist/knowledge base statis di kode — tidak ada risiko injection dari data riset.

## Testing

Framework: `node:test` + supertest. LLM selalu di-mock (injection) — tidak ada panggilan API sungguhan di test.

- `checklist.js` — daftar dokumen per profesi lengkap & konsisten dengan aturan pemeriksaan.
- `stateMachine.js` — semua transisi state: jalur baru, resume cookie, resume kode, jawaban invalid, upload ulang di `RECAP`.
- `routes/session.js`, `routes/chat.js` — uji HTTP: buat sesi, resume cookie, resume kode, upload file fake, validasi file ditolak.
- `analyzer.js` — parsing: JSON valid, JSON rusak (retry → fallback), provider gagal (fallback OpenRouter).

## Di Luar Cakupan (YAGNI)

Streaming response, autentikasi user/admin, multi-bahasa, simulasi DSR/angsuran, rekomendasi bank, database produksi, integrasi SLIK OJK.
