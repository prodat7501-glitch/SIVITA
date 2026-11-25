# SIVITA — Sistem Informasi Validasi Data (Panduan Deploy GitHub & Vercel)

Dashboard Web Minimalis Modern (Warna Hijau Tua) untuk memantau, memverifikasi, mengedit, dan mengunduh **Hasil Pengecekan Portal DWH Dukcapil** beserta **Tangkapan Layar BONI** yang tersimpan di Google Drive.

## 1. Perbarui Google Apps Script (Wajib Pertama Kali)
1. Buka Google Spreadsheet Anda → menu **Ekstensi (Extensions) → Apps Script**.
2. Ganti seluruh kode dengan isi file `google_apps_script_code.js` yang sudah diperbarui.
3. Klik **Simpan**, lalu klik **Terapkan (Deploy) → Kelola Penerapan (Manage deployments) → Edit (ikon pensil) → Versi: Versi baru → Terapkan**.
4. Saat Google meminta izin akses baru untuk **Google Drive** (agar bisa menyimpan screenshot ke folder `1R1fCyvj-zvCJG-bXQVIFiLME2mc5FLNa`), klik **Izinkan (Allow)**.
5. Pastikan folder Google Drive `1R1fCyvj-zvCJG-bXQVIFiLME2mc5FLNa` memiliki akses **Siapa saja yang memiliki link → Pelihat (Viewer)** agar gambar screenshot dapat langsung tampil inline di SIVITA.

## 2. Sinkronkan Data & Screenshot Lama (Opsional)
Jalankan dari folder `e:\robot-nik`:
```bash
python sync_screenshots_to_drive.py
```
Script ini akan menyalin seluruh hasil lama dari `Sheet1` ke sheet `Hasil_DWH` dan mengunggah foto lama di `data/screenshots/` ke folder Google Drive SIVITA.

## 3. Deploy SIVITA ke GitHub & Vercel
1. Push folder `sivita/` (atau seluruh repository dengan **Root Directory = `sivita`**) ke GitHub.
2. Buka [vercel.com](https://vercel.com) → **Add New Project** → pilih repository GitHub Anda.
3. Jika push seluruh repo `robot-nik`, atur **Root Directory** menjadi `sivita`.
4. Tambahkan **Environment Variables** di Vercel:
   - `GAS_WEBHOOK_URL` = URL Web App Google Apps Script Anda (`https://script.google.com/macros/s/.../exec`)
   - `SIVITA_SESSION_SECRET` = string acak panjang (misalnya `sivita-gorontalo-2026-rahasia-kuat`)
5. Klik **Deploy**!

## 4. Akun Login Default (Sheet `Users`)
Saat pertama kali login, Apps Script otomatis membuat sheet **`Users`** dengan akun awal:
- **Admin** (bisa lihat data, lihat screenshot, download CSV/Excel, sinkron, dan **Edit Data**):
  - Username: `admin` | Password: `admin123`
- **User** (bisa lihat data, lihat screenshot, download CSV/Excel; **tidak bisa Edit**):
  - Username: `user` | Password: `user123`

> **Penting:** Segera ubah password default tersebut di sheet `Users` setelah login pertama berhasil!
