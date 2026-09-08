# Dummy Documents untuk Testing Chatbot Verifikasi KPR

> **PERINGATAN:** Semua file di folder ini adalah **DOKUMEN DUMMY/PALSU** yang dibuat
> secara programatik khusus untuk pengujian (testing) chatbot verifikasi dokumen KPR.
> Semua nama, NIK, nomor, dan angka di dalamnya adalah **FIKTIF**.
> Bukan dokumen asli dan tidak boleh digunakan di luar testing.

## Daftar File

| # | File | Jenis Dokumen | Format | Sumber |
|---|------|---------------|--------|--------|
| 1 | `ktp.png` | KTP (Kartu Tanda Penduduk) | PNG | Dibuat sendiri via script `..\make-pngs.ps1` |
| 2 | `kartu-keluarga.png` | Kartu Keluarga (KK) | PNG | Dibuat sendiri via script `..\make-pngs.ps1` |
| 3 | `npwp.png` | Kartu NPWP Pribadi | PNG | Dibuat sendiri via script `..\make-pngs.ps1` |
| 4 | `rekening-koran.png` | Rekening Koran / Mutasi Rekening | PNG | Dibuat sendiri via script `..\make-pngs.ps1` |
| 5 | `sertifikat-shm.png` | Sertifikat SHM | PNG | Dibuat sendiri via script `..\make-pngs.ps1` |
| 6 | `slip-gaji.pdf` | Slip Gaji | PDF | Dibuat sendiri via script `..\make-pdfs.js` |
| 7 | `surat-keterangan-kerja.pdf` | Surat Keterangan Kerja (SKK) | PDF | Dibuat sendiri via script `..\make-pdfs.js` |
| 8 | `siup-nib.pdf` | NIB (pengganti SIUP/TDP) via OSS | PDF | Dibuat sendiri via script `..\make-pdfs.js` |
| 9 | `akta-pendirian-usaha.pdf` | Akta Pendirian PT | PDF | Dibuat sendiri via script `..\make-pdfs.js` |
| 10 | `surat-izin-praktik.pdf` | Surat Izin Praktik (SIP) Dokter | PDF | Dibuat sendiri via script `..\make-pdfs.js` |
| 11 | `imb-pbg.pdf` | PBG (pengganti IMB) | PDF | Dibuat sendiri via script `..\make-pdfs.js` |
| 12 | `pbb-sppt.pdf` | SPPT PBB + Bukti Pembayaran | PDF | Dibuat sendiri via script `..\make-pdfs.js` |
| 13 | `ajb.pdf` | Akta Jual Beli (AJB) | PDF | Dibuat sendiri via script `..\make-pdfs.js` |

## Data Dummy yang Digunakan

- **Nama:** Budi Santoso (NIK fiktif `3271010101010001`, NPWP fiktif `01.234.567.8-901.000`)
- **Perusahaan:** PT Maju Jaya Sentosa (fiktif)
- **Bank:** Bank Dummy Indonesia (fiktif)
- **Objek:** Jl. Dummy Indah No. 10, Kebayoran Baru, Jakarta Selatan (fiktif), SHM No. 123/BKS/2026, harga transaksi Rp 1.500.000.000

## Catatan Teknis

- File PNG dibuat dengan PowerShell + System.Drawing, berisi watermark diagonal "DUMMY".
- File PDF dibuat dengan Node.js (writer PDF minimal 1 halaman, font Helvetica), memuat
  footer "DOKUMEN DUMMY UNTUK PENGUJIAN".
- Semua file < 100 KB.
- Untuk meregenerasi: jalankan `pwsh testdata\make-pngs.ps1` dan `node testdata\make-pdfs.js`.
- Pencarian web untuk contoh dokumen publik tidak menghasilkan file yang aman/langsung
  dapat diunduh (dataset OCR butuh registrasi, tool generator berbasis browser), sehingga
  seluruh dokumen dibuat sendiri. Tidak ada dokumen asli milik pihak lain yang diunduh.
