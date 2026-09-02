# Andon Dashboard — Railway Ready

Dashboard Andon PT. Dharma Precision Parts dengan:
- Lantai 1 dan Lantai 2
- Status Normal / Machine / Material / Quality
- History Andon dengan waktu mulai, selesai, dan durasi
- Denah produksi dan marker status
- Auto-refresh dashboard setiap 5 detik
- API Flask untuk integrasi Gateway LoRa di tahap berikutnya

## Menjalankan lokal

```powershell
cd C:\andon_dashboard
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

Buka `http://127.0.0.1:5000`.

## Deploy ke Railway

Project sudah dilengkapi `Procfile`, `railway.toml`, `runtime.txt`, dan Gunicorn.

### Opsi A — GitHub (disarankan)
1. Buat repository GitHub baru.
2. Upload isi folder `andon_dashboard` ke repository tersebut.
3. Di Railway pilih **New Project → Deploy from GitHub Repo**.
4. Pilih repository Andon Dashboard.
5. Railway akan membaca konfigurasi dan menjalankan Gunicorn.
6. Setelah deploy selesai, buka **Settings/Networking** lalu buat public domain.
7. Health check: `/health`.

### Opsi B — Railway CLI
Di folder project:

```powershell
railway login
railway init
railway up
```

Setelah service dibuat, generate public domain dari pengaturan Networking Railway.

## Environment Variables

Default yang aman untuk deployment dashboard:

```text
LORA_ENABLED=false
FLASK_DEBUG=false
```

`PORT` diisi otomatis oleh Railway, jadi tidak perlu dibuat manual.

Untuk database SQLite pada Railway, gunakan persistent volume. Set:

```text
DATABASE_PATH=/app/data/andon.db
```

Lalu mount Railway Volume ke:

```text
/app/data
```

Tanpa persistent volume, file SQLite pada filesystem deployment tidak boleh dianggap sebagai penyimpanan permanen.

## Catatan database

Versi ini masih menggunakan SQLite agar kompatibel dengan project lokal yang sekarang. Untuk deployment produksi jangka panjang dengan banyak akses bersamaan, database PostgreSQL adalah tahap berikutnya yang disarankan.

## LoRa

Server Railway tidak mempunyai COM5 dan tidak boleh membaca USB LoRa secara langsung. Nantinya arsitektur yang disarankan:

```text
ESP32 Node → LoRa → ESP32 Gateway → USB → PC Gateway Client → HTTPS → Railway → Dashboard
```

Untuk deployment cloud, biarkan `LORA_ENABLED=false`. Integrasi Gateway Client akan ditambahkan pada tahap berikutnya.

## Fitur UI terbaru
- **Tambah Line:** tombol `＋ TAMBAH LINE` untuk menambahkan line baru ke lantai 1 atau 2, menentukan cluster, nama line, serta posisi marker X/Y pada denah.
- **Zoom Denah:** tombol `−`, `100%`, `+` pada denah. Zoom juga dapat dilakukan dengan scroll mouse di area denah.
- Posisi marker tersimpan di database sebagai persentase agar tetap mengikuti ukuran denah.


## V3 — Dashboard & Setting

Aplikasi kini memiliki dua mode:
- `/` — **Dashboard**, khusus monitoring map, status Andon, KPI, dan history. Tidak ada kontrol layout/line.
- `/settings` — **Setting**, untuk admin/operator yang melakukan konfigurasi.

Fitur Setting:
- Drag & drop indikator line langsung di denah.
- Tombol **Simpan Posisi** untuk menyimpan koordinat X/Y.
- Tambah line.
- Edit nama line, cluster, lantai, dan posisi.
- Nonaktifkan/aktifkan kembali line tanpa menghapus histori Andon.
- Zoom denah tetap tersedia di kedua mode.

Perubahan posisi dan data line disimpan di database SQLite. Kolom `is_active` dipakai untuk soft-delete agar histori lama tetap aman.

Untuk deployment Railway, perubahan pada repository GitHub akan dideploy otomatis sesuai konfigurasi Railway.
