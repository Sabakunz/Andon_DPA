# Integrasi Andon Dashboard + LoRa

## Topologi
PC (Flask + SQLite) <-> USB Serial <-> ESP32 Gateway + LoRa <-> ESP32 Andon Node

Node 1 = Sleeve = department ID 1.

## Library Arduino
Install library **LoRa** by Sandeep Mistry melalui Arduino IDE Library Manager.

## Pin contoh ESP32 + SX1278/SX1276
SPI:
- SCK 18
- MISO 19
- MOSI 23
- NSS/CS 5
- RST 14
- DIO0 26

Node:
- tombol ANDON GPIO 25 ke GND
- tombol WARNING GPIO 33 ke GND
- tombol RESET GPIO 32 ke GND
- lampu merah GPIO 27
- lampu kuning GPIO 12
- buzzer GPIO 13

> Pin dan frekuensi harus disesuaikan dengan board/modul LoRa yang benar-benar dipakai. Jangan langsung memberi tegangan ke lampu/buzzer industri dari GPIO ESP32; gunakan transistor/MOSFET/relay/driver yang sesuai.

## Urutan pemasangan
1. Upload `lora_gateway.ino` ke ESP32 gateway.
2. Upload `andon_node.ino` ke ESP32 node.
3. Ubah `DEPARTMENT_ID` pada setiap node sesuai `id` tabel `departments`.
4. Pastikan `LORA_FREQ` sama pada gateway dan semua node, dan sesuai regulasi/perangkat yang digunakan.
5. Sambungkan gateway ke PC melalui USB.
6. Lihat COM port di Arduino IDE / Device Manager, lalu ubah `SERIAL_PORT` di `app.py` (contoh `COM5`).
7. Install dependency: `pip install -r requirements.txt`.
8. Jalankan `python app.py`.
9. Buka `http://127.0.0.1:5000`.

## Test pertama
- Tekan tombol merah di Node 1.
- Node mengirim `EVENT|NODE01|1|ANDON`.
- Gateway meneruskan sebagai `RX|NODE01|1|ANDON` melalui USB.
- Flask mengubah Sleeve menjadi `Andon Call / Berhenti`.
- Dashboard refresh 5 detik dan marker/KPI berubah.

Jika dashboard mengirim command ke node, endpoint baru adalah:
`POST /api/lora/command/<department_id>` dengan JSON `{"command":"RESET"}`.

Command yang didukung: `ANDON`, `WARNING`, `RESET`.
