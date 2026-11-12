# Jadikan rasio gambar Instagram peringatan review

> Tanggal: 2026-11-11, Asia/Jakarta  
> Status: verified — review lokal; penerimaan posting oleh Instagram belum diuji  
> Jenis: fix  
> Lingkup: validasi review gambar Instagram

## Penyebab dan perubahan

Gambar JPEG 1024 × 1536 memiliki rasio 2:3. [Validasi domain](../../../src/lib/domain.ts) sebelumnya menandai setiap gambar di luar rentang 0,8–1,91 sebagai error, sehingga review berhenti sebelum menghubungi Instagram. Pengguna melaporkan file yang sama berhasil dipublikasikan sebagai postingan feed lewat n8n. Detail request dan kemungkinan transformasi media pada alur n8n belum dibandingkan.

Pemeriksaan rasio sekarang menghasilkan warning dengan dimensi gambar dan kemungkinan penolakan oleh Instagram. Review dapat dilanjutkan setelah pengguna menyetujui peringatan melalui mekanisme yang sudah ada. Aplikasi mengirim file dalam ukuran aslinya dan tidak menambahkan crop. Validasi format, koneksi, penyimpanan remote, serta panjang caption tetap berlaku. Perubahan ini tidak menyatakan bahwa API Instagram pasti menerima rasio 2:3.

## Verifikasi

- Reproduksi sebelum perubahan: metadata 1024 × 1536 menghasilkan pesan rasio dengan severity `error`.
- Review ulang draft terkait melalui API lokal setelah perubahan: `reviewId` berhasil dibuat dan satu isu rasio memiliki severity `warning`. Tidak membuat pekerjaan publikasi pada database aplikasi.
- `npm test`: 46 pengujian lolos, termasuk regresi 1024 × 1536, batas 4:5/1,91:1, gambar persegi, serta gambar terlalu lebar/tinggi yang tetap advisory.
- `node node_modules/typescript/bin/tsc --noEmit`: lolos.
- `npm run test:integration`: lolos pada database PostgreSQL sementara. Gambar 1024 × 1536 mencapai review; publish tanpa persetujuan peringatan ditolak tanpa membuat job; setelah persetujuan, job dibuat dengan dimensi asli. Database uji tidak terhubung ke worker aplikasi.

Lihat [pengujian domain](../../../tests/domain.test.ts), [pengujian backend](../../../tests/backend.integration.ts), dan [panduan aplikasi](../../../README.md). Pemeriksaan platform sesungguhnya dan perbedaan request n8n masih belum diverifikasi. Tidak ada unggahan atau posting nyata pada tugas ini. Folder belum merupakan repositori Git; catatan ini hanya mencakup perbaikan validasi rasio.
