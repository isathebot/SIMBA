# SIMBA - Sistem Monitoring BMN Aktif

Aplikasi peminjaman barang dan penyewaan ruang studio untuk Balai Besar Pelatihan Kesehatan Jakarta. Sistem ini dibangun dengan **Google Apps Script (GAS)** dan dihubungkan secara langsung ke database [Google Spreadsheet yang telah disediakan](https://docs.google.com/spreadsheets/d/1P7AkTA9Qb1WLDYkl3xdUO9XHiOk6pid3c98PmETA6os/edit?usp=sharing).

## Arsitektur Sistem

- **Frontend:** Single Page Application (SPA) responsif yang dinamis dengan Vanilla HTML, CSS (Glassmorphism UI), dan JavaScript. Terdapat di dalam file `Index.html`.
- **Backend:** Google Apps Script yang menangani logika otentikasi (berdasarkan Role), komunikasi database (spreadsheet), serta CRUD data peminjaman dan penyewaan. Terdapat di dalam file `Code.gs`.

---

## Ketentuan Sistem Role

1. **Role Pegawai:**
   - Mengakses Dashboard.
   - Peminjaman barang.
   - Penyewaan ruang studio.
2. **Role Pengelola BMN & Pengelola Ruang:**
   - Memiliki semua akses pegawai.
   - Mengakses menu verifikasi (menyetujui/membatalkan permohonan).
   - Mengakses menu laporan & riwayat.
3. **Role Kepala Kantor:**
   - Memiliki semua akses pegawai.
   - Mengakses menu monitoring kegiatan verifikasi/pengelola BMN.
4. **Role Admin:**
   - Dapat mengakses semua role dan fitur tambahan.

*(Catatan: Sistem login akan memvalidasi role berdasarkan kecocokan NIP pengguna dengan data yang ada di Spreadsheet. Password secara default adalah `12345@`)*.

---

## Petunjuk Penggunaan (User Guide)

1. **Login:** Buka link aplikasi web (Google Apps Script). Masukkan **NIP** Anda. Masukkan Password custom: `12345@`.
2. **Dashboard:** Di halaman dashboard, Anda dapat melihat jumlah barang yang tersedia, ruang studio yang bisa disewa, dan status permohonan yang menunggu verifikasi.
3. **Peminjaman Barang:** Pilih menu "Peminjaman Barang" di sidebar. Isi barang yang ingin dipinjam, tanggal, dan tujuan. Tekan "Ajukan".
4. **Penyewaan Ruang Studio:** Pilih menu "Penyewaan Ruang" di sidebar. Pilih ruang, waktu mulai, selesai, dan kegiatan. Tekan "Ajukan".
5. **Verifikasi (Khusus Pengelola/Admin):** Pilih menu "Verifikasi". Anda dapat melihat daftar permohonan dan mengubah statusnya menjadi 'Disetujui' atau 'Ditolak'.
6. **Monitoring (Khusus Kepala/Admin):** Pilih menu "Monitoring" untuk melihat rangkuman kinerja.

---

## Deployment & Publish lewat GitHub

Karena project ini adalah *Google Apps Script*, cara terbaik untuk mengelolanya dengan GitHub adalah menggunakan tools **`clasp`** (Command Line Apps Script Projects). 

### Persiapan Prasyarat
- Anda sudah menginstall [Node.js](https://nodejs.org/).
- Anda sudah memiliki akun Google dan akun GitHub.

### Langkah-langkah Deploy:

1. **Install Clasp secara global**
   Buka terminal/Command Prompt dan ketikkan:
   ```bash
   npm install -g @google/clasp
   ```

2. **Login Clasp dengan Akun Google Anda**
   ```bash
   clasp login
   ```
   (Akan membuka browser, silakan login dengan akun Google Anda dan izinkan akses).

3. **Inisialisasi Project di Lokal**
   Arahkan ke folder project ini, dan buat project GAS baru:
   ```bash
   clasp create --type webapp --title "SIMBA - BBPK Jakarta"
   ```
   *Atau jika Anda sudah memiliki Apps Script kosong, copy `Script ID` dari Pengaturan project script.google.com, lalu jalankan:*
   ```bash
   clasp clone <SCRIPT_ID>
   ```

4. **Push File ke Google Apps Script**
   Pastikan file `Code.gs` dan `Index.html` ada di direktori ini, lalu upload ke cloud:
   ```bash
   clasp push
   ```

5. **Deploy sebagai Web App**
   Untuk mendapatkan URL yang bisa diakses pengguna:
   ```bash
   clasp deploy --description "Versi 1.0 - SIMBA Initial Release"
   ```
   Anda akan mendapatkan link URL Web App (berakhiran `/exec`). Bagikan link ini ke pegawai BBPK Jakarta.

6. **Publish Code ke GitHub**
   Setelah `clasp` disiapkan, ini hanyalah folder lokal biasa. Anda dapat menyimpannya di GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit SIMBA"
   git branch -M main
   git remote add origin https://github.com/USERNAME_ANDA/NAMA_REPO_ANDA.git
   git push -u origin main
   ```

## Struktur Database Spreadsheet

Jika spreadsheet kosong, silakan buat beberapa sheet utama dengan judul berikut:
- **`Data Pegawai`** (Kolom: `NIP`, `Nama`, `Role`) -> Digunakan untuk login dan validasi role.
- **`Data Barang`** (Kolom: `Nama Barang`, `Spesifikasi`, `Stok`)
- **`Data Ruang`** (Kolom: `Nama Ruang`, `Kapasitas`)
- **`Peminjaman`** (Sistem akan otomatis membuat ini jika tidak ada)
- **`Penyewaan`** (Sistem akan otomatis membuat ini jika tidak ada)
