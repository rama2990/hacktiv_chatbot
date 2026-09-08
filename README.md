# Chatbot Verifikasi Dokumen KPR

Chatbot web yang memandu customer mengunggah dan memverifikasi dokumen KPR sesuai profesi (Karyawan, Wiraswasta, Profesional, BUMN/PNS/Bank). Dokumen dianalisis dengan Gemini multimodal; feedback diberikan per dokumen dan direkap di akhir.

## Setup

1. `npm install`
2. `cp .env.example .env` lalu isi:
   - `GEMINI_API_KEY` — key dari Google AI Studio
   - `OPENROUTER_API_KEY` — opsional, sebagai fallback
3. `npm start` → buka http://localhost:3000

## Test

`npm test` — semua test memakai LLM mock, tidak memanggil API sungguhan.

## Data testing

10 persona dummy dengan tingkat kelengkapan bervariasi tersedia di `testdata/dummy-customers/` (lihat README di folder itu). Upload dokumen persona tersebut melalui chat untuk menguji berbagai jalur verifikasi.

## Fitur

- Guided wizard: profesi → checklist → upload per dokumen → feedback → rekap.
- Analisis dokumen LLM (PDF/JPG/PNG, maks 4 MB) dengan fallback provider.
- Resume sesi via cookie otomatis atau kode sesi (`KPR-XXXXXX`) lintas perangkat.
