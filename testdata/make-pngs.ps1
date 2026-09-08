# Generates dummy PNG documents (KTP, Kartu Keluarga, NPWP, rekening koran,
# sertifikat SHM) for KPR chatbot testing personas. All data is fictional.
# Requires PowerShell 7+ with System.Drawing.
#
# Usage:
#   pwsh make-pngs.ps1                          -> generate for ALL personas in personas.json
#   pwsh make-pngs.ps1 -PersonaId persona-01    -> generate for one persona
#
# Output: D:\Project\Chatbot\testdata\dummy-customers\<persona-id>\*.png

param(
    [string]$PersonaId = "",
    [string]$RootDir = "D:\Project\Chatbot\testdata"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$Personas = Get-Content -LiteralPath (Join-Path $RootDir "personas.json") -Raw | ConvertFrom-Json
if ($PersonaId) {
    $Selected = @($Personas | Where-Object { $_.id -eq $PersonaId })
} else {
    $Selected = @($Personas)
}
if ($Selected.Count -eq 0) { throw "Persona not found: $PersonaId" }

$script:OutDir = ""
$script:CurPersona = $null

function Fmt-Num {
    param([double]$n)
    ([string]::Format([System.Globalization.CultureInfo]::InvariantCulture, "{0:N0}", $n)).Replace(",", ".")
}

function New-DocPng {
    param(
        [string]$File,
        [int]$W = 900,
        [int]$H = 600,
        [scriptblock]$Draw,
        [string]$Watermark = "DUMMY"
    )
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.Clear([System.Drawing.Color]::White)

    & $Draw $g $W $H $script:CurPersona

    if ($Watermark) {
        $wmFont = New-Object System.Drawing.Font("Segoe UI", [float]($H / 6), [System.Drawing.FontStyle]::Bold)
        $wmBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(45, 128, 128, 128))
        $g.RotateTransform(-25)
        $g.DrawString($Watermark, $wmFont, $wmBrush, [float]($W * 0.08), [float]($H * 0.35))
        $g.ResetTransform()
        $wmFont.Dispose(); $wmBrush.Dispose()
    }

    $g.Dispose()
    $path = Join-Path $script:OutDir $File
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "Created $path"
}

function Field {
    param($g, [string]$Label, [string]$Value, [float]$X, [float]$Y)
    $lf = New-Object System.Drawing.Font("Segoe UI", 11)
    $vf = New-Object System.Drawing.Font("Consolas", 13, [System.Drawing.FontStyle]::Bold)
    $lbr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 90, 90))
    $vbr = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(20, 20, 20))
    $g.DrawString($Label, $lf, $lbr, $X, $Y)
    $g.DrawString($Value, $vf, $vbr, $X, $Y + 17)
    $lf.Dispose(); $vf.Dispose(); $lbr.Dispose(); $vbr.Dispose()
}

function Get-AlamatSatuBaris {
    param($p)
    "$($p.alamat.jalan), RT $($p.alamat.rt)/RW $($p.alamat.rw), KEL. $($p.alamat.kel), KEC. $($p.alamat.kec), $($p.alamat.kota), $($p.alamat.kodePos)"
}

# --- KTP ---
function New-Ktp {
    New-DocPng -File "ktp.png" -W 1010 -H 640 -Watermark "DUMMY" -Draw {
        param($g, $W, $H, $p)
        $headerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(21, 62, 153))
        $g.FillRectangle($headerBrush, 0, 0, $W, 70)
        $titleFont = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
        $whiteBrush = [System.Drawing.Brushes]::White
        $g.DrawString($p.ktpHeader, $titleFont, $whiteBrush, 25, 12)
        $g.DrawString("KARTU TANDA PENDUDUK (KTP)", (New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)), $whiteBrush, 25, 44)
        $titleFont.Dispose()

        $nikFont = New-Object System.Drawing.Font("Consolas", 22, [System.Drawing.FontStyle]::Bold)
        $g.DrawString("NIK", (New-Object System.Drawing.Font("Segoe UI", 10)), [System.Drawing.Brushes]::Gray, 30, 85)
        $g.DrawString($p.nik, $nikFont, [System.Drawing.Brushes]::Black, 80, 80)
        $nikFont.Dispose()

        Field $g "Nama" $p.nama 30 125
        Field $g "Tempat/Tgl Lahir" "$($p.tempatLahir), $($p.tglLahir)" 30 175
        Field $g "Jenis Kelamin" "$($p.gender)    Gol. Darah: $($p.golDarah)" 30 225
        Field $g "Alamat" $p.alamat.jalan 30 275
        Field $g "RT/RW" "$($p.alamat.rt)/$($p.alamat.rw)" 30 325
        Field $g "Kel/Desa" $p.alamat.kel 250 325
        Field $g "Kecamatan" $p.alamat.kec 30 375
        Field $g "Agama" $p.agama 250 375
        Field $g "Status Perkawinan" $p.status 30 425
        Field $g "Pekerjaan" $p.pekerjaanKtp 250 425
        Field $g "Kewarganegaraan" "WNI" 30 475
        Field $g "Berlaku Hingga" "SEUMUR HIDUP" 30 525

        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Gray, 2)
        $g.DrawRectangle($pen, 780, 110, 170, 220)
        $phFont = New-Object System.Drawing.Font("Segoe UI", 12)
        $g.DrawString("FOTO DUMMY", $phFont, [System.Drawing.Brushes]::Gray, 800, 205)
        $g.DrawRectangle($pen, 780, 350, 170, 90)
        $g.DrawString("CHIP DUMMY", $phFont, [System.Drawing.Brushes]::Gray, 805, 382)
        $pen.Dispose(); $phFont.Dispose()
    }
}

# --- Kartu Keluarga ---
function New-Kk {
    New-DocPng -File "kartu-keluarga.png" -W 1010 -H 700 -Watermark "DUMMY" -Draw {
        param($g, $W, $H, $p)
        $headerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(140, 120, 20))
        $g.FillRectangle($headerBrush, 0, 0, $W, 90)
        $titleFont = New-Object System.Drawing.Font("Segoe UI", 24, [System.Drawing.FontStyle]::Bold)
        $g.DrawString("KARTU KELUARGA", $titleFont, [System.Drawing.Brushes]::White, 300, 15)
        $titleFont.Dispose()
        $noFont = New-Object System.Drawing.Font("Consolas", 14, [System.Drawing.FontStyle]::Bold)
        $g.DrawString("No. $($p.noKk)/2026/0001", $noFont, [System.Drawing.Brushes]::White, 330, 58)
        $noFont.Dispose()

        Field $g "Kepala Keluarga" $p.kkAnggota[0][0] 30 105
        Field $g "Alamat" (Get-AlamatSatuBaris $p) 30 150
        Field $g "Kab/Kota" $p.alamat.kota 30 200
        Field $g "Provinsi" $p.alamat.prov 350 200
        Field $g "Kode Pos" $p.alamat.kodePos 620 200

        $hdrBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 220, 220))
        $g.FillRectangle($hdrBrush, 20, 260, 970, 28)
        $colFont = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
        $g.DrawString("NAMA LENGKAP", $colFont, [System.Drawing.Brushes]::Black, 30, 264)
        $g.DrawString("NIK", $colFont, [System.Drawing.Brushes]::Black, 340, 264)
        $g.DrawString("JENIS KELAMIN", $colFont, [System.Drawing.Brushes]::Black, 610, 264)
        $g.DrawString("STATUS", $colFont, [System.Drawing.Brushes]::Black, 790, 264)
        $g.DrawString("HUBUNGAN KELUARGA", $colFont, [System.Drawing.Brushes]::Black, 880, 264)

        $rowFont = New-Object System.Drawing.Font("Consolas", 12)
        $y = 300
        foreach ($r in $p.kkAnggota) {
            $g.DrawString($r[0], $rowFont, [System.Drawing.Brushes]::Black, 30, $y)
            $g.DrawString($r[1], $rowFont, [System.Drawing.Brushes]::Black, 340, $y)
            $g.DrawString($r[2], $rowFont, [System.Drawing.Brushes]::Black, 610, $y)
            $g.DrawString($r[3], $rowFont, [System.Drawing.Brushes]::Black, 790, $y)
            $g.DrawString($r[4], $rowFont, [System.Drawing.Brushes]::Black, 880, $y)
            $y += 40
        }
        $rowFont.Dispose(); $colFont.Dispose(); $hdrBrush.Dispose()
    }
}

# --- NPWP ---
function New-Npwp {
    New-DocPng -File "npwp.png" -W 900 -H 520 -Watermark "DUMMY" -Draw {
        param($g, $W, $H, $p)
        $headerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(170, 120, 20))
        $g.FillRectangle($headerBrush, 0, 0, $W, 80)
        $titleFont = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
        $g.DrawString("KARTU NPWP", $titleFont, [System.Drawing.Brushes]::White, 25, 10)
        $g.DrawString("NOMOR POKOK WAJIB PAJAK", (New-Object System.Drawing.Font("Segoe UI", 13)), [System.Drawing.Brushes]::White, 25, 48)
        $titleFont.Dispose()

        $npwpFont = New-Object System.Drawing.Font("Consolas", 24, [System.Drawing.FontStyle]::Bold)
        $g.DrawString($p.npwp, $npwpFont, [System.Drawing.Brushes]::Black, 30, 100)
        $npwpFont.Dispose()

        $namaUsaha = if ($p.npwpNamaUsaha) { $p.npwpNamaUsaha } else { "-" }
        Field $g "Nama" $p.nama 30 155
        Field $g "Nama Usaha / Instansi" $namaUsaha 30 205
        Field $g "Alamat" (Get-AlamatSatuBaris $p) 30 255
        Field $g "Kode Pos" $p.alamat.kodePos 30 305
        Field $g "Status Wajib Pajak" "NORMAL / AKTIF" 30 355
        Field $g "KPP" $p.kpp 30 405
    }
}

# --- Rekening Koran (personal, Agustus 2026) ---
function New-RekKoran {
    New-DocPng -File "rekening-koran.png" -W 1010 -H 760 -Watermark "DUMMY" -Draw {
        param($g, $W, $H, $p)
        $headerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(15, 90, 60))
        $g.FillRectangle($headerBrush, 0, 0, $W, 80)
        $titleFont = New-Object System.Drawing.Font("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
        $g.DrawString("BANK DUMMY INDONESIA", $titleFont, [System.Drawing.Brushes]::White, 25, 10)
        $g.DrawString("REKENING KORAN / MUTASI REKENING", (New-Object System.Drawing.Font("Segoe UI", 13)), [System.Drawing.Brushes]::White, 25, 48)
        $titleFont.Dispose()

        Field $g "Nama Nasabah" $p.namaTitle 25 95
        Field $g "No. Rekening" $p.rek.noRek 350 95
        Field $g "Periode" "01 AGUSTUS 2026 - 31 AGUSTUS 2026" 600 95
        Field $g "Mata Uang" "IDR" 25 145

        $saldo = [double]$p.rek.saldoAwal
        $saldoAwal = $saldo
        $saldo += $p.rek.kreditUtama;   $r1 = (Fmt-Num $p.rek.kreditUtama), (Fmt-Num $saldo)
        $saldo -= 500000;  $r2 = "500.000", "0", (Fmt-Num $saldo)
        $saldo -= 1250000; $r3 = "1.250.000", "0", (Fmt-Num $saldo)
        $saldo += 5000000; $r4 = "0", "5.000.000", (Fmt-Num $saldo)
        $saldo -= 850000;  $r5 = "850.000", "0", (Fmt-Num $saldo)
        $saldo += 3000000; $r6 = "0", "3.000.000", (Fmt-Num $saldo)
        $saldo -= 2000000; $r7 = "2.000.000", "0", (Fmt-Num $saldo)
        $saldo += 350000;  $r8 = "0", "350.000", (Fmt-Num $saldo)

        Field $g "Saldo Awal" (Fmt-Num $saldoAwal) 350 145
        Field $g "Saldo Akhir" (Fmt-Num $saldo) 600 145

        $colFont = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
        $hdrBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(220, 220, 220))
        $g.FillRectangle($hdrBrush, 20, 205, 970, 28)
        $g.DrawString("TANGGAL", $colFont, [System.Drawing.Brushes]::Black, 30, 209)
        $g.DrawString("KETERANGAN", $colFont, [System.Drawing.Brushes]::Black, 150, 209)
        $g.DrawString("DEBIT", $colFont, [System.Drawing.Brushes]::Black, 560, 209)
        $g.DrawString("KREDIT", $colFont, [System.Drawing.Brushes]::Black, 700, 209)
        $g.DrawString("SALDO", $colFont, [System.Drawing.Brushes]::Black, 860, 209)

        $rows = @(
            @("01/08/26", $p.rek.sumberUtama, "0", $r1[0], $r1[1]),
            @("03/08/26", "TRANSFER KELUAR", $r2[0], "0", $r2[2]),
            @("08/08/26", "BELANJA ONLINE", $r3[0], "0", $r3[2]),
            @("10/08/26", "SETORAN TUNAI", "0", $r4[1], $r4[2]),
            @("15/08/26", "PEMBAYARAN LISTRIK", $r5[0], "0", $r5[2]),
            @("20/08/26", "TRANSFER MASUK", "0", $r6[1], $r6[2]),
            @("25/08/26", "TAGIHAN KARTU KREDIT", $r7[0], "0", $r7[2]),
            @("31/08/26", "BUNGA TABUNGAN", "0", $r8[1], $r8[2])
        )

        $rowFont = New-Object System.Drawing.Font("Consolas", 12)
        $y = 245
        foreach ($r in $rows) {
            $g.DrawString($r[0], $rowFont, [System.Drawing.Brushes]::Black, 30, $y)
            $g.DrawString($r[1], $rowFont, [System.Drawing.Brushes]::Black, 150, $y)
            $g.DrawString($r[2], $rowFont, [System.Drawing.Brushes]::Black, 560, $y)
            $g.DrawString($r[3], $rowFont, [System.Drawing.Brushes]::Black, 700, $y)
            $g.DrawString($r[4], $rowFont, [System.Drawing.Brushes]::Black, 860, $y)
            $y += 36
        }
        $rowFont.Dispose(); $colFont.Dispose(); $hdrBrush.Dispose()
    }
}

# --- Sertifikat SHM ---
function New-Shm {
    New-DocPng -File "sertifikat-shm.png" -W 900 -H 700 -Watermark "DUMMY" -Draw {
        param($g, $W, $H, $p)
        $pr = $p.properti
        $pen1 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(0, 100, 60), 6)
        $pen2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(0, 100, 60), 2)
        $g.DrawRectangle($pen1, 12, 12, $W - 24, $H - 24)
        $g.DrawRectangle($pen2, 26, 26, $W - 52, $H - 52)
        $pen1.Dispose(); $pen2.Dispose()

        $titleFont = New-Object System.Drawing.Font("Georgia", 26, [System.Drawing.FontStyle]::Bold)
        $g.DrawString("SERTIFIKAT HAK MILIK (SHM)", $titleFont, [System.Drawing.Brushes]::Black, 200, 55)
        $titleFont.Dispose()
        $subFont = New-Object System.Drawing.Font("Georgia", 13)
        $g.DrawString("KANTOR PERTANAHAN KOTA $($p.alamat.kota)", $subFont, [System.Drawing.Brushes]::Black, 260, 105)

        Field $g "Nomor Sertifikat" $pr.shmNo 60 160
        Field $g "Hak" "HAK MILIK" 520 160
        Field $g "Atas Nama" $p.nama 60 215
        Field $g "NIK" $p.nik 520 215
        Field $g "Nomor Persil" $pr.persil 60 270
        Field $g "Klasifikasi" "TANAH BANGUNAN" 520 270
        Field $g "Letak / Lokasi" (Get-AlamatSatuBaris $p) 60 325
        Field $g "Luas Tanah" "$($pr.luasTanah) ($($pr.luasTanahTerbilang) METER PERSEGI)" 60 380
        Field $g "Luas Bangunan" $pr.luasBangunan 520 380
        Field $g "Nomor IMB / PBG" $pr.pbgNo 60 435
        Field $g "Tanggal Terbit" $pr.shmTanggal 520 435
        Field $g "Asal Hak" $pr.asalHak 60 490

        $sigFont = New-Object System.Drawing.Font("Georgia", 12)
        $g.DrawString("Kepala Kantor Pertanahan Kota $($p.alamat.kota),", $sigFont, [System.Drawing.Brushes]::Black, 540, 560)
        $g.DrawString("ttd.", $sigFont, [System.Drawing.Brushes]::Black, 600, 600)
        $g.DrawString("Drs. Dummy Wicaksono, M.Si.", $sigFont, [System.Drawing.Brushes]::Black, 555, 645)
        $sigFont.Dispose()
    }
}

foreach ($p in $Selected) {
    $script:CurPersona = $p
    $script:OutDir = Join-Path (Join-Path $RootDir "dummy-customers") $p.id
    New-Item -ItemType Directory -Force -Path $script:OutDir | Out-Null
    Write-Host "== $($p.id) : $($p.nama) =="

    $d = $p.dokumen
    if ($d.ktp)      { New-Ktp }
    if ($d.kk)       { New-Kk }
    if ($d.npwp)     { New-Npwp }
    if ($d.rekKoran) { New-RekKoran }
    if ($d.properti) { New-Shm }
}

Write-Host "PNG generation done."
