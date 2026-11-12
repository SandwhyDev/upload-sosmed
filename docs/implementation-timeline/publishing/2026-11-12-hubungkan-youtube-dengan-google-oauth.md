# Hubungkan YouTube melalui Google OAuth

> Tanggal: 2026-11-12, Asia/Jakarta  
> Status: verified — build, callback lokal, dan alur OAuth simulasi  
> Jenis: feature  
> Lingkup: koneksi akun YouTube dan otorisasi worker

## Hasil

Kartu YouTube menerima Client ID dan Client Secret, menampilkan Redirect URI untuk Google Cloud, dan mengarahkan pengguna ke Google untuk memberikan izin. Backend mendeteksi kanal dan menyimpan koneksinya setelah callback berhasil. Pengguna dengan token yang sudah tersedia dapat memilih koneksi manual.

## Mekanisme

[OAuth YouTube](../../../src/server/youtube-oauth.ts) memakai authorization code, PKCE S256, dan state yang terikat pada cookie HttpOnly. Sesi sementara hidup selama sepuluh menit di proses web lokal. Callback mengambil sesi sekali, memeriksa kedua scope YouTube dan refresh token, lalu membaca identitas kanal melalui `channels.list` dengan `mine=true`. Koneksi memerlukan satu kanal yang dapat diidentifikasi dari grant Google. [Panduan OAuth Google](https://developers.google.com/identity/protocols/oauth2/web-server)

[API akun](../../../src/server/api.ts) menggunakan penyimpanan terenkripsi dan pembatasan penggantian akun saat ada job aktif. Jika koneksi berubah selama persetujuan Google, proses dimulai kembali dari kartu YouTube. Callback menerima navigasi dari Google dengan state yang cocok. Rute lain tetap mengikuti pemeriksaan localhost dan origin. Log request development mengabaikan URL callback yang membawa kode otorisasi.

[Adapter platform](../../../src/server/providers.ts) menukar refresh token untuk access token baru saat cek koneksi dan sebelum unggah. Kanal dari token tersebut harus cocok dengan tujuan yang tersimpan. Refresh tidak menulis ulang revisi akun, sehingga snapshot review tetap merujuk ke koneksi yang sama.

## Penggunaan dan batas

Daftarkan Redirect URI kartu YouTube pada OAuth Client Google tipe Web application. Persetujuan diberikan pengguna di Google. Grant Testing dapat kedaluwarsa dan memerlukan koneksi ulang. Pengujian memakai respons Google simulasi. [Panduan aplikasi](../../../README.md)

## Verifikasi

- `npm test` meluluskan 46 tes. Pemeriksaan TypeScript dan build produksi juga lolos setelah Next.js selesai membuat tipe rute development.
- `npm run test:integration` lulus pada PostgreSQL sementara. Tes mencakup state salah, cookie kosong, replay callback, kecocokan PKCE, penyimpanan terenkripsi, deteksi kanal, refresh token, serta perlindungan koneksi saat beralih ke token manual.
- Callback pada server lokal mengembalikan status 303 dan pesan sesi tidak valid saat dibuka tanpa state. Pemeriksaan visual browser mengalami timeout saat server development dikompilasi. Persetujuan akun Google pemilik dan unggah video nyata masih memerlukan uji pengguna.
