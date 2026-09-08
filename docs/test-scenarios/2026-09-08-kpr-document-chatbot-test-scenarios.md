# Test Scenarios: Chatbot Verifikasi Dokumen KPR

Tanggal: 2026-09-08
Berdasarkan: `docs/superpowers/specs/2026-09-08-kpr-document-chatbot-design.md`
Framework: `node:test` + supertest, LLM di-mock

## Data Uji Tersedia (`testdata/dummy-customers/`)

Semua file dummy < 100 KB, PDF/PNG valid, watermark "DUMMY". Referensi tanggal: 8 September 2026.

| Persona | Profesi | Profil | Dipakai untuk skenario |
|---|---|---|---|
| persona-01 (Andi Pratama Wijaya) | Karyawan swasta | Lengkap, semua valid (12 file) | TS-06, TS-07, TS-12, TS-13 |
| persona-02 (Siti Nurhaliza) | Karyawan swasta | Slip gaji lama > 4 bulan (2026-02/03/04) | TS-06b |
| persona-03 (Bambang Setyo) | Karyawan swasta | Tanpa NPWP & rekening koran | TS-12 |
| persona-04 (Dewi Lestari) | Karyawan swasta | Ejaan nama beda ("Handayani" vs "Hendayani") | TS-06c |
| persona-05 (Hendra Gunawan) | Wiraswasta | Lengkap, 17 file (banyak dokumen usaha) | TS-07 |
| persona-06 (Rina Marlina) | Wiraswasta | NIB kadaluarsa, tanpa akta | TS-06d |
| persona-07 (dr. Fatimah Azzahra) | Profesional | Lengkap, SIP valid s/d 2031 | TS-05 |
| persona-08 (dr. Yusuf Rahman) | Profesional | SIP kadaluarsa | TS-06e |
| persona-09 (Agus Wijaya) | PNS | Lengkap (SK pangkat, SK pengangkatan) | TS-05 |
| persona-10 (Maya Kartika) | Karyawan BUMN | Hanya KTP + KK | TS-05, TS-02 |

Catatan: testdata **tidak memuat** file invalid (tipe salah / > 4 MB / > 4 file) — untuk TS-08 file tersebut dibuat sintetis di test (buffer dummy). Semua kasus "perlu_perbaikan"/"tidak_sesuai" diuji dengan LLM di-mock yang membaca masalah yang sengaja disisipkan di persona.

## Ringkasan Cakupan

| # | Skenario | Area | Data uji | Prioritas |
|---|---|---|---|---|
| TS-01 | Sesi baru + kode sesi ditampilkan | Session | — | Tinggi |
| TS-02 | Resume otomatis via cookie | Session | persona-01, persona-10 | Tinggi |
| TS-03 | Resume manual via kode sesi valid | Session | persona-01 | Tinggi |
| TS-04 | Kode sesi salah 3× | Session | — | Sedang |
| TS-05 | Pilih profesi → checklist tampil | State machine | persona-07, persona-09, persona-10 | Tinggi |
| TS-06 | Upload dokumen valid → feedback | Upload + LLM | persona-01/02/04/06/08 | Tinggi |
| TS-07 | Upload multiple file sekaligus | Upload | persona-05 | Sedang |
| TS-08 | File ditolak (tipe/ukuran/jumlah) | Validasi | file sintetis di test | Tinggi |
| TS-09 | Fallback Gemini → OpenRouter | LLM | persona-01 | Tinggi |
| TS-10 | Kedua provider gagal | LLM | persona-01 | Sedang |
| TS-11 | Respon LLM JSON rusak | Analyzer | persona-01 | Sedang |
| TS-12 | Rekap + upload ulang di RECAP | State machine | persona-01, persona-03 | Sedang |
| TS-13 | Selesai → DONE | State machine | persona-01 | Sedang |
| TS-14 | Sesi aman setelah server restart | Persistensi | persona-01 | Sedang |

---

## TS-01 — Sesi baru + kode sesi ditampilkan

**Prasyarat:** Tidak ada cookie, belum ada sesi.

**Langkah:**
1. `POST /api/session` tanpa cookie.
2. Jawab "belum pernah" saat bot menanyakan riwayat.

**Hasil diharapkan:**
- Server generate `session_id` + kode `KPR-XXXXXX` + cookie httpOnly (SameSite=Lax, 30 hari).
- Bot menyapa dan menampilkan kode sesi sekali dengan instruksi simpan.
- State = `GREETING`.

---

## TS-02 — Resume otomatis via cookie

**Prasyarat:** Sesi aktif pada state `COLLECTING` (persona-01, baru KTP terkirim), cookie valid ada.

**Langkah:**
1. `POST /api/session` dengan cookie token.

**Hasil diharapkan:**
- Riwayat + progress dimuat, bot lanjut dari state `COLLECTING`.
- Tidak ada sesi baru dibuat.

**Varian:**
- Cookie valid tapi sesi sudah `DONE` → mulai sesi baru.
- Sesi persona-10 (baru KTP + KK) → bot lanjut minta dokumen checklist BUMN berikutnya.

---

## TS-03 — Resume manual via kode sesi valid

**Prasyarat:** Sesi lama ada dengan kode `KPR-ABC123` milik persona-01, perangkat baru (tanpa cookie).

**Langkah:**
1. Jawab "pernah" → bot minta kode.
2. Kirim `KPR-ABC123`.

**Hasil diharapkan:**
- Sesi lama dimuat di perangkat baru, state & progress sesuai.

---

## TS-04 — Kode sesi salah 3×

**Langkah:**
1. Jawab "pernah", kirim kode salah sebanyak 3×.

**Hasil diharapkan:**
- Dua percobaan pertama: bot minta ulang.
- Percobaan ketiga salah: bot menawarkan mulai sesi baru.

---

## TS-05 — Pilih profesi → checklist tampil

**Langkah:**
1. Dari `PROFESSION`, pilih salah satu profesi (tombol atau teks), satu run per persona:
   - persona-07 → Profesional (SIP valid, baseline lengkap)
   - persona-09 → PNS (SK pengangkatan + SK pangkat)
   - persona-10 → Karyawan BUMN (checklist muncul meski hampir semua dokumen belum ada)

**Hasil diharapkan:**
- State → `CHECKLIST`, checklist dokumen sesuai profesi ditampilkan (mis. Profesional: KTP, KK, NPWP, rekening koran, SIP, dokumen properti).
- State → `COLLECTING`, bot meminta dokumen pertama sesuai urutan checklist.

**Varian:** Input teks tak dikenal → bot tanya ulang maks 2× lalu arahkan ke tombol pilihan.

---

## TS-06 — Upload dokumen → feedback sesuai isi

**Prasyarat:** State `COLLECTING` sesuai profesi; LLM di-mock membaca file persona.

| Varian | Persona & file | Mock LLM | Hasil diharapkan |
|---|---|---|---|
| a | persona-01 `ktp.png` | `valid` | Feedback positif, status `valid`, bot minta dokumen berikutnya |
| b | persona-02 `slip-gaji-2026-02.pdf` (lama > 4 bulan) | `perlu_perbaikan` | Issue "slip gaji lebih dari 4 bulan", saran kirim slip terbaru |
| c | persona-04 `surat-keterangan-kerja.pdf` (ejaan "Hendayani") | `perlu_perbaikan` | Issue inkonsistensi nama dengan KTP |
| d | persona-06 `siup-nib.pdf` (KADALUARSA s/d 01-03-2026) | `tidak_sesuai` | Issue NIB kedaluwarsa, saran perbarui NIB |
| e | persona-08 `surat-izin-praktik.pdf` (KADALUARSA) | `tidak_sesuai` | Issue SIP kedaluwarsa |

**Hasil diharapkan (semua varian):**
- File tersimpan di `src/uploads/<sessionId>/` dengan nama generate server (bukan nama asli).
- Tercatat di tabel `documents` dengan status sesuai varian.
- Bot mengirim feedback per dokumen lalu meminta dokumen berikutnya.

---

## TS-07 — Upload multiple file sekaligus

**Langkah:**
1. Sebagai persona-05 (wiraswasta), kirim 4 file sekaligus: `slip`… → gunakan `rekening-koran-usaha-2026-03.pdf` s/d `2026-06.pdf` (4 file).

**Hasil diharapkan:**
- 4 file diterima (tepat di batas maks 4 file), masing-masing dianalisis dan mendapat feedback.

---

## TS-08 — File ditolak (validasi tanpa LLM)

| Varian | Input | Hasil diharapkan |
|---|---|---|
| a | Buffer `.docx` (rename dari file persona apa pun) | Ditolak, bot jelaskan hanya PDF/JPG/PNG |
| b | Buffer 5 MB (dibuat sintetis; semua file testdata < 100 KB) | Ditolak, bot jelaskan maks 4 MB |
| c | 5 file persona-05 sekaligus | Ditolak, bot jelaskan maks 4 file |
| d | File `../../evil.pdf` (nama berbahaya) | Nama digenerate server, aman dari path traversal |

Semua varian: **tanpa panggilan LLM**, state tetap `COLLECTING`.

---

## TS-09 — Fallback Gemini → OpenRouter

**Prasyarat:** Mock Gemini melempar 429/5xx/network error; mock OpenRouter sukses.

**Langkah:**
1. Upload dokumen valid persona-01 (`ktp.png`).

**Hasil diharapkan:**
- OpenRouter dipanggil sekali (model Gemini), analisis tetap berhasil, feedback normal.

---

## TS-10 — Kedua provider gagal

**Prasyarat:** Mock Gemini dan OpenRouter sama-sama gagal.

**Langkah:**
1. Upload dokumen valid persona-01 (`ktp.png`).

**Hasil diharapkan:**
- Bot mengirim pesan maaf + minta kirim ulang nanti.
- File & state tetap tersimpan (`COLLECTING`), tidak ada dokumen terverifikasi.

---

## TS-11 — Respon LLM JSON rusak

**Prasyarat:** Mock LLM mengembalikan string bukan JSON valid.

**Langkah:**
1. Upload dokumen valid persona-01 (`ktp.png`).

**Hasil diharapkan:**
- Retry sekali dengan prompt perbaikan.
- Tetap gagal → dokumen ditandai `perlu_review_manual` + feedback generik.

---

## TS-12 — Rekap + upload ulang di RECAP

**Prasyarat:** Semua dokumen checklist sudah dikirim, state `RECAP`:
- persona-01 → rekap lengkap semua `valid`.
- persona-03 → rekap menandai NPWP & rekening koran belum ada/kurang.

**Langkah:**
1. Bot menampilkan rekap status semua dokumen + saran.
2. Upload ulang satu dokumen yang bermasalah (persona-03: `npwp.png`).

**Hasil diharapkan:**
- State → `COLLECTING` untuk satu dokumen tersebut, dianalisis ulang, lalu kembali ke `RECAP`.

---

## TS-13 — Selesai → DONE

**Prasyarat:** persona-01 di state `RECAP` dengan semua dokumen `valid`.

**Langkah:**
1. Di `RECAP`, kirim "selesai".

**Hasil diharapkan:**
- State → `DONE`, bot menampilkan penutup + ringkasan kode sesi.
- Resume cookie dengan sesi `DONE` tidak melanjutkan sesi (lihat TS-02 varian).

---

## TS-14 — Sesi aman setelah server restart

**Langkah:**
1. Buat sesi, upload 1 dokumen (LLM mock).
2. Restart server / inisialisasi ulang SQLite + folder uploads.

**Hasil diharapkan:**
- Sesi, pesan, dokumen, dan state tetap utuh dari SQLite.
- Resume berjalan normal dari state terakhir.

---

## Catatan

- Semua test memakai LLM injection (mock) — tidak ada panggilan API sungguhan.
- Dokumen persona dari `testdata/dummy-customers/` dipakai sebagai fixture upload; masalah yang disisipkan (slip gaji lama, NIB/SIP kadaluarsa, ejaan nama, dokumen hilang) menentukan ekspektasi feedback.
- Testdata tidak memuat file > 4 MB, tipe salah, atau > 4 file per pesan — varian TS-08 dibuat sintetis di dalam test.
- Unit test pendukung: `checklist.js` (kelengkapan & konsistensi per profesi, cocokkan dengan daftar dokumen `testdata/personas.json`), `stateMachine.js` (semua transisi di tabel state machine spesifikasi).
- `testdata/dummy-docs/` bersifat legacy (1 persona lama) — tidak dipakai skenario di atas.
