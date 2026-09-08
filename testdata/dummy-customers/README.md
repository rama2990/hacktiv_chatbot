# Data Testing Dokumen KPR Dummy — 10 Persona Customer

> **SEMUA DATA PALSU & FIKTIF.** Hanya untuk pengujian chatbot KPR. Semua dokumen diberi
> watermark "DUMMY" dan/atau footer "DOKUMEN DUMMY UNTUK PENGUJIAN".
> Tanggal referensi: hari ini diasumsikan **8 September 2026**.

## Struktur

```
testdata\
├── personas.json                  # sumber data 10 persona (dibaca kedua script)
├── make-pngs.ps1                  # generator PNG (KTP, KK, NPWP, rekening koran, SHM)
├── make-pdfs.js                   # generator PDF (slip gaji, SKK, NIB, akta, SIP, dst.)
├── dummy-docs\                    # [LEGACY] hasil lama 1 persona (Budi Santoso)
└── dummy-customers\
    ├── README.md                  # file ini
    ├── persona-01\ ... persona-10\   # satu folder per persona
```

## Regenerasi

```powershell
# Semua persona sekaligus:
pwsh D:\Project\Chatbot\testdata\make-pngs.ps1
node D:\Project\Chatbot\testdata\make-pdfs.js

# Satu persona saja:
pwsh D:\Project\Chatbot\testdata\make-pngs.ps1 -PersonaId persona-05
node D:\Project\Chatbot\testdata\make-pdfs.js persona-05
```

Edit `personas.json` untuk mengubah data persona (nama, NIK, gaji, tanggal, flag
kelengkapan di blok `dokumen`).

## Tabel Persona & Masalah yang Disisipkan

| Persona | Nama | Profesi | Profil Kelengkapan | Masalah untuk menguji chatbot |
|---|---|---|---|---|
| 01 | Andi Pratama Wijaya | Karyawan swasta | **LENGKAP, semua valid** | Tidak ada (baseline happy path) |
| 02 | Siti Nurhaliza Rahmawati | Karyawan swasta | Lengkap | **Slip gaji lama > 4 bulan** (periode Februari, Maret, April 2026) |
| 03 | Bambang Setyo Nugroho | Karyawan swasta | Tidak lengkap | **Tidak ada rekening koran & NPWP** |
| 04 | Dewi Lestari Handayani | Karyawan swasta | Lengkap | **Ejaan nama beda**: KTP/KK/NPWP "Handayani" vs slip gaji & SKK "Hendayani" |
| 05 | Hendra Gunawan Kusuma | Wiraswasta | **LENGKAP** (NIB, akta pendirian, rekening koran usaha 6 bulan, laporan keuangan, dokumen properti) | Tidak ada (baseline wiraswasta) |
| 06 | Rina Marlina Sari | Wiraswasta | NIB perorangan + rekening koran usaha 3 bulan | **NIB kadaluarsa** (berlaku s/d 01 Maret 2026 + status "KADALUARSA"), **tanpa akta pendirian** |
| 07 | dr. Fatimah Azzahra Puspita, Sp.A | Profesional (dokter) | **LENGKAP** + dokumen properti | Tidak ada; **SIP masih berlaku** (s/d 31 Agustus 2031) |
| 08 | dr. Yusuf Rahman Hakim | Profesional (dokter) | KTP, KK, NPWP, rekening koran, SIP | **SIP kadaluarsa** (berlaku s/d 01 Maret 2026 + status "KADALUARSA") |
| 09 | Agus Wijaya Santosa | PNS | **LENGKAP** (SK pengangkatan, SK pangkat, slip gaji 3 bulan, dokumen properti) | Tidak ada (baseline PNS) |
| 10 | Maya Kartika Sari | Karyawan BUMN (baru mulai) | **Hanya KTP + KK** | Hampir semua dokumen belum ada |

## Isi Tiap Folder

Format PNG: `ktp.png`, `kartu-keluarga.png`, `npwp.png`, `rekening-koran.png`
(personal, periode Agustus 2026), `sertifikat-shm.png`.
Format PDF diberi nama deskriptif; slip gaji & rekening koran usaha per bulan
(contoh: `slip-gaji-2026-08.pdf`).

| Persona | Jumlah | Daftar file |
|---|---|---|
| 01 | 12 | ktp, kartu-keluarga, npwp, rekening-koran (PNG); slip-gaji-2026-06/07/08, surat-keterangan-kerja, imb-pbg, pbb-sppt, ajb (PDF); sertifikat-shm (PNG) |
| 02 | 8 | ktp, kartu-keluarga, npwp, rekening-koran (PNG); slip-gaji-2026-02/03/04 (LAMA), surat-keterangan-kerja (PDF) |
| 03 | 6 | ktp, kartu-keluarga (PNG); slip-gaji-2026-06/07/08, surat-keterangan-kerja (PDF) — tanpa NPWP & rekening koran |
| 04 | 8 | ktp, kartu-keluarga, npwp, rekening-koran (PNG); slip-gaji-2026-06/07/08, surat-keterangan-kerja (PDF, nama salah ejaan) |
| 05 | 17 | ktp, kartu-keluarga, npwp, rekening-koran, sertifikat-shm (PNG); siup-nib, akta-pendirian-usaha, laporan-keuangan, rekening-koran-usaha-2026-03..08, imb-pbg, pbb-sppt, ajb (PDF) |
| 06 | 7 | ktp, kartu-keluarga, npwp (PNG); siup-nib (KADALUARSA), rekening-koran-usaha-2026-06/07/08 (PDF) — tanpa akta |
| 07 | 9 | ktp, kartu-keluarga, npwp, rekening-koran, sertifikat-shm (PNG); surat-izin-praktik (VALID), imb-pbg, pbb-sppt, ajb (PDF) |
| 08 | 5 | ktp, kartu-keluarga, npwp, rekening-koran (PNG); surat-izin-praktik (KADALUARSA) (PDF) |
| 09 | 13 | ktp, kartu-keluarga, npwp, rekening-koran, sertifikat-shm (PNG); sk-pengangkatan, sk-pangkat, slip-gaji-2026-06/07/08, imb-pbg, pbb-sppt, ajb (PDF) |
| 10 | 2 | ktp, kartu-keluarga (PNG) |

## Konsistensi Data Antar-Dokumen (per persona)

- NIK, No. KK, No. NPWP, nama, tanggal lahir, dan alamat konsisten di semua dokumen
  persona tersebut (kecuali masalah yang sengaja disisipkan, lihat kolom persona-04).
- Slip gaji: gaji bersih di slip gaji sama dengan mutasi kredit "GAJI ..." di rekening
  koran bulan Agustus (karyawan/PNS).
- SHM ↔ PBG ↔ PBB ↔ AJB saling merujuk (nomor sertifikat, luas, alamat objek sama).
- Akta pendirian ↔ NIB ↔ laporan keuangan ↔ rekening koran usaha (persona-05) memakai
  nama usaha & alamat usaha yang sama.

## Skrip

| File | Fungsi |
|---|---|
| `testdata\personas.json` | Seluruh data 10 persona + flag kelengkapan dokumen per persona |
| `testdata\make-pngs.ps1` | Membuat PNG via System.Drawing (opsi `-PersonaId` / semua) |
| `testdata\make-pdfs.js` | Membuat PDF satu halaman A4 tanpa dependensi (argumen `persona-XX` / semua) |
