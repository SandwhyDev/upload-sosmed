# PRD — Social Content Publisher

Versi: 0.2  
Tanggal: 11 November 2026, Asia/Jakarta  
Status: Draft usulan untuk ditinjau pemilik produk  
Lingkup: Web pribadi untuk menyiapkan, meninjau, dan menerbitkan konten ke Instagram, Facebook, YouTube, dan LinkedIn.

Dokumen ini adalah rencana produk, bukan laporan fitur yang sudah dibuat. Token, akun tujuan, izin aplikasi, dan kemampuan publikasi aktual belum diuji.

Implementasi awal dimulai 11 November 2026. Status fitur dan batas yang sudah terbukti dicatat dalam [panduan aplikasi](../README.md) dan [riwayat implementasi](implementation-timeline/README.md); item PRD tidak otomatis dianggap selesai.

## 1. Ringkasan produk

Satu web untuk mengunggah media sekali, menulis konten, menyesuaikannya untuk setiap platform, melihat preview, lalu menerbitkan ke akun yang dipilih. Pengguna selalu mengetahui konten apa yang dikirim, akun mana yang menerima, dan hasil publikasi di masing-masing platform.

Prinsip utama: **unggah media → siapkan konten → review per platform → konfirmasi → pantau hasil**.

Mengunggah file ke web hanya menyimpan bahan konten. Tindakan ini tidak otomatis menerbitkan konten ke media sosial.

## 2. Kebutuhan terkonfirmasi dan asumsi

### Kebutuhan dari pemilik produk

- Mendukung Instagram, Facebook, YouTube, dan LinkedIn.
- Pemilik sudah memiliki access token untuk keempat platform.
- Ada proses review konten sebelum publikasi.
- Ada beberapa pilihan publikasi, termasuk langsung menerbitkan ke platform pilihan.
- PRD disusun terlebih dahulu; pemilik kemudian mengizinkan implementasi awal berdasarkan desain gelap yang ditinjau.
- MVP tidak memerlukan login ke aplikasi. Backend tetap diperlukan untuk kredensial, draft, dan pekerjaan publikasi.

### Asumsi rancangan awal

- Digunakan satu pemilik akun; belum menjadi SaaS untuk banyak pelanggan.
- Tanpa login, default MVP berjalan lokal dan hanya mendengarkan alamat loopback (localhost). Akses dari jaringan lain atau hosting publik belum termasuk lingkup ini.
- Review dilakukan sendiri. Persetujuan oleh anggota tim merupakan pengembangan berikutnya.
- Bahasa antarmuka Indonesia; zona waktu awal Asia/Jakarta.
- MVP mendukung satu akun tujuan per platform. Model data tetap memisahkan akun dan platform.
- Instagram ditargetkan ke akun profesional, Facebook ke Page, YouTube ke kanal pemilik, dan LinkedIn ke profil pribadi. Company Page LinkedIn dapat diaktifkan bila izin tersedia.
- Semua pilihan ini masih usulan. Token yang sudah ada tidak dianggap sebagai bukti bahwa seluruh format dapat diterbitkan.

## 3. Masalah dan tujuan

Saat publikasi dilakukan melalui empat aplikasi terpisah, pengguna harus mengunggah file berulang, menyalin caption, menyesuaikan format, dan memeriksa hasil satu per satu. Kesalahan akun tujuan atau caption juga sulit terlihat sebelum konten terbit.

Tujuan produk:

1. Menyiapkan satu konten dengan variasi khusus tiap platform dari satu tempat.
2. Memastikan media, caption, metadata, dan akun tujuan ditinjau sebelum publikasi.
3. Memungkinkan publikasi ke satu, beberapa, atau seluruh platform yang kompatibel.
4. Menjelaskan keberhasilan dan kegagalan per tujuan, serta menyediakan pemulihan yang tidak mengulang kiriman sukses.

### Ukuran keberhasilan usulan

- Semua publikasi memiliki catatan versi konten dan konfirmasi pengguna.
- Semua tujuan menampilkan status akhir atau status belum pasti beserta tindakan lanjut.
- Tidak ada kiriman ganda akibat klik ganda pada skenario pengujian penerimaan.
- Pengguna dapat menyelesaikan alur dari draft siap pakai ke antrean publikasi tanpa membuka dashboard developer.
- Sasaran uji awal: minimal 95% pekerjaan dengan media dan kredensial valid berhasil pada percobaan pertama, diukur terpisah per platform. Gangguan provider tetap dilaporkan sebagai kategori tersendiri, bukan disembunyikan dari laporan.

## 4. Batas integrasi dan kesiapan akun

| Platform | Tujuan produk | Cakupan format MVP yang diusulkan | Ketergantungan |
| --- | --- | --- | --- |
| Instagram | Akun Business/Creator | Gambar tunggal dan Reel | Jenis login, izin publishing, serta kesiapan media/container |
| Facebook | Facebook Page | Teks, gambar tunggal, dan video Page | Page yang benar, token dan hak publikasi yang sesuai; endpoint video diperiksa terpisah |
| YouTube | Kanal pemilik | Upload video | OAuth upload, metadata wajib, kuota, dan pemrosesan video |
| LinkedIn | Profil pemilik; Company Page bila memenuhi izin | Teks, gambar tunggal, dan video | Izin berdasarkan author; gambar/video melalui proses unggah aset |

Tabel tersebut adalah target pengembangan. Setiap kombinasi format dan akun harus melewati uji integrasi sebelum ditandai tersedia.

### Instagram

Dokumentasi resmi Meta di Postman menjelaskan dukungan akun profesional. Jalur Facebook Login memerlukan Page yang terhubung; jalur Instagram Login memiliki permission tersendiri. Aplikasi harus memilih jalur yang sesuai token, bukan mencampur keduanya. Alur Reel membuat container, menunggu siap, lalu menerbitkan. Bila memakai URL media, server Meta harus dapat mengambil file tersebut. [S1]

### Facebook

Cakupan produk dibatasi pada Page; publikasi ke profil pribadi atau Group tidak termasuk MVP. Page access token dibedakan dari user token dalam koleksi resmi Meta. Persyaratan endpoint posting Page dan video harus diperiksa saat implementasi; halaman dokumentasi posts tidak berhasil diambil saat penyusunan karena respons HTTP 429. Daftar permission final tidak dianggap sudah terverifikasi. [S1][S2]

### YouTube

Upload menggunakan YouTube Data API dan scope yang mengizinkan upload. Pilihan privasi harus selalu dikirim secara eksplisit. Metadata mencakup judul, deskripsi, kategori, serta deklarasi audiens dan konten sintetis bila relevan. [S3]

Hasil pencarian dokumentasi resmi menampilkan perubahan 2 November 2026 terkait pencabutan pembatasan private pada proyek API yang belum diverifikasi, sedangkan URL referensi lama masih menampilkan kebijakan sebelumnya. Karena hasil dokumentasi berbeda, kebijakan efektif perlu dikonfirmasi kembali sebelum rilis; produk tidak menjanjikan kelayakan public hanya berdasarkan token. Persetujuan OAuth, kuota, dan kemampuan akun juga diperiksa secara terpisah. [S3][S4]

### LinkedIn

Posts API membedakan izin publikasi anggota (`w_member_social`) dan organisasi (`w_organization_social`), dengan peran organisasi yang sesuai. Izin menulis tidak otomatis mencakup izin membaca seluruh posting anggota. Gambar dan video perlu memperoleh identitas aset sebelum dipakai pada posting. Versi API harus dikelola secara eksplisit. [S5]

### Pemeriksaan kesiapan

Sebelum platform dapat dipilih, aplikasi menampilkan identitas akun tujuan, status token, informasi kedaluwarsa bila tersedia, dan kemampuan yang terverifikasi. Bila API tidak menyediakan introspeksi permission, tampilkan status “Belum terverifikasi”, bukan menyimpulkan izin lengkap.

Tombol **Cek koneksi** hanya melakukan pemeriksaan tanpa publikasi. Uji yang benar-benar menulis ke platform merupakan tindakan terpisah dengan konfirmasi eksplisit. Tidak ada token yang perlu ditempelkan dalam PRD atau percakapan.

## 5. Lingkup rilis

### P0 — MVP wajib

- Akses dashboard lokal tanpa login, serta pengaturan akun/token.
- Pemeriksaan koneksi dan identitas akun tujuan.
- Upload gambar/video dan pustaka media sederhana.
- Draft yang dapat disimpan, dibuka kembali, dan diduplikasi.
- Caption umum, variasi per platform, dan metadata yang relevan.
- Pemilihan satu atau beberapa platform kompatibel.
- Preview, validasi, dan review final sebelum publikasi.
- Publikasi sekarang melalui antrean background.
- Status per tujuan, riwayat, tautan hasil bila tersedia, dan retry yang aman.

### P1 — Setelah alur utama stabil

- Kontrol akses sebelum membuka web melalui jaringan atau hosting publik; bentuk login atau lapisan akses lain ditentukan saat kebutuhan tersebut disepakati.
- Jadwal publikasi dan kalender.
- Carousel/multi-image sesuai kemampuan masing-masing API.
- Cover atau thumbnail khusus sesuai dukungan akun/API.
- Banyak akun per platform dan template caption/hashtag.

### P2 — Pengembangan lanjutan

- Tim dengan peran penulis, reviewer, dan publisher.
- Komentar review dan persetujuan oleh orang lain.
- Bantuan AI untuk caption dan variasi konten.
- Analytics yang dibatasi permission aktual.

### Di luar MVP

Editor video lengkap, auto-crop/transcoding otomatis, Instagram/Facebook Stories, Facebook Reels, live streaming, iklan, pengelolaan DM/komentar, billing SaaS, penghapusan massal posting eksternal, dan perubahan otomatis pada posting yang sudah terbit.

Video YouTube dapat memenuhi ketentuan Shorts, tetapi aplikasi tidak menjanjikan tombol atau flag API yang memaksa klasifikasi Shorts.

## 6. Perjalanan pengguna

### A. Menyiapkan akun

1. Pemilik membuka web lokal tanpa halaman login.
2. Membuka **Akun Terhubung** dan memasukkan kredensial melalui pengaturan lokal atau konfigurasi server.
3. Memilih atau mengonfirmasi akun/Page/kanal tujuan.
4. Menjalankan pemeriksaan koneksi.
5. Melihat status “Siap”, “Perlu diperbarui”, “Izin kurang”, atau “Belum terverifikasi”.

### B. Membuat dan meninjau konten

1. Klik **Buat Konten** dan unggah media.
2. Isi judul internal dan caption umum.
3. Pilih platform dan lihat nama akun tujuan pada setiap pilihan.
4. Sesuaikan caption, media, dan metadata per platform bila diperlukan.
5. Klik **Review Konten** untuk melihat seluruh tujuan terpilih.
6. Perbaiki error; peringatan dapat dilanjutkan dengan pengakuan pengguna.
7. Pilih simpan draft atau konfirmasi publikasi.

### C. Memantau publikasi

1. Setelah konfirmasi, web membuat pekerjaan terpisah untuk setiap tujuan.
2. Pengguna dapat meninggalkan halaman tanpa menghentikan pekerjaan server.
3. Halaman detail menampilkan progres, pemrosesan provider, dan hasil tiap tujuan.
4. Jika hanya sebagian berhasil, pengguna melihat ringkasan dan opsi retry untuk tujuan yang gagal saja.

## 7. Pilihan tindakan publikasi

| Tindakan | Perilaku |
| --- | --- |
| Simpan Draft | Menyimpan konten ke web tanpa menerbitkan |
| Review Konten | Membuka preview dan pemeriksaan seluruh tujuan terpilih |
| Publikasikan ke Platform Terpilih | Mengantrekan tujuan yang dipilih setelah review dan konfirmasi |
| Pilih Semua yang Kompatibel | Memilih tujuan siap pakai; tujuan lain tetap terlihat dengan alasan tidak tersedia |
| Publikasikan Semua yang Dipilih | Menampilkan ringkasan akun lalu mengantrekan seluruh pilihan; tidak menambah platform diam-diam |
| Coba Lagi yang Gagal | Memproses tujuan gagal yang aman dicoba ulang |
| Duplikat Konten | Membuat draft baru tanpa status sukses atau persetujuan lama |
| Jadwalkan — P1 | Menentukan waktu publikasi dari versi yang sudah direview |

“Langsung upload” berarti mulai publikasi sekarang setelah review final. Tidak ada publikasi saat drag-and-drop file, menyimpan draft, atau menekan cek koneksi.

## 8. Kebutuhan fungsional

### FR-01 — Media dan draft

- Mendukung pemilihan file dan drag-and-drop, dengan progres upload dan pesan kegagalan.
- Baseline format input: JPEG, PNG, dan MP4. Dukungan input web tidak berarti kompatibel dengan semua tujuan.
- Batas aplikasi awal yang diusulkan: 25 MB per gambar dan 500 MB per video; batas provider yang lebih ketat tetap berlaku. Batas dapat diubah melalui konfigurasi server dan ditampilkan sebelum upload.
- Simpan metadata ukuran, dimensi, MIME aktual, durasi, dan codec bila dapat diperiksa.
- Satu konten memiliki caption umum dan variasi platform; media alternatif dapat dipilih per tujuan tanpa mengubah sumber asli.
- Draft menyimpan judul internal, caption, media, pilihan tujuan, dan metadata khusus. Tampilkan indikator perubahan tersimpan/belum tersimpan.
- Menghapus draft tidak menghapus posting eksternal. Media yang masih dipakai pekerjaan aktif tidak dapat dihapus.

### FR-02 — Composer per platform

- Caption umum menjadi nilai awal; override ditandai dengan jelas dan bisa dikembalikan ke caption umum.
- Perubahan caption umum tidak menimpa override yang sudah dibuat.
- Pilihan format dan field mengikuti kemampuan tujuan: caption untuk Instagram, isi posting Facebook/LinkedIn, judul/deskripsi dan metadata video untuk YouTube.
- YouTube tidak dapat dipilih untuk konten teks atau gambar tanpa video.
- Metadata wajib yang relevan mencakup pilihan privasi dan audiens YouTube. Pilihan privasi awal yang diusulkan adalah private sampai pengguna memilih nilai lain.
- Hitungan karakter dan pemeriksaan media memakai aturan platform yang dipelihara di server. Jangan hardcode satu batas untuk semua platform.

### FR-03 — Review sebelum publish

- Tampilkan preview perkiraan per platform: identitas tujuan, media, caption final, format, metadata, dan visibilitas.
- Video dapat diputar; gambar dapat diperbesar. Caption lengkap tetap dapat diperiksa meskipun preview feed memperlihatkan potongan teks.
- Preview diberi keterangan bahwa tampilan aktual dapat berbeda setelah pemrosesan platform.
- Bedakan error pemblokir dari peringatan. Contoh error: token tidak valid, video wajib tidak ada, metadata wajib kosong, atau format tidak didukung.
- Tombol konfirmasi berbunyi **Publikasikan ke N Tujuan**, dengan daftar akun dan waktu “Sekarang”.
- Review melekat pada versi konten dan target yang tepat. Perubahan caption, media, metadata, akun, atau tujuan membatalkan hasil review terkait.
- Versi yang sedang diproses tidak dapat diubah; perubahan berikutnya menjadi draft/revisi baru.
- Validasi ulang di server saat konfirmasi. Hasil preview browser tidak menjadi otoritas validasi.
- Jika satu tujuan terpilih terblokir, pengguna harus memperbaiki atau mengeluarkannya dari pilihan sebelum mengonfirmasi seluruh batch.

### FR-04 — Eksekusi dan hasil

- Satu batch berisi satu pekerjaan untuk setiap akun tujuan dan versi konten.
- Pekerjaan berjalan independen; tidak menjanjikan waktu terbit persis sama di empat platform.
- UI membedakan mengantre, mengunggah, diproses provider, diterbitkan, gagal, dan hasil belum pasti.
- API menerima file atau mengembalikan ID tidak selalu berarti konten telah selesai diproses atau terlihat publik.
- Simpan ID eksternal sesegera mungkin. Tampilkan tautan hasil bila bisa diperoleh; bila izin baca terbatas, tampilkan bukti respons yang tersedia beserta keterbatasan verifikasinya.
- Untuk YouTube, bedakan upload selesai, pemrosesan selesai, dan visibilitas private/unlisted/public. Private/unlisted yang diminta pengguna tidak ditampilkan sebagai publik.
- Tidak ada pembatalan otomatis pada platform yang sukses ketika platform lain gagal.

### FR-05 — Retry dan status belum pasti

- Klik ganda dan request berulang untuk pekerjaan yang sama mengembalikan pekerjaan yang sudah ada.
- Retry otomatis hanya untuk kegagalan sementara yang aman, menggunakan jeda bertahap dan mengikuti Retry-After provider bila ada.
- Baseline usulan: maksimal tiga retry otomatis; jangan retry buta pada operasi create/publish yang mungkin sudah berhasil.
- Kegagalan permission atau media memerlukan perbaikan sebelum retry.
- Timeout setelah request publish dikirim menjadi **Perlu Dicek**, bukan otomatis dianggap gagal. Lakukan rekonsiliasi dengan ID/container/session bila tersedia.
- Jika hasil tidak dapat dipastikan melalui API, hentikan retry otomatis dan minta pengguna memeriksa platform. Jelaskan potensi duplikasi sebelum menawarkan publikasi baru.
- Tujuan sukses terkunci dari retry batch. Publikasi ulang yang disengaja membuat pekerjaan baru melalui alur review baru.

### FR-06 — Riwayat dan pengaturan

- Daftar konten dapat difilter menurut draft, dalam proses, selesai, sebagian berhasil, gagal, dan platform.
- Detail menampilkan versi konten, waktu konfirmasi, waktu percobaan, hasil, dan pesan tindakan yang mudah dimengerti.
- Token ditampilkan tersamarkan; pengguna dapat mengganti atau menonaktifkan koneksi.
- Menonaktifkan akun menghentikan pekerjaan yang belum dimulai. Pekerjaan yang sudah dikirim ke provider mungkin tetap selesai dan harus dipantau.

### FR-07 — Penjadwalan, P1

- Review dan persetujuan tetap wajib sebelum menjadwalkan.
- Tampilkan zona waktu; simpan waktu dalam UTC beserta zona waktu pengguna.
- Perubahan konten yang dijadwalkan membatalkan persetujuan dan menahan jadwal sampai direview kembali.
- Worker memeriksa ulang token dan kemampuan akun saat jadwal berjalan. Kegagalan ditampilkan tanpa mengganti akun tujuan otomatis.
- Publikasi terlambat akibat server berhenti diberi status terlewat dan memerlukan keputusan pengguna; tidak diterbitkan mendadak tanpa aturan keterlambatan yang disepakati.
- Pembatalan hanya dijamin sebelum worker memulai operasi eksternal.

## 9. Halaman utama

| Halaman | Isi dan tindakan utama |
| --- | --- |
| Dashboard | Ringkasan draft, proses aktif, kegagalan, dan kesehatan koneksi |
| Semua Konten | Daftar, filter, buka detail, duplikat, hapus draft |
| Buat/Edit Konten | Upload media, caption umum, tujuan, variasi per platform |
| Review Konten | Preview per tujuan, validasi, identitas akun, konfirmasi |
| Detail Publikasi | Hasil per platform, progres, tautan, retry terarah |
| Pustaka Media | Media tersimpan, metadata, penggunaan oleh draft |
| Akun Terhubung | Identitas akun, status token, cek koneksi, ganti kredensial |
| Kalender — P1 | Jadwal konten, buka detail, ubah waktu, batalkan |

Antarmuka dirancang desktop-first untuk review beberapa platform, dan tetap dapat digunakan dari ponsel. Pada layar sempit, preview ditampilkan melalui tab atau panel bertumpuk. Status menggunakan teks, ikon, dan warna; seluruh kontrol utama dapat dipakai melalui keyboard.

## 10. Model status

### Dokumen konten

`DRAFT → IN_REVIEW → APPROVED`

Perubahan isi/tujuan setelah review menghasilkan revisi yang kembali ke DRAFT. APPROVED hanya berarti versi siap diterbitkan; worker membutuhkan konfirmasi publish atau jadwal yang sah untuk menjalankan publikasi.

### Pekerjaan per tujuan

`QUEUED → UPLOADING → PROCESSING → SUCCEEDED`

Cabang lain: `FAILED`, `NEEDS_CHECK`, atau `CANCELED` sebelum operasi eksternal dimulai. Tidak semua provider memiliki tahap pemrosesan terpisah.

Status visibilitas eksternal disimpan terpisah dari status pekerjaan. SUCCEEDED berarti operasi yang diminta selesai berdasarkan bukti provider; tidak otomatis berarti konten public.

### Ringkasan batch

- Dalam proses: masih ada pekerjaan aktif.
- Perlu dicek: setidaknya satu hasil belum pasti, meskipun tujuan lain berhasil.
- Berhasil: semua tujuan menyelesaikan operasi yang diminta.
- Sebagian berhasil: ada tujuan sukses dan ada tujuan gagal/batal, tanpa hasil belum pasti.
- Gagal: semua pekerjaan gagal.
- Dibatalkan: semua pekerjaan dibatalkan sebelum pengiriman eksternal.

Ringkasan selalu disertai jumlah hasil, misalnya “2 berhasil, 1 gagal, 1 perlu dicek”.

## 11. Kebutuhan nonfungsional

### Keamanan dan privasi

- Kredensial hanya dipakai backend; tidak masuk bundle frontend, localStorage, URL aplikasi, repositori, analytics, atau log.
- Simpan token dengan enkripsi menggunakan kunci yang terpisah dari database, atau secret storage server untuk instalasi pribadi. Respons API aplikasi hanya mengirim informasi tersamarkan.
- OAuth/refresh token digunakan bila alur provider mendukung. Token yang tidak dapat diperbarui otomatis memerlukan pembaruan manual dengan status yang jelas.
- Media privat secara default. Untuk API yang mengambil URL, gunakan akses terbatas waktu yang cukup untuk proses provider dan perbarui URL saat retry bila diperlukan.
- MVP tidak memiliki registrasi, login aplikasi, atau manajemen sesi pengguna. Backend dan port database tidak diekspos ke jaringan; pemetaan port container web dibatasi ke loopback.
- Backend memvalidasi Host dan Origin serta melindungi tindakan perubahan data dari request lintas situs. Pembatasan CORS saja tidak dianggap cukup untuk melindungi aplikasi lokal tanpa login.
- Akun platform tetap memerlukan token/otorisasi provider. Menghapus login aplikasi tidak menghapus kebutuhan kredensial Instagram, Facebook, YouTube, atau LinkedIn.
- Validasi tipe/ukuran file di server. Jangan menerima URL sumber arbitrer yang dapat mengakses jaringan internal.
- Hapus token dan field sensitif dari pesan error serta log provider.

### Ketahanan dan kinerja

- Antrean tersimpan secara persisten dan pulih setelah restart worker.
- Simpan upload session, container ID, dan ID hasil bila provider mengizinkan pemulihan.
- Terapkan batas konkurensi dan rate limit per provider/akun; pekerjaan tidak bergantung pada browser terbuka.
- Sasaran UI: hasil simpan draft dan permintaan antrean ditampilkan dalam dua detik pada kondisi normal, di luar upload file dan waktu provider. Target ini harus diukur saat implementasi.
- UI memperlihatkan progres nyata bila tersedia; jangan menampilkan persentase buatan untuk tahap provider yang tidak memberikan progres.
- Durasi terbit eksternal tidak diberi SLA mutlak karena jaringan, kuota, dan pemrosesan platform.

### Penyimpanan

- Media draft dipertahankan sampai dihapus pemilik; media tanpa referensi dibersihkan setelah tujuh hari sebagai kebijakan awal usulan.
- Jangan membersihkan media yang masih diperlukan pekerjaan aktif atau jadwal.
- Riwayat metadata publikasi dipertahankan sampai dihapus pemilik. Menghapus riwayat lokal tidak menarik kembali kiriman eksternal.
- Tetapkan backup, pemulihan, dan batas penyimpanan sebelum digunakan rutin.

## 12. Rancangan teknis awal, belum mengikat

Komponen minimum: frontend web, backend, database relasional, object storage untuk media, dan worker background. Backend memiliki adapter terpisah untuk tiap platform agar aturan media dan lifecycle provider tidak bercampur.

Usulan stack: Next.js/TypeScript, PostgreSQL, penyimpanan kompatibel S3, dan worker dengan antrean persisten. Antrean berbasis database cukup untuk skala pribadi; Redis bukan persyaratan produk. Pilihan akhir mengikuti hosting, biaya, dan hasil uji unggah video.

Next.js menangani frontend dan backend API; worker Node.js menjalankan publikasi sebagai proses terpisah dalam satu repository. Backend menyimpan kredensial, draft, dan konfirmasi publikasi, lalu menyediakan status pekerjaan. Library autentikasi seperti Better Auth ditunda karena MVP tidak memakai login aplikasi.

Alur data: browser mengunggah media ke storage melalui akses terbatas; backend menyimpan draft dan memvalidasi konten; konfirmasi membuat snapshot dan pekerjaan; worker memproses API; UI membaca status dari backend.

### Entitas inti

| Entitas | Tanggung jawab |
| --- | --- |
| WorkspaceConfig | Pengaturan satu ruang kerja lokal; tanpa tabel user atau sesi pada MVP |
| ConnectedAccount | Platform, identitas tujuan, referensi kredensial, status kemampuan |
| MediaAsset | Lokasi file, metadata, pemilik, dan referensi penggunaan |
| Content / ContentRevision | Konten dan versi yang tidak berubah setelah dikonfirmasi |
| PlatformVariant | Caption, media, format, dan metadata khusus tujuan |
| ReviewRecord | Versi dan target yang ditinjau, hasil validasi, waktu persetujuan |
| PublicationBatch / PublicationJob | Konfirmasi batch, snapshot tujuan, status, kunci deduplikasi |
| PublicationAttempt | Percobaan, error tersamarkan, ID/session provider, waktu dan hasil |

Tidak diperlukan microservices atau sistem workflow umum untuk MVP.

## 13. Kriteria penerimaan MVP

| ID | Skenario | Hasil yang harus terbukti |
| --- | --- | --- |
| AC-01 | Unggah file lalu simpan draft | File dan draft tersedia kembali; tidak ada publikasi eksternal |
| AC-02 | Teks/gambar dipilih untuk YouTube | Tujuan diblokir dengan alasan membutuhkan video |
| AC-03 | Caption LinkedIn diubah dari caption umum | Caption platform lain tetap sama |
| AC-04 | Pengguna membuka review | Media, caption final, metadata, dan nama akun tujuan dapat diperiksa |
| AC-05 | Konten diubah setelah direview | Persetujuan lama tidak dapat dipakai untuk versi baru |
| AC-06 | Satu tujuan terpilih tidak valid | Batch tidak dikirim sampai tujuan diperbaiki atau dikeluarkan |
| AC-07 | Pengguna memilih Instagram dan LinkedIn | Hanya dua tujuan tersebut yang diproses setelah konfirmasi |
| AC-08 | Tombol publish ditekan dua kali | Tetap satu pekerjaan per tujuan untuk konfirmasi yang sama |
| AC-09 | Instagram sukses, LinkedIn gagal | Status sebagian berhasil; retry tidak mengulang Instagram |
| AC-10 | Provider timeout setelah menerima publish | Status perlu dicek; tidak ada publish ulang otomatis tanpa rekonsiliasi |
| AC-11 | Browser ditutup saat proses aktif | Worker tetap berjalan selama komputer/server aktif; status dapat dilihat setelah web dibuka kembali tanpa login |
| AC-12 | Token kedaluwarsa atau izin kurang | Alasan dan langkah pemulihan tampil; akun tidak diganti otomatis |
| AC-13 | Worker restart setelah ID provider tersimpan | Melanjutkan/mengecek pekerjaan tanpa membuat kiriman baru secara buta |
| AC-14 | Video YouTube dikirim sebagai private | Hasil menunjukkan private, tidak mengklaim konten sudah public |
| AC-15 | Web dijalankan tanpa login | Dashboard lokal dapat dibuka langsung; port tidak dapat diakses dari jaringan lain, request perubahan data lintas situs ditolak, dan token tidak muncul pada respons baca atau log |
| AC-16 | Pengujian integrasi tiap pasangan platform/format | Identitas tujuan dan hasil provider tercatat sebelum fitur ditandai tersedia |

Uji integrasi dimulai dari pemeriksaan tanpa publikasi. Pengujian yang membuat posting nyata dilakukan melalui konfirmasi publikasi terpisah pada akun yang ditetapkan pemilik.

## 14. Tahap pengerjaan dan batas selesai

1. **Verifikasi integrasi:** tentukan jenis token/login, akun tujuan, izin, format, kuota, dan akses baca status. Keluaran berupa matriks kemampuan; blocker dicatat per platform.
2. **Fondasi draft:** akses lokal tanpa login, koneksi akun, upload media, draft, dan composer variasi. Selesai saat data bertahan setelah reload, batas akses lokal terpenuhi, dan tidak ada publish otomatis.
3. **Review:** preview, validasi server, snapshot versi, dan konfirmasi tujuan. Selesai saat perubahan konten membatalkan persetujuan lama.
4. **Publikasi:** worker dan adapter keempat platform secara bertahap. Selesai saat pasangan format yang disepakati lulus uji end-to-end.
5. **Pemulihan:** status parsial, retry, rekonsiliasi timeout, restart worker, dan pemeriksaan kebocoran kredensial. Selesai saat AC-01 hingga AC-16 terpenuhi.
6. **P1:** jadwal dan format tambahan setelah MVP memenuhi kriteria penerimaan.

Estimasi kalender dan biaya ditentukan setelah tahap verifikasi integrasi. Ketersediaan token saja belum cukup untuk memperkirakan waktu persetujuan platform atau kebutuhan hosting video.

## 15. Keputusan terbuka sebelum implementasi

Keputusan berikut tidak menghalangi review PRD, tetapi memengaruhi implementasi:

| Pertanyaan | Default usulan |
| --- | --- |
| Dipakai sendiri atau oleh tim? | Sendiri; reviewer tim masuk P2 |
| Akun Instagram sudah Business/Creator? | Wajib diverifikasi; jangan mengubah akun otomatis |
| Facebook tujuan Page atau profil pribadi? | Page; bila kebutuhan sebenarnya profil pribadi, lingkup perlu dibahas ulang |
| LinkedIn tujuan profil atau Company Page? | Profil dahulu; Company Page bila izin dan peran sesuai |
| Apakah jadwal wajib di rilis pertama? | P1 agar alur review dan publikasi stabil lebih dulu |
| Format prioritas dan ukuran video harian? | Gambar tunggal dan video; konfirmasi untuk memilih kapasitas storage |
| Token dapat diperbarui otomatis? | Verifikasi per provider; sediakan jalur pembaruan manual |
| Hosting dan akses web? | MVP tanpa login dengan default lokal/localhost; jika perlu akses jaringan atau hosting publik, tentukan kontrol akses sebelum deployment |

## 16. Sumber dan pemeliharaan

Riset awal dilakukan 11 November 2026 melalui dokumentasi primer. Beberapa halaman memiliki versi/cache berbeda. Detail batas file, durasi, rate limit, versi API, dan izin wajib diverifikasi kembali saat adapter dibuat. Pemilik implementasi memperbarui bagian integrasi dan matriks kemampuan ketika hasil pemeriksaan akun atau perubahan provider berbeda dari asumsi ini.

- **[S1]** [Meta — Instagram API, koleksi resmi di Postman](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api). Sumber yang dapat diakses untuk login, akun profesional, Page token, dan alur Reel. Parameter numerik koleksi tidak disalin menjadi kontrak permanen produk.
- **[S2]** [Meta — Pages API: Posts](https://developers.facebook.com/docs/pages-api/posts/). Rujukan kanonis; pengambilan halaman saat riset menghasilkan HTTP 429. Verifikasi detail permission dan endpoint masih diperlukan.
- **[S3]** [Google — YouTube Data API: videos.insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert?hl=en). Upload, authorization, dan metadata video. [Resource videos](https://developers.google.com/youtube/data/reference/rest/v3/videos?hl=en) menjelaskan status dan privasi.
- **[S4]** [Google — YouTube Data API Revision History](https://developers.google.com/youtube/data/revision_history). Hasil pencarian halaman menunjukkan pembaruan 2 November 2026; pembacaan penuh halaman tidak berhasil. Konfirmasi kebijakan efektif sebelum rilis karena referensi lama berbeda.
- **[S5]** [Microsoft Learn — LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api). Izin anggota/organisasi, header versi, aset media, dan respons pembuatan posting.
