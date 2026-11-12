# Tambah upload Cloudinary sebelum publikasi Instagram

> Tanggal: 2026-11-11, Asia/Jakarta  
> Status: verified — respons provider yang dimock; kredensial pemilik belum tersedia  
> Jenis: feature  
> Lingkup: penyimpanan media dan adapter publikasi Instagram

## Hasil

Setelah konfirmasi publish, media Instagram diunggah ke Cloudinary terlebih dahulu. Instagram menerima URL hanya setelah upload berhasil dan URL HTTPS beserta identitas aset diperiksa. Review dan simpan draft tetap lokal. Kegagalan Cloudinary tidak memanggil API publikasi Instagram.

## Mekanisme dan kompatibilitas

[Adapter Cloudinary](../../../src/server/cloudinary.ts) membaca tiga variabel lingkungan server, menandatangani parameter upload dengan SHA-256 sesuai kontrak provider, dan mengirim file dari disk. Media di atas 20 MiB memakai chunk berurutan dengan ID upload yang sama, Content-Range, dan pemeriksaan respons final. Timeout dibatasi tiga menit per request dan 15 menit per upload.

[Penyimpanan media](../../../src/server/media.ts) memilih Cloudinary jika tiga kredensialnya lengkap, lalu R2 jika tersedia. Tidak ada failover otomatis setelah upload Cloudinary gagal. [Adapter Instagram](../../../src/server/providers.ts) menunggu URL sebelum membuat container. Gangguan Cloudinary dapat dicoba ulang melalui aturan worker yang sudah ada tanpa menandai hasil posting Instagram sebagai ambigu; ID media lokal yang tetap membuat upload ulang menargetkan aset Cloudinary yang sama. Perilaku hasil ambigu setelah operasi Instagram tetap mengikuti implementasi sebelumnya.

[API status](../../../src/server/api.ts) menampilkan nama penyimpanan berdasarkan konfigurasi tanpa mengirim kredensial. [Validasi review](../../../src/lib/domain.ts) menerima konfigurasi Cloudinary sebagai penyimpanan remote. Tidak ada perubahan skema, alur akun, atau dependensi baru.

## Konfigurasi dan batas

Isi `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, dan `CLOUDINARY_API_SECRET` pada `.env.local`; contoh tersedia di [.env.example](../../../.env.example). Mulai ulang web serta worker sesudah mengubah kredensial. Kredensial asli belum diisi atau diuji pada tugas ini.

Cloudinary memakai delivery publik agar Meta dapat mengambil file. Aset cloud tidak dihapus otomatis; penghapusan media lokal tidak menghapus Cloudinary. CDN standar `res.cloudinary.com` didukung, custom delivery hostname belum didukung. Batas akun Cloudinary tetap berlaku meskipun aplikasi menerima video sampai 500 MB. Upload dan publikasi nyata belum dilakukan.

## Verifikasi

- `npm test`: 44 pengujian lolos. Delapan pengujian Cloudinary mencakup konfigurasi/prioritas R2, signature, gambar, chunk video, kredensial tidak lengkap, file berubah, URL/identitas palsu, urutan upload–publish gambar/video, serta klasifikasi kegagalan tanpa kebocoran secret.
- `npm run typecheck` dan `npm run build`: lolos. Build memakai `NEXT_DIST_DIR=.next-build` agar output dev tidak terganggu.
- Respons provider dalam pengujian dimock; tidak mengirim file ke akun Cloudinary atau Instagram pemilik.

Panduan penggunaan berada pada [README aplikasi](../../../README.md). Kontrak provider mengikuti [signature Cloudinary](https://cloudinary.com/documentation/authentication_signatures), [manual chunked upload](https://cloudinary.com/documentation/upload_images#manual_chunked_upload_rest), dan [delivery publik](https://cloudinary.com/documentation/control_access_to_media).

Folder belum merupakan repositori Git. Catatan ini hanya mengatribusikan integrasi Cloudinary pada tugas ini; implementasi Meta dan studio sebelumnya dipertahankan.
