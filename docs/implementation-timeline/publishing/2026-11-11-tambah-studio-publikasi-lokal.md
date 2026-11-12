# Tambah studio publikasi lokal

> Tanggal: 2026-11-11, Asia/Jakarta  
> Status: partial — fondasi lokal terverifikasi, publikasi dengan token pemilik belum diuji  
> Jenis: feature  
> Lingkup: web, backend, database, media, review, dan worker publishing

## Hasil

Folder awal hanya memiliki dokumentasi PRD. Implementasi menambahkan studio gelap tanpa login dengan editor, variasi caption, preview empat platform, metadata YouTube, draft persisten, pustaka media, akun/token, review final, dan riwayat pekerjaan.

Backend menyediakan upload yang diperiksa, penyimpanan draft dengan versi optimistis, review snapshot, dan pembuatan batch/jobs dalam transaksi. Konfirmasi review yang sama mengembalikan batch yang sama. Konten yang diubah tidak dapat memakai persetujuan versi lama. Status belum pasti dipisahkan dari kegagalan yang aman dicoba ulang.

## Mekanisme

- [Komponen studio](../../../src/components/studio.tsx) dan [CSS](../../../src/app/globals.css) mengikuti desain charcoal/monokrom yang dipilih pemilik.
- [Domain](../../../src/lib/domain.ts) memiliki kontrak dan validasi lintas client/server.
- [API](../../../src/server/api.ts) memiliki batas request, penyimpanan, transaksi, review, dan serialisasi tanpa token.
- [Worker](../../../src/worker.ts) memakai pg-boss, heartbeat, penguncian worker tunggal, dan checkpoint provider. Pekerjaan yang terputus tidak diputar ulang secara buta.
- [Adapter](../../../src/server/providers.ts) menyediakan alur Instagram, Facebook Page, YouTube, serta LinkedIn. Pengujian nyata masih memerlukan kredensial dan permission pemilik.
- [Dev launcher](../../../scripts/dev.mjs) menyediakan PostgreSQL lokal persisten bila DATABASE_URL belum diisi.

## Keputusan dan tradeoff

Penggunaan lokal tanpa login diterapkan dengan binding loopback serta pemeriksaan Host, Origin, dan intent header pada perubahan data. Enkripsi token memakai AES-256-GCM bawaan Node; kunci berada terpisah dari database. Runtime data dan berkas lingkungan tidak boleh ikut tracing build.

Media lokal membuat editor dapat dipakai sebelum R2 dikonfigurasi. R2 hanya diperlukan pada alur Instagram yang meminta URL pengambilan media. SDK cloud dimuat saat diperlukan setelah pemuatan eager terbukti memperlambat API pertama pada lingkungan ini.

Antarmuka memakai CSS langsung agar sesuai konsep yang ditinjau. Tailwind/shadcn dari rekomendasi awal tidak ditambahkan sebagai dependensi yang tidak diperlukan.

## Verifikasi

- Seluruh 28 pengujian aturan konten, respons provider yang dimock, enkripsi, dan batas request lulus.
- TypeScript lulus; build produksi final berhasil tanpa peringatan tracing runtime data.
- Pengujian PostgreSQL terisolasi lulus untuk versi review, masking/enkripsi token, deduplikasi konfirmasi bersamaan, dan larangan retry hasil belum pasti atau sukses.
- Browser membuktikan input caption, pilihan tujuan, penyimpanan draft, dan pemblokiran publish ketika koneksi belum tersedia. Draft contoh tetap tersedia setelah halaman dibuka kembali.
- Uji HTTP lulus untuk upload JPEG/MP4 nyata, metadata Sharp/FFprobe, byte range media, versi draft, review kedaluwarsa, perlindungan media yang dirujuk, serta penolakan origin asing. Method DELETE pada route media spesifik diperbaiki berdasarkan pengujian ini.
- Desktop 1280 piksel dan layar 375/320 piksel diperiksa. Overflow dari input file tersembunyi diperbaiki; lebar dokumen berada dalam viewport pada pemeriksaan ulang. [Screenshot desktop](../../assets/studio-desktop.jpg) disimpan dari aplikasi yang berjalan.
- Setelah proses development dijalankan ulang, API kembali merespons, heartbeat worker aktif, draft contoh tetap tersimpan, dan smoke test HTTP kembali lulus. Proses PostgreSQL yatim dari restart pengujian dibersihkan berdasarkan parent PID milik proyek; tidak ada berkas database yang dihapus.

Video uji memakai [contoh MP4 CC0 milik MDN](https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4), disimpan sebagai fixture lokal yang diabaikan Git. Data HTTP sementara dibersihkan; tidak ada publikasi eksternal dalam pengujian.

## Batas

Tidak ada token pemilik yang dimasukkan, tidak ada posting nyata yang dibuat, dan belum ada verifikasi end-to-end terhadap akun platform. Integrasi provider, izin, kuota, pemrosesan, serta URL hasil tetap memerlukan uji terarah pada akun tujuan.

Jadwal, multiakun, carousel, refresh OAuth otomatis, pembersihan media otomatis, dan rekonsiliasi otomatis hasil ambigu belum diimplementasikan. Lihat [panduan aplikasi](../../../README.md) untuk konfigurasi dan batas operasional.

## Terkait

- [PRD](../../PRD.md).
- [Dokumentasi proyek](../../README.md).
