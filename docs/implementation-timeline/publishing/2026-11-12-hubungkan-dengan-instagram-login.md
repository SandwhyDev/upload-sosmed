# Hubungkan akun melalui login resmi Instagram

> Tanggal: 2026-11-12, Asia/Jakarta  
> Status: verified — build, callback lokal, dan integrasi simulasi  
> Jenis: feature  
> Lingkup: koneksi akun Instagram pada aplikasi localhost

**Hubungkan dengan Instagram** mengarahkan pengguna ke `www.instagram.com` untuk masuk dan memberi izin. [Backend Instagram Login](../../../src/server/instagram-oauth.ts) menukar kode dengan token jangka panjang, membaca nama dan ID akun profesional, lalu menggunakan penyimpanan akun terenkripsi yang dipakai worker Instagram. Koneksi token manual tersedia pada kartu yang sama.

[Halaman callback HTTPS](../../assets/instagram-callback.html) meneruskan parameter OAuth ke alamat tetap `http://127.0.0.1:3000/api/accounts/instagram/callback`. Pengguna perlu meng-host halaman ini dan mendaftarkan URL-nya di Meta. App Secret tetap berada di server lokal. Aplikasi berbagi [pemeriksaan state dan cookie](../../../src/server/oauth-session.ts) dengan YouTube, memakai sesi sekali dalam sepuluh menit, dan menolak penggantian akun jika koneksi berubah selama otorisasi atau ada job aktif.

Setup produksi belum diuji dengan akun Meta pemilik. Lihat [panduan konfigurasi](../../../README.md) untuk kredensial dan alamat callback yang diperlukan.

`npm test` meluluskan 46 tes. TypeScript dan build produksi lolos. Integrasi PostgreSQL sementara memverifikasi pertukaran token, deteksi akun, enkripsi token, penolakan callback yang tidak cocok, dan pencegahan replay. Tes YouTube juga lolos dengan sesi bersama. Callback lokal mengembalikan 303 saat sesi tidak tersedia. Pemeriksaan relay memvalidasi hash script dan tujuan lokal tetap untuk login berhasil maupun batal.
