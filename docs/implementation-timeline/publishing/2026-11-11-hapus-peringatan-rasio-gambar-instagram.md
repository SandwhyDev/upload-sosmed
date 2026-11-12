# Hapus peringatan rasio gambar Instagram

> Tanggal: 2026-11-11, Asia/Jakarta  
> Status: verified — review lokal; publikasi nyata belum diuji  
> Jenis: fix  
> Lingkup: validasi rasio gambar Instagram

## Hasil dan mekanisme

Pemeriksaan rasio gambar JPEG dihapus dari [validasi domain](../../../src/lib/domain.ts). Gambar 1024 × 1536 kini tidak menghasilkan error maupun warning rasio, sehingga tidak membutuhkan persetujuan peringatan untuk melanjutkan. Aplikasi menyerahkan penerimaan gambar ke Instagram saat publish dan meneruskan ukuran asli.

Perubahan menggantikan [perbaikan sebelumnya yang menjadikan rasio sebagai peringatan](2026-11-11-ubah-rasio-instagram-menjadi-peringatan.md), setelah pengguna kembali melaporkan pesan tersebut pada file yang berhasil dipublikasikan lewat n8n. Detail request n8n dan penerimaan aktual oleh Instagram belum dibandingkan. Validasi format, caption, koneksi, serta penyimpanan remote tetap berlaku; pemeriksaan video tidak diubah.

Review yang sudah terbuka dapat menyimpan hasil pemeriksaan lama. Pilih **Kembali edit → Review konten** untuk membuat review baru.

## Verifikasi

- API lokal: review ulang draft gambar 1024 × 1536 berhasil membuat review dengan `issues: []`. Tidak membuat job atau posting di database aplikasi.
- [Tes domain](../../../tests/domain.test.ts) menuntut hasil kosong untuk rasio 2:3, persegi, 4:5, 1,91:1, gambar lebih tinggi, dan gambar lebih lebar.
- [Tes backend](../../../tests/backend.integration.ts) memeriksa review tanpa isu rasio dan pembuatan job dengan `acknowledgedWarnings: false`, sambil mempertahankan dimensi asli.
- `npm test`: 46 tes lolos. `node node_modules/typescript/bin/tsc --noEmit` dan `npm run test:integration` juga lolos; integrasi memakai database sementara tanpa worker publikasi.

Lihat [panduan aplikasi](../../../README.md). Tidak ada upload atau posting nyata pada tugas ini. Folder belum merupakan repositori Git; catatan hanya mencakup penghapusan pemeriksaan rasio gambar, bukan keseluruhan integrasi Instagram.
