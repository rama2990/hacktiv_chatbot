// Generates minimal but valid single-page PDF documents (A4) for KPR chatbot
// testing personas. All data is fictional. No dependencies.
//
// Usage:
//   node make-pdfs.js                 -> generate for ALL personas in personas.json
//   node make-pdfs.js persona-01      -> generate for one persona
//
// Output: D:\Project\Chatbot\testdata\dummy-customers\<persona-id>\*.pdf
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT_DIR = "D:\\Project\\Chatbot\\testdata";
const OUT_ROOT = path.join(ROOT_DIR, "dummy-customers");

const PERSONAS = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "personas.json"), "utf8"));
const argId = process.argv[2];
const SELECTED = argId ? PERSONAS.filter((p) => p.id === argId) : PERSONAS;
if (SELECTED.length === 0) throw new Error("Persona not found: " + argId);

const PAGE_W = 595;
const PAGE_H = 842;

const MONTHS = {
  Januari: 1, Februari: 2, Maret: 3, April: 4, Mei: 5, Juni: 6,
  Juli: 7, Agustus: 8, September: 9, Oktober: 10, November: 11, Desember: 12,
};

function fmtNum(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}
function fmt(n) {
  return "Rp " + fmtNum(n);
}
// "Juli 2026" -> "2026-07"
function monthTag(m) {
  const [name, year] = m.split(" ");
  return `${year}-${String(MONTHS[name]).padStart(2, "0")}`;
}

function esc(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// blocks: [{x, y, size, bold, text}]
function buildPdf(blocks) {
  const content =
    blocks
      .map(
        (b) =>
          `BT /F${b.bold ? 2 : 1} ${b.size} Tf 1 0 0 1 ${b.x} ${b.y} Tm (${esc(b.text)}) Tj ET`
      )
      .join("\n") + "\n";

  const header = "%PDF-1.4\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`,
  ];

  const parts = [header];
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(parts.reduce((n, p) => n + Buffer.byteLength(p, "latin1"), 0));
    parts.push(`${i + 1} 0 obj\n${body}\nendobj\n`);
  });
  const xrefOffset = parts.reduce((n, p) => n + Buffer.byteLength(p, "latin1"), 0);

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += String(off).padStart(10, "0") + " 00000 n \n";
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([...parts.map((p) => Buffer.from(p, "latin1")), Buffer.from(xref + trailer, "latin1")]);
}

// Simple line-based document builder
class Doc {
  constructor() {
    this.blocks = [];
    this.y = PAGE_H - 60;
  }
  push(text, { size = 11, bold = false, x = 55 } = {}) {
    this.blocks.push({ x, y: this.y, size, bold, text: String(text) });
    this.y -= size + 7;
    return this;
  }
  gap(px = 10) {
    this.y -= px;
    return this;
  }
  title(text) {
    return this.push(text, { size: 15, bold: true }).gap(4);
  }
  hr() {
    this.push("-".repeat(88), { size: 9 });
    return this;
  }
  fields(pairs) {
    for (const [label, value] of pairs) this.push(`${String(label).padEnd(30)}: ${value}`, { size: 10 });
    return this;
  }
  footer() {
    this.blocks.push({
      x: 55,
      y: 40,
      size: 8,
      bold: false,
      text: "DOKUMEN DUMMY UNTUK PENGUJIAN - BUKAN DOKUMEN RESMI - SEMUA DATA PALSU",
    });
    return this;
  }
  save(outDir, file) {
    fs.writeFileSync(path.join(outDir, file), buildPdf(this.blocks));
    console.log("Created", path.join(outDir, file));
  }
}

function alamatSatuBaris(p) {
  const a = p.alamat;
  return `${a.jalan}, RT ${a.rt}/RW ${a.rw}, Kel. ${a.kel}, Kec. ${a.kec}, ${a.kota}, ${a.kodePos}`;
}

// Nama yang dipakai pada dokumen penghasilan (persona-04 sengaja salah ejaan)
function namaPenghasilan(p) {
  return p.namaAlt || p.namaTitle;
}

// --- Slip Gaji (karyawan swasta / PNS) ---
function genSlipGaji(p, month, outDir) {
  const d = new Doc();
  const isPns = p.type === "pns";
  const kerja = isPns ? p.pns : p.pekerjaan;
  const issuer = isPns ? kerja.instansi : kerja.perusahaan;
  const issuerSub = isPns ? kerja.unitKerja : kerja.perusahaanAlamat;

  d.title(issuer).push(issuerSub, { size: 9 }).hr();
  d.gap(6).title(isPns ? "SLIP GAJI PEGAWAI NEGERI SIPIL" : "SLIP GAJI KARYAWAN");
  const ident = isPns
    ? [
        ["Periode", month],
        ["Nama Pegawai", namaPenghasilan(p)],
        ["NIP", kerja.nip],
        ["Pangkat / Golongan", `${kerja.pangkat} / ${kerja.golongan}`],
        ["Jabatan", kerja.jabatan],
        ["Status", "PNS - Aktif"],
      ]
    : [
        ["Periode", month],
        ["Nama Karyawan", namaPenghasilan(p)],
        ["NIK Karyawan", kerja.nipKaryawan],
        ["Jabatan", kerja.jabatan],
        ["Divisi", kerja.divisi],
        ["Status", "Karyawan Tetap"],
      ];
  d.fields(ident);

  const bruto = kerja.gajiPokok + kerja.tunjangan.reduce((s, t) => s + t[1], 0);
  const potongan = kerja.potongan.reduce((s, t) => s + t[1], 0);

  d.gap(10).push("A. PENGHASILAN", { bold: true });
  d.fields([["Gaji Pokok", fmt(kerja.gajiPokok)], ...kerja.tunjangan.map(([l, v]) => [l, fmt(v)])]);
  d.push(`Total Penghasilan Bruto : ${fmt(bruto)}`, { bold: true });
  d.gap(10).push("B. POTONGAN", { bold: true });
  d.fields(kerja.potongan.map(([l, v]) => [l, fmt(v)]));
  d.push(`Total Potongan : ${fmt(potongan)}`, { bold: true });
  d.gap(10).push(`C. GAJI BERSIH DITERIMA : ${fmt(bruto - potongan)}`, { bold: true });
  d.gap(20).push(`Diterbitkan oleh: ${isPns ? "Biro Kepegawaian" : "Bagian HRD"} ${issuer}`);
  d.push(isPns ? "Dummy Personalia, S.Sos. - Kepala Biro Kepegawaian" : "Hrd Dummy, S.Psi. - HRD Manager");
  d.footer();
  d.save(outDir, `slip-gaji-${monthTag(month)}.pdf`);
}

// --- Surat Keterangan Kerja ---
function genSkk(p, outDir) {
  const d = new Doc();
  const kerja = p.pekerjaan;
  d.title(kerja.perusahaan).push(kerja.perusahaanAlamat, { size: 9 }).hr();
  d.gap(10).push(`No. 045/HRD/IX/2026`).push("Lampiran: 1 (satu) berkas");
  d.push("Perihal: Surat Keterangan Kerja", { y: PAGE_H - 165, size: 11, x: 55 });
  d.gap(15).push("SURAT KETERANGAN KERJA", { size: 14, bold: true }).gap(10);
  d.push("Yang bertanda tangan di bawah ini menerangkan bahwa:");
  d.gap(5).fields([
    ["Nama", namaPenghasilan(p)],
    ["NIK Karyawan", kerja.nipKaryawan],
    ["Tanggal Lahir", p.tglLahirPdf],
    ["Jabatan", `${kerja.jabatan}, Divisi ${kerja.divisi}`],
    ["Status Kepegawaian", "Karyawan Tetap"],
    ["Masa Kerja", kerja.masaKerja],
    ["Gaji Per Bulan", fmt(kerja.gajiPokok)],
  ]);
  d.gap(10).push(`Adalah benar karyawan tetap ${kerja.perusahaan}. Surat keterangan ini diterbitkan`);
  d.push("untuk keperluan pengajuan Kredit Pemilikan Rumah (KPR) dan tidak dapat digunakan");
  d.push("untuk keperluan lain.");
  d.gap(25).push(`${p.kotaSurat}, 01 September 2026`, { x: 380 });
  d.push(kerja.perusahaan, { x: 380, bold: true });
  d.gap(40).push("Hrd Dummy, S.Psi.", { x: 380 }).push("HRD Manager", { x: 380, size: 10 });
  d.footer();
  d.save(outDir, "surat-keterangan-kerja.pdf");
}

// --- NIB / SIUP ---
function genNib(p, outDir) {
  const u = p.usaha;
  const d = new Doc();
  d.title("REPUBLIK INDONESIA").push("OSS - ONLINE SINGLE SUBMISSION", { size: 10 }).hr();
  d.gap(10).title("SURAT KETERANGAN NOMOR INDUK BERUSAHA (NIB)").gap(5);
  const rows = [
    ["NIB", u.nib],
    ["Tanggal Terbit", u.nibTerbit],
    ["Nama Pelaku Usaha", p.namaTitle],
    ["Jenis Usaha / Bentuk", u.bentuk],
    ["Nama Usaha", u.namaUsaha],
    ["Alamat Usaha", u.alamatUsaha],
    ["KBLI 5 Digit", u.kbli],
    ["Status Penanaman Modal", "Dalam Negeri (PMDN)"],
    ["Masa Berlaku", u.nibBerlaku],
  ];
  if (u.modalDasar) rows.splice(7, 0, ["Modal Dasar", fmt(u.modalDasar)]);
  d.fields(rows);
  if (u.nibKadaluarsa) {
    d.gap(8).push("STATUS: KADALUARSA - SEGERA LAKUKAN PERPANJANGAN", { bold: true });
  }
  d.gap(10).push("NIB ini berlaku sebagai pengganti SIUP dan Tanda Daftar Perusahaan (TDP)");
  d.push("sesuai Peraturan Pemerintah No. 5 Tahun 2021.");
  d.gap(20).push("Diterbitkan melalui sistem OSS - Direktorat Jenderal Penanaman Modal").push("Oss Dummy Admin - Verifikator");
  d.footer();
  d.save(outDir, "siup-nib.pdf");
}

// --- Akta Pendirian Usaha ---
function genAkta(p, outDir) {
  const u = p.usaha;
  const a = u.akta;
  const d = new Doc();
  d.title(`AKTA PENDIRIAN ${u.bentuk.toUpperCase()}`).push(u.namaUsaha, { size: 12, bold: true }).hr();
  d.gap(8).fields([
    ["Akta No.", a.no],
    ["Tanggal Akta", a.tanggal],
    ["Notaris", a.notaris],
    ["Alamat Notaris", "Jl. Dummy Utama No. 5, Jakarta Selatan"],
    ["Pemegang Saham", `${p.namaTitle} (NIK ${p.nik}) - 100%`],
    ["Modal Dasar", fmt(a.modalDasar)],
    ["Modal Ditempatkan", fmt(a.modalDitempatkan)],
    ["Direktur", p.namaTitle],
    ["Kegiatan Usaha", a.kegiatanUsaha],
    ["Alamat Kantor", u.alamatUsaha],
  ]);
  d.gap(10).push(`Pengesahan: SK Kemenkumham RI No. ${a.skKemenkumham}`);
  d.gap(20).push("Demikian akta pendirian perseroan terbatas ini dibuat dalam rangkap sesuai");
  d.push("ketentuan peraturan perundang-undangan yang berlaku.");
  d.gap(25).push("Notaris,", { x: 400 }).gap(40).push(a.notaris, { x: 360 });
  d.footer();
  d.save(outDir, "akta-pendirian-usaha.pdf");
}

// --- Surat Izin Praktik (SIP) ---
function genSip(p, outDir) {
  const pr = p.profesi;
  const sip = pr.sip;
  const d = new Doc();
  d.title("PEMERINTAH KOTA JAKARTA SELATAN").push("DINAS KESEHATAN", { size: 12, bold: true }).hr();
  d.gap(10).title("SURAT IZIN PRAKTIK DOKTER").gap(5);
  d.fields([
    ["Nomor SIP", sip.no],
    ["Nama Dokter", pr.gelar],
    ["No. STR", pr.noStr],
    ["Tanggal Lahir", p.tglLahirPdf],
    ["Nama Fasilitas Pelayanan", sip.fasilitas],
    ["Alamat Fasilitas", sip.alamatFasilitas],
    ["Masa Berlaku", sip.berlaku],
  ]);
  if (sip.expired) {
    d.gap(8).push("STATUS: KADALUARSA - SUDAH MELEWATI MASA BERLAKU", { bold: true });
  }
  d.gap(10).push("Berdasarkan UU No. 17 Tahun 2023 tentang Kesehatan, bersedia memberikan izin");
  d.push("kepada yang bersangkutan untuk melakukan praktik kedokteran pada fasilitas");
  d.push("pelayanan kesehatan tersebut di atas.");
  d.gap(25).push(`${p.kotaSurat}, ${sip.terbit}`, { x: 390 });
  d.push("Kepala Dinas Kesehatan", { x: 390, bold: true });
  d.gap(40).push("dr. Dummy Wijaya, M.Kes.", { x: 390 }).push("NIP. 197001012000121001 (fiktif)", { x: 390, size: 9 });
  d.footer();
  d.save(outDir, "surat-izin-praktik.pdf");
}

// --- IMB / PBG ---
function genPbg(p, outDir) {
  const pr = p.properti;
  const d = new Doc();
  d.title(`PEMERINTAH ${p.alamat.kota}`).push("DINAS CIPTA KARYA DAN TATA RUANG", { size: 11, bold: true }).hr();
  d.gap(10).title("PERSSETUJUAN BANGUNAN GEDUNG (PBG)").gap(5);
  d.fields([
    ["Nomor PBG", pr.pbgNo],
    ["Tanggal Terbit", pr.pbgTanggal],
    ["Nama Pemilik", p.namaTitle],
    ["Alamat Bangunan", alamatSatuBaris(p)],
    ["Fungsi Bangunan", "Hunian (Rumah Tinggal)"],
    ["Luas Tanah", pr.luasTanah],
    ["Luas Bangunan", `${pr.luasBangunan} (2 lantai)`],
    ["Penggunaan Air", "PDAM"],
    ["Gempa Zona", "Sedang"],
    ["Masa Berlaku", "Selama bangunan gedung berdiri"],
  ]);
  d.gap(10).push("PBG ini diterbitkan sebagai pengganti IMB sesuai Peraturan Pemerintah No. 16");
  d.push("Tahun 2021. Bangunan wajib dibangun sesuai rencana teknis yang disetujui.");
  d.gap(25).push(`${p.kotaSurat}, ${pr.pbgTanggal}`, { x: 390 });
  d.push("Kepala Dinas Cipta Karya dan Tata Ruang", { x: 330, bold: true });
  d.gap(40).push("Ir. Dummy Prasetyo, M.T.", { x: 390 });
  d.footer();
  d.save(outDir, "imb-pbg.pdf");
}

// --- SPPT PBB + Bukti Bayar ---
function genPbb(p, outDir) {
  const pr = p.properti;
  const d = new Doc();
  d.title(`PEMERINTAH ${p.alamat.kota} - BADAN PENDAPATAN DAERAH`);
  d.push("SURAT PEMBERITAHUAN PAJAK TERHUTANG (SPPT) PAJAK BUMI DAN BANGUNAN - TAHUN 2026", { size: 9 }).hr();
  d.gap(8).fields([
    ["NOP (Nomor Objek Pajak)", pr.nop],
    ["Nama Wajib Pajak", p.namaTitle],
    ["Alamat Objek Pajak", alamatSatuBaris(p)],
    ["Luas Tanah / Bumi", pr.luasTanah],
    ["Luas Bangunan", pr.luasBangunan],
    ["PBB Terhutang 2026", fmt(pr.pbbTerhutang)],
    ["Jatuh Tempo", "31 Desember 2026"],
  ]);
  d.gap(15).hr();
  d.gap(5).title("BUKTI PEMBAYARAN PBB TAHUN 2026").gap(2);
  d.fields([
    ["Tanggal Pembayaran", pr.pbbBayarTanggal],
    ["Tempat Pembayaran", "Bank Dummy Indonesia"],
    ["Jumlah Dibayar", `${fmt(pr.pbbTerhutang)} (lunas)`],
    ["No. Transaksi", pr.pbbTrx],
  ]);
  d.push("STATUS: TELAH DIBAYAR / LUNAS", { bold: true });
  d.footer();
  d.save(outDir, "pbb-sppt.pdf");
}

// --- AJB (Akta Jual Beli) ---
function genAjb(p, outDir) {
  const pr = p.properti;
  const d = new Doc();
  d.title("AKTA JUAL BELI (AJB)").push("PEJABAT PEMBUAT AKTA TANAH (PPAT)", { size: 10 }).hr();
  d.gap(8).fields([
    ["Akta Jual Beli No.", pr.ajbNo],
    ["Tanggal Akta", pr.ajbTanggal],
    ["PPAT", "PPAT Dummy Rahayu, S.H."],
    ["Alamat PPAT", "Jl. Dummy Utama No. 5, Jakarta Selatan"],
  ]);
  d.gap(8).push("PIHAK PENJUAL (PARA PIHAK PERTAMA):", { bold: true }).fields([
    ["Nama", pr.penjual],
    ["NIK", pr.penjualNik],
    ["Alamat", "Jl. Dummy Lama No. 3, Jakarta Selatan"],
  ]);
  d.gap(5).push("PIHAK PEMBELI (PARA PIHAK KEDUA):", { bold: true }).fields([
    ["Nama", p.namaTitle],
    ["NIK", p.nik],
    ["Alamat", alamatSatuBaris(p)],
  ]);
  d.gap(5).push("OBJEK TRANSAKSI:", { bold: true }).fields([
    ["Hak", `Hak Milik (SHM No. ${pr.shmNo})`],
    ["Letak", alamatSatuBaris(p)],
    ["Luas Tanah", pr.luasTanah],
    ["Harga Transaksi", fmt(pr.harga)],
  ]);
  d.gap(5).push("Pihak Pertama menjual kepada Pihak Kedua, dan Pihak Kedua menerima pembelian");
  d.push("atas objek tersebut dengan harga di atas, dibayar tunai dan dinyatakan lunak.");
  d.gap(15).push(`PENJUAL: ${pr.penjual}          PEMBELI: ${p.namaTitle}          SAKSI-PPAT: Dummy Rahayu, S.H.`, { size: 9 });
  d.footer();
  d.save(outDir, "ajb.pdf");
}

// --- SK Pengangkatan (PNS) ---
function genSkPengangkatan(p, outDir) {
  const n = p.pns;
  const d = new Doc();
  d.title(n.instansi).push(n.unitKerja, { size: 11, bold: true }).hr();
  d.gap(10).title("SURAT KEPUTUSAN KEPALA DINAS PENDAPATAN DAERAH");
  d.fields([
    ["Nomor", n.skPengangkatanNo],
    ["Tentang", "Pengangkatan PNS dalam Jabatan"],
  ]);
  d.gap(10).push("Yang bertanda tangan di bawah ini:");
  d.fields([
    ["Nama", "Ir. Dummy Prasetyo, M.T."],
    ["NIP", "196505011990031001 (fiktif)"],
    ["Jabatan", "Kepala Dinas Pendapatan Daerah"],
  ]);
  d.gap(10).push("Menetapkan:");
  d.gap(5).fields([
    ["Nama", p.namaTitle],
    ["NIP", n.nip],
    ["Unit Kerja", n.unitKerja],
    ["Jabatan", n.jabatan],
    ["Terhitung Mulai Tanggal", n.tmtPengangkatan],
  ]);
  d.gap(10).push("Surat keputusan ini digunakan untuk keperluan administrasi kepegawaian dan");
  d.push("pengajuan fasilitas keuangan yang bersangkutan.");
  d.gap(25).push(`${p.kotaSurat}, ${n.tmtPengangkatan}`, { x: 380 });
  d.push("KEPALA DINAS PENDAPATAN DAERAH", { x: 360, bold: true });
  d.gap(40).push("Ir. Dummy Prasetyo, M.T.", { x: 390 });
  d.footer();
  d.save(outDir, "sk-pengangkatan.pdf");
}

// --- SK Pangkat (PNS) ---
function genSkPangkat(p, outDir) {
  const n = p.pns;
  const d = new Doc();
  d.title(n.instansi).push(n.unitKerja, { size: 11, bold: true }).hr();
  d.gap(10).title("SURAT KEPUTUSAN KEPALA DINAS PENDAPATAN DAERAH");
  d.fields([
    ["Nomor", n.skPangkatNo],
    ["Tentang", "Kenaikan Pangkat PNS"],
  ]);
  d.gap(10).push("Yang bertanda tangan di bawah ini:");
  d.fields([
    ["Nama", "Ir. Dummy Prasetyo, M.T."],
    ["NIP", "196505011990031001 (fiktif)"],
    ["Jabatan", "Kepala Dinas Pendapatan Daerah"],
  ]);
  d.gap(10).push("Menetapkan:");
  d.gap(5).fields([
    ["Nama", p.namaTitle],
    ["NIP", n.nip],
    ["Pangkat / Golongan Ruang", `${n.pangkat} / ${n.golongan}`],
    ["Jabatan", n.jabatan],
    ["TMT Pangkat", n.tmtPangkat],
  ]);
  d.gap(10).push("Surat keputusan ini digunakan untuk keperluan administrasi kepegawaian dan");
  d.push("pengajuan fasilitas keuangan yang bersangkutan.");
  d.gap(25).push(`${p.kotaSurat}, ${n.tmtPangkat}`, { x: 380 });
  d.push("KEPALA DINAS PENDAPATAN DAERAH", { x: 360, bold: true });
  d.gap(40).push("Ir. Dummy Prasetyo, M.T.", { x: 390 });
  d.footer();
  d.save(outDir, "sk-pangkat.pdf");
}

// --- Laporan Keuangan (wiraswasta) ---
function genLaporanKeuangan(p, outDir) {
  const u = p.usaha;
  const d = new Doc();
  const kas = 450000000;
  const piutang = 320000000;
  const asetTetap = 1200000000;
  const kewajiban = 380000000;
  const ekuitas = kas + piutang + asetTetap - kewajiban;
  const pendapatan = u.omzetBulanan * 8;
  const hpp = Math.round(pendapatan * 0.71);
  const beban = Math.round(pendapatan * 0.185);
  const labaBersih = pendapatan - hpp - beban;

  d.title(u.namaUsaha).push(u.alamatUsaha, { size: 9 }).hr();
  d.gap(8).title("LAPORAN POSISI KEUANGAN (NERACA) RINGKAS");
  d.push("Per 31 Agustus 2026 - (dalam Rupiah, tidak diaudit)", { size: 9 });
  d.gap(8).push("ASET", { bold: true });
  d.fields([
    ["Kas dan setara kas", fmt(kas)],
    ["Piutang usaha", fmt(piutang)],
    ["Aset tetap (tanah dan bangunan)", fmt(asetTetap)],
  ]);
  d.push(`TOTAL ASET : ${fmt(kas + piutang + asetTetap)}`, { bold: true });
  d.gap(10).push("KEWAJIBAN DAN EKUITAS", { bold: true });
  d.fields([
    ["Kewajiban bank (kredit modal kerja)", fmt(kewajiban)],
    ["Ekuitas pemilik", fmt(ekuitas)],
  ]);
  d.push(`TOTAL KEWAJIBAN DAN EKUITAS : ${fmt(kewajiban + ekuitas)}`, { bold: true });
  d.gap(15).hr();
  d.gap(5).title("LAPORAN LABA RUGI RINGKAS");
  d.push("Periode 1 Januari s/d 31 Agustus 2026 - (dalam Rupiah, tidak diaudit)", { size: 9 });
  d.gap(8).fields([
    ["Pendapatan usaha", fmt(pendapatan)],
    ["Beban pokok pendapatan", `(${fmt(hpp)})`],
    ["Beban operasional", `(${fmt(beban)})`],
  ]);
  d.push(`LABA BERSIH : ${fmt(labaBersih)}`, { bold: true });
  d.gap(20).push("Disusun oleh: Bagian Keuangan").push("Dummy Sulistyo, S.E. - Finance Manager");
  d.footer();
  d.save(outDir, "laporan-keuangan.pdf");
}

// --- Rekening Koran Usaha (wiraswasta, per bulan) ---
function genRekKoranUsaha(p, month, outDir) {
  const u = p.usaha;
  const [name, year] = month.split(" ");
  const mo = String(MONTHS[name]).padStart(2, "0");
  const d = new Doc();
  d.title(u.rekUsahaBank).push("REKENING KORAN USAHA / MUTASI REKENING PERUSAHAAN", { size: 10 }).hr();
  d.gap(6).fields([
    ["Nama Nasabah", u.namaUsaha],
    ["No. Rekening", u.noRekUsaha],
    ["Periode", `01 ${name.toUpperCase()} ${year} - 28 ${name.toUpperCase()} ${year}`],
    ["Mata Uang", "IDR"],
  ]);

  const om = u.omzetBulanan;
  let saldo = Math.round(om * 0.4);
  const saldoAwal = saldo;
  const rows = [
    ["05", "PEMBAYARAN KLIEN PT DUMMY BANGUN SEJAHTERA", 0, Math.round(om * 0.35)],
    ["08", "TRANSFER MASUK - UANG MUKA PROYEK", 0, Math.round(om * 0.12)],
    ["10", "PEMBAYARAN SUPPLIER MATERIAL", Math.round(om * 0.25), 0],
    ["14", "PEMBAYARAN GAJI KARYAWAN", Math.round(om * 0.18), 0],
    ["19", "PEMBAYARAN KLIEN CV DUMMY KONTRAKTOR", 0, Math.round(om * 0.2)],
    ["22", "TAGIHAN LISTRIK, AIR DAN TELEPON", 3500000, 0],
    ["27", "PEMBAYARAN KLIEN PT DUMMY PROPERTI", 0, Math.round(om * 0.18)],
    ["28", "BIAYA ADMINISTRASI BANK", 250000, 0],
  ];
  d.gap(10).push("TANGGAL      KETERANGAN                                    DEBIT           KREDIT          SALDO", { size: 9, bold: true });
  d.push("-".repeat(88), { size: 9 });
  d.fields([
    ["Saldo Awal", fmt(saldoAwal)],
    ...rows.map(([day, ket, dbt, krd]) => {
      saldo = saldo - dbt + krd;
      return [`${day}/${mo}/${String(year).slice(2)} ${ket}`, `${dbt ? fmt(dbt) : "0"}`.padEnd(14) + `${krd ? fmt(krd) : "0"}`.padEnd(15) + fmt(saldo)];
    }),
  ]);
  d.gap(8).push(`SALDO AKHIR : ${fmt(saldo)}`, { bold: true });
  d.footer();
  d.save(outDir, `rekening-koran-usaha-${year}-${mo}.pdf`);
}

// --- Routing per persona ---
for (const p of SELECTED) {
  const outDir = path.join(OUT_ROOT, p.id);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`== ${p.id} : ${p.nama} ==`);
  const d = p.dokumen;

  if (d.slipGaji) for (const m of d.slipGaji) genSlipGaji(p, m, outDir);
  if (d.skk) genSkk(p, outDir);
  if (d.nib) genNib(p, outDir);
  if (d.akta) genAkta(p, outDir);
  if (d.sip) genSip(p, outDir);
  if (d.skPengangkatan) genSkPengangkatan(p, outDir);
  if (d.skPangkat) genSkPangkat(p, outDir);
  if (d.rekKoranUsaha) for (const m of d.rekKoranUsaha) genRekKoranUsaha(p, m, outDir);
  if (d.laporanKeuangan) genLaporanKeuangan(p, outDir);
  if (d.properti) {
    genPbg(p, outDir);
    genPbb(p, outDir);
    genAjb(p, outDir);
  }
}

console.log("PDF generation done.");
