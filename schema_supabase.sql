-- Schema Postgres untuk Supabase (bukan SQLite). Struktur ini mengikuti
-- persis kolom yang dipakai app.py lewat client supabase-py.
-- Jalankan sekali di Supabase SQL Editor (atau lewat koneksi Postgres
-- langsung) sebelum app.py dipakai.

CREATE TABLE IF NOT EXISTS station_map (
  station_id INTEGER PRIMARY KEY,
  cluster TEXT,
  display_name TEXT NOT NULL,
  floor INTEGER NOT NULL DEFAULT 1,
  position_x REAL NOT NULL DEFAULT 50,
  position_y REAL NOT NULL DEFAULT 50,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Status realtime terakhir tiap station. Diisi lewat MQTT (mqtt_worker.py /
-- app.py) atau HTTP Gateway (POST /api/gateway/ingest).
CREATE TABLE IF NOT EXISTS andon_current_state (
  station_id INTEGER PRIMARY KEY,
  machine INTEGER NOT NULL DEFAULT 0,
  quality INTEGER NOT NULL DEFAULT 0,
  material INTEGER NOT NULL DEFAULT 0,
  last_update TIMESTAMPTZ
);

-- Satu baris per insiden (bukan satu baris per event seperti versi Node) -
-- start_time diisi saat 0->1, end_time+duration_seconds diisi saat 1->0.
CREATE TABLE IF NOT EXISTS status_history (
  id BIGSERIAL PRIMARY KEY,
  station_id INTEGER NOT NULL,
  problem_type TEXT NOT NULL CHECK (problem_type IN ('Machine', 'Material', 'Quality')),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_status_history_station
  ON status_history (station_id, problem_type, start_time);

-- Antrean command (tombol Reset/Machine/Material/Quality dari dashboard)
-- untuk Gateway ESP32 yang polling GET /api/gateway/commands (jalur HTTP,
-- pengganti MQTT/LoRa serial - lihat POST /api/gateway/ingest di app.py).
CREATE TABLE IF NOT EXISTS pending_commands (
  id BIGSERIAL PRIMARY KEY,
  station_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  value INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_commands_created_at ON pending_commands (created_at);
