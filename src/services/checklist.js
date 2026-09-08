const IDENTITAS = [
  {
    key: 'ktp', name: 'KTP (pemohon & pasangan bila menikah)',
    rules: [
      'KTP masih berlaku dan NIK terdaftar Dukcapil.',
      'Ejaan nama harus sama persis dengan semua dokumen lain (KK, NPWP, slip gaji).',
    ],
  },
  {
    key: 'kartu_keluarga', name: 'Kartu Keluarga',
    rules: ['Data KK sesuai KTP; status perkawinan tercantum.'],
  },
  {
    key: 'npwp', name: 'NPWP pribadi',
    rules: ['NPWP aktif dan SPT tahunan sudah dilaporkan; alamat NPWP sinkron dengan KTP.'],
  },
  {
    key: 'surat_nikah', name: 'Surat Nikah / Akta Cerai (jika relevan)',
    rules: ['Diperlukan bila pemohon menikah/pernah menikah; data sesuai KK.'],
  },
];

const PROPERTI = [
  {
    key: 'sertifikat', name: 'Sertifikat SHM/SHGB',
    rules: [
      'Sertifikat harus atas nama penjual (properti second) atau atas nama pemohon (take over).',
      'Sisa masa berlaku SHGB/HGB harus lebih panjang dari tenor kredit.',
      'Tidak sedang dijaminkan, diblokir, atau sengketa.',
    ],
  },
  {
    key: 'imb_pbg', name: 'IMB / PBG',
    rules: ['Wajib ada; nama pemilik sesuai sertifikat. Tanpa IMB/PBG pengajuan ditolak.'],
  },
  {
    key: 'pbb', name: 'PBB (SPPT) + bukti bayar terakhir',
    rules: ['SPPT tahun terakhir sudah lunas; nama wajib pajak sesuai sertifikat.'],
  },
  {
    key: 'ajb', name: 'AJB (Akta Jual Beli)',
    rules: ['Wajib untuk properti second; nama dan luas tanah sesuai sertifikat.'],
  },
];

const PROFESSIONS = {
  karyawan: {
    key: 'karyawan', label: 'Karyawan',
    documents: [
      ...IDENTITAS,
      {
        key: 'slip_gaji', name: 'Slip Gaji (1–3 bulan terakhir)',
        rules: [
          'Slip gaji maksimal 3 bulan terakhir (idealnya 1 bulan).',
          'Harus bercap/stempel basah HRD; tanpa stempel dianggap tidak valid.',
          'Penghasilan di slip gaji harus konsisten dengan mutasi rekening koran.',
        ],
      },
      {
        key: 'skk', name: 'Surat Keterangan Kerja',
        rules: [
          'Berusia maksimal 1 bulan sejak diterbitkan.',
          'Memuat kop perusahaan, nomor surat, tanggal, status kepegawaian, masa kerja, dan stempel basah.',
        ],
      },
      {
        key: 'rekening_koran', name: 'Rekening Koran (3 bulan terakhir)',
        rules: ['Mutasi 3 bulan terakhir, dicetak/stempel bank; pola gaji masuk rutin.'],
      },
      ...PROPERTI,
    ],
  },
  wiraswasta: {
    key: 'wiraswasta', label: 'Wiraswasta / Wirausaha',
    documents: [
      ...IDENTITAS,
      {
        key: 'nib_siup', name: 'NIB / SIUP / TDP',
        rules: ['Status izin harus aktif/berlaku; kadaluarsa = ditolak.'],
      },
      {
        key: 'akta_pendirian', name: 'Akta Pendirian & Perubahan Terakhir',
        rules: ['Versi perubahan terkini; akta pengesahan Menkeh untuk PT/CV.'],
      },
      {
        key: 'laporan_keuangan', name: 'Laporan Keuangan / Neraca & Laba Rugi',
        rules: ['Laporan keuangan 2 tahun terakhir (neraca + laba rugi) dan konsisten dengan mutasi rekening.'],
      },
      {
        key: 'rekening_koran', name: 'Rekening Koran Usaha (6 bulan terakhir)',
        rules: ['Mutasi 6 bulan terakhir untuk penghasilan non-fixed income.'],
      },
      ...PROPERTI,
    ],
  },
  profesional: {
    key: 'profesional', label: 'Profesional (Dokter, Notaris, Arsitek, dll.)',
    documents: [
      ...IDENTITAS,
      {
        key: 'sip', name: 'Surat Izin Praktik (SIP)',
        rules: ['SIP harus masih berlaku/aktif; kadaluarsa perlu surat perpanjangan dari instansi.'],
      },
      {
        key: 'rekening_koran', name: 'Rekening Koran (3–6 bulan terakhir)',
        rules: ['Mutasi 3–6 bulan terakhir; penghasilan dinilai dari rata-rata mutasi, bukan satu bulan.'],
      },
      ...PROPERTI,
    ],
  },
  bumn_pns: {
    key: 'bumn_pns', label: 'Karyawan BUMN / BUMD / PNS / Bank',
    documents: [
      ...IDENTITAS,
      {
        key: 'sk_pengangkatan', name: 'SK Pengangkatan (pertama / pegawai)',
        rules: ['SK pengangkatan resmi dari instansi; data sesuai KTP.'],
      },
      {
        key: 'sk_pangkat', name: 'SK Pangkat/Jabatan Terakhir',
        rules: ['SK pangkat terakhir harus sesuai jabatan saat ini.'],
      },
      {
        key: 'slip_gaji', name: 'Slip Gaji (3 bulan terakhir)',
        rules: ['Slip gaji 3 bulan terakhir, bercap basah instansi.'],
      },
      {
        key: 'rekening_koran', name: 'Rekening Koran (3 bulan terakhir)',
        rules: ['Mutasi 3 bulan terakhir dengan stempel bank.'],
      },
      ...PROPERTI,
    ],
  },
};

const getProfession = (key) => PROFESSIONS[key];
const findDocument = (professionKey, docKey) =>
  PROFESSIONS[professionKey]?.documents.find((d) => d.key === docKey);

module.exports = { PROFESSIONS, getProfession, findDocument };
