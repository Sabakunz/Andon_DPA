from flask import Flask, render_template, jsonify, request, redirect, url_for, session, Response
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client
import paho.mqtt.client as mqtt
import threading
import time
import os
import hmac
import json
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

try:
    import serial
except ImportError:
    serial = None

BASE = Path(__file__).resolve().parent
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

MQTT_HOST = os.getenv("MQTT_HOST")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_PREFIX = os.getenv("MQTT_TOPIC_PREFIX", "andon-system-demo")
MQTT_ENABLED = os.getenv("MQTT_ENABLED", "false").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

TELEGRAM_BOT_TOKEN = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
TELEGRAM_CHAT_ID = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()

# Kunci bersama Gateway ESP32 <-> server untuk /api/gateway/*. Gateway kirim
# header X-Gateway-Key dengan nilai yang sama. Kosong = endpoint tidak terkunci
# (TIDAK disarankan kalau server ini publik di internet).
GATEWAY_KEY = (os.getenv("GATEWAY_KEY") or "").strip()


def send_telegram_message(message):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("TELEGRAM DISABLED: token/chat ID belum diatur")
        return False

    url = (
        f"https://api.telegram.org/bot"
        f"{TELEGRAM_BOT_TOKEN}/sendMessage"
    )

    payload = urlencode({
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
    }).encode("utf-8")

    try:
        req = Request(
            url,
            data=payload,
            method="POST",
        )

        with urlopen(req, timeout=10) as response:
            result = response.read().decode("utf-8")

        print("TELEGRAM SENT:", result)
        return True

    except HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="ignore")
        print("TELEGRAM HTTP ERROR:", error_body)
        return False

    except Exception as exc:
        print("TELEGRAM ERROR:", exc)
        return False


supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)


def on_mqtt_connect(client, userdata, flags, reason_code, properties):
    print("MQTT CONNECT:", reason_code)

    if reason_code == 0:
        topic = f"{MQTT_TOPIC_PREFIX}/#"
        client.subscribe(topic)
        print("MQTT SUBSCRIBED:", topic)


def _problem_type_from_field(field):
    return {
        "machine": "Machine",
        "material": "Material",
        "quality": "Quality",
    }.get(field)


def _normalize_state_value(value):
    if isinstance(value, bool):
        return 1 if value else 0

    try:
        return 1 if int(value) else 0
    except (TypeError, ValueError):
        raise ValueError("nilai state harus 0 atau 1")


def update_station_state(station_id, changes, source="MQTT"):
    """Update field yang dikirim lalu sinkronkan histori Supabase."""
    station_id = int(station_id)

    allowed = {"machine", "quality", "material"}

    changes = {
        key: value
        for key, value in changes.items()
        if key in allowed
    }

    if not changes:
        return False

    normalized = {
        key: _normalize_state_value(value)
        for key, value in changes.items()
    }

    existing_result = (
        supabase
        .table("andon_current_state")
        .select(
            "station_id,machine,quality,material,last_update"
        )
        .eq("station_id", station_id)
        .limit(1)
        .execute()
    )

    if existing_result.data:
        old = existing_result.data[0]
    else:
        old = {
            "station_id": station_id,
            "machine": 0,
            "quality": 0,
            "material": 0,
        }

    # Hanya field yang dikirim yang berubah.
    next_state = {
        "station_id": station_id,
        "machine": int(old.get("machine", 0) or 0),
        "quality": int(old.get("quality", 0) or 0),
        "material": int(old.get("material", 0) or 0),
    }

    next_state.update(normalized)

    # Waktu database menggunakan UTC.
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # Simpan current state.
    (
        supabase
        .table("andon_current_state")
        .upsert(
            {
                **next_state,
                "last_update": now_iso,
            },
            on_conflict="station_id",
        )
        .execute()
    )

    # Sinkronkan histori per jenis masalah.
    for field, new_value in normalized.items():
        old_value = int(old.get(field, 0) or 0)
        new_value = int(new_value)

        problem_type = _problem_type_from_field(field)

        if old_value == new_value:
            continue

        # Cari history yang masih aktif untuk problem tersebut.
        active_result = (
            supabase
            .table("status_history")
            .select("id,start_time")
            .eq("station_id", station_id)
            .eq("problem_type", problem_type)
            .is_("end_time", "null")
            .order("id", desc=True)
            .limit(1)
            .execute()
        )

        active = (
            active_result.data[0]
            if active_result.data
            else None
        )

        # ========================================================
        # MASALAH AKTIF: 0 -> 1
        # ========================================================
        if new_value == 1 and old_value == 0:

            (
                supabase
                .table("status_history")
                .insert(
                    {
                        "station_id": station_id,
                        "problem_type": problem_type,
                        "start_time": now_iso,
                        "end_time": None,
                        "duration_seconds": None,
                    }
                )
                .execute()
            )

            # Waktu tampil Telegram menggunakan WIB.
            start_time_display = datetime.now(
                timezone(timedelta(hours=7))
            ).strftime("%H:%M:%S")

            send_telegram_message(
                f"🚨 ANDON ALERT\n"
                f"Station: {station_id}\n"
                f"Problem: {problem_type}\n"
                f"Status: AKTIF\n"
                f"Jam Mulai: {start_time_display} WIB"
            )

        # ========================================================
        # MASALAH SELESAI: 1 -> 0
        # ========================================================
        elif (
            new_value == 0
            and old_value == 1
            and active
        ):

            start_time = active.get("start_time")
            duration_seconds = None

            if start_time:
                try:
                    started = datetime.fromisoformat(
                        start_time.replace("Z", "+00:00")
                    )

                    duration_seconds = max(
                        0,
                        int(
                            (
                                now - started
                            ).total_seconds()
                        ),
                    )

                except (ValueError, TypeError):
                    duration_seconds = None

            # Tutup history.
            (
                supabase
                .table("status_history")
                .update(
                    {
                        "end_time": now_iso,
                        "duration_seconds": duration_seconds,
                    }
                )
                .eq("id", active["id"])
                .execute()
            )

            print(
                f"[HISTORY END] "
                f"Station {station_id} - "
                f"{problem_type} - "
                f"{duration_seconds}s"
            )

            duration_text = "N/A"

            if duration_seconds is not None:
                minutes = duration_seconds // 60
                seconds = duration_seconds % 60
                duration_text = f"{minutes:02d}:{seconds:02d}"

            # RESET dari web akan mengirim recovery
            # secara khusus di fungsi RESET.
            if source != "Web RESET":

                finish_time = datetime.now(
                    timezone(timedelta(hours=7))
                ).strftime("%H:%M:%S")

                send_telegram_message(
                    f"✅ ANDON RECOVERY\n"
                    f"Station: {station_id}\n"
                    f"Problem: {problem_type}\n"
                    f"Status: SELESAI\n"
                    f"Jam Selesai: {finish_time} WIB\n"
                    f"Durasi: {duration_text}"
                )

    print(
        f"{source} STATE -> Station {station_id} | "
        f"Machine={next_state['machine']} | "
        f"Quality={next_state['quality']} | "
        f"Material={next_state['material']}"
    )

    return True


def on_mqtt_message(client, userdata, message):
    print("MQTT MESSAGE:", message.topic)

    try:
        payload = message.payload.decode(
            "utf-8",
            errors="ignore",
        )

        print("MQTT PAYLOAD:", payload)

        data = json.loads(payload)

        station_id = data.get("station")

        if station_id is None:
            print("MQTT ERROR: station tidak ditemukan")
            return

        changes = {}

        for field in (
            "machine",
            "quality",
            "material",
        ):
            if field in data:
                changes[field] = data[field]

        if not changes:
            print(
                "MQTT ERROR: tidak ada field "
                "machine/quality/material"
            )
            return

        update_station_state(
            station_id,
            changes,
            source="MQTT",
        )

    except Exception as e:
        print("MQTT PROCESS ERROR:", e)


mqtt_client.on_connect = on_mqtt_connect
mqtt_client.on_message = on_mqtt_message


# ============================================================
# LORA GATEWAY SERIAL SETTINGS
# ============================================================

# Windows contoh: COM5
# Linux: /dev/ttyUSB0
# Raspberry Pi: /dev/ttyUSB0


def env_bool(name, default=False):
    value = os.getenv(name)

    if value is None:
        return default

    return value.strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


LORA_ENABLED = env_bool(
    "LORA_ENABLED",
    False,
)

SERIAL_PORT = os.getenv(
    "SERIAL_PORT",
    "COM5",
)

SERIAL_BAUD = int(
    os.getenv(
        "SERIAL_BAUD",
        "115200",
    )
)


app = Flask(__name__)

app.secret_key = os.getenv(
    "SECRET_KEY",
    "andon-dashboard-change-this-secret",
)

LOGIN_USERNAME = os.getenv(
    "LOGIN_USERNAME",
    "admin",
)

LOGIN_PASSWORD = os.getenv(
    "LOGIN_PASSWORD",
    "andon123",
)

serial_conn = None
serial_lock = threading.Lock()

serial_status = "Gateway belum terhubung"


def is_logged_in():
    return bool(
        session.get("logged_in")
    )


@app.before_request
def require_login():
    if request.endpoint in {
        "login",
        "health",
        "static",
        "whatsapp_webhook",
        "gateway_ingest",
        "gateway_commands",
    }:
        return None

    if is_logged_in():
        return None

    if request.path.startswith("/api/"):
        return jsonify(
            {
                "error": "Login diperlukan"
            }
        ), 401

    return redirect(
        url_for("login")
    )


def enqueue_gateway_command(station_id, changes):
    """Antre command untuk Gateway ESP32 yang polling GET /api/gateway/commands
    (jalur HTTP, tanpa MQTT/LoRa serial). Dipanggil setiap ada command dari
    dashboard (RESET/MACHINE/MATERIAL/QUALITY) supaya lampu fisik ikut berubah,
    bukan cuma status di Supabase."""
    rows = [
        {"station_id": int(station_id), "category": key, "value": int(value)}
        for key, value in changes.items()
    ]

    if not rows:
        return

    try:
        supabase.table("pending_commands").insert(rows).execute()
    except Exception as exc:
        print("ENQUEUE GATEWAY COMMAND ERROR:", exc)


def update_station_status_from_command(
    station_id,
    command,
):
    command = command.upper()

    # ========================================================
    # RESET DARI WEB
    # ========================================================
    if command == "RESET":

        # Cari history yang masih aktif.
        # Ambil yang paling baru karena itu problem terakhir
        # yang sedang aktif.
        active_history_result = (
            supabase
            .table("status_history")
            .select(
                "id,problem_type,start_time"
            )
            .eq(
                "station_id",
                station_id
            )
            .is_(
                "end_time",
                "null"
            )
            .order(
                "id",
                desc=True
            )
            .limit(1)
            .execute()
        )

        active_history = (
            active_history_result.data[0]
            if active_history_result.data
            else None
        )

        # Reset semua status.
        changes = {
            "machine": 0,
            "quality": 0,
            "material": 0,
        }

        ok = update_station_state(
            station_id,
            changes,
            source="Web RESET",
        )

        if not ok:
            return False

        enqueue_gateway_command(station_id, changes)

        # ====================================================
        # KIRIM RECOVERY KHUSUS RESET
        # ====================================================

        if active_history:

            reset_time = datetime.now(
                timezone.utc
            )

            start_time = active_history.get(
                "start_time"
            )

            duration_seconds = None

            if start_time:
                try:
                    started = datetime.fromisoformat(
                        start_time.replace(
                            "Z",
                            "+00:00"
                        )
                    )

                    duration_seconds = max(
                        0,
                        int(
                            (
                                reset_time - started
                            ).total_seconds()
                        )
                    )

                except (
                    ValueError,
                    TypeError
                ):
                    duration_seconds = None

            duration_text = "N/A"

            if duration_seconds is not None:
                minutes = duration_seconds // 60
                seconds = duration_seconds % 60

                duration_text = (
                    f"{minutes:02d}:{seconds:02d}"
                )

            # Jam selesai RESET dalam WIB.
            finish_time = datetime.now(
                timezone(timedelta(hours=7))
            ).strftime("%H:%M:%S")

            send_telegram_message(
                f"✅ ANDON RECOVERY\n"
                f"Station: {station_id}\n"
                f"Problem: "
                f"{active_history['problem_type']}\n"
                f"Status: SELESAI\n"
                f"Jam Selesai: {finish_time} WIB\n"
                f"Durasi: {duration_text}"
            )

            print(
                f"[WEB RESET RECOVERY] "
                f"Station {station_id} - "
                f"{active_history['problem_type']} - "
                f"{duration_text}"
            )

        else:

            print(
                f"WEB RESET: "
                f"Station {station_id} "
                f"tidak memiliki history aktif"
            )

        return True

    # ========================================================
    # COMMAND NORMAL
    # ========================================================

    mapping = {
        "MACHINE": {
            "machine": 1,
            "quality": 0,
            "material": 0,
        },

        "MATERIAL": {
            "machine": 0,
            "quality": 0,
            "material": 1,
        },

        "QUALITY": {
            "machine": 0,
            "quality": 1,
            "material": 0,
        },
    }

    changes = mapping.get(
        command
    )

    if changes is None:
        return False

    ok = update_station_state(
        station_id,
        changes,
        source="LoRa/API",
    )

    if ok:
        enqueue_gateway_command(station_id, changes)

    return ok


def process_gateway_line(line):
    """Format gateway: RX|NODE01|2|MACHINE."""
    global serial_status

    line = line.strip()

    if not line:
        return

    print("<--", line)

    parts = line.split("|")

    if len(parts) < 4:
        return

    if parts[0] != "RX":
        return

    _, node_id, station_id, command = parts[:4]

    try:
        station_id = int(station_id)
    except ValueError:
        return

    command = command.upper()

    ok = update_station_status_from_command(
        station_id,
        command,
    )

    serial_status = (
        f"Gateway OK | {node_id} | "
        f"{command} | "
        f"DB={'OK' if ok else 'GAGAL'}"
    )


def serial_reader():
    global serial_conn
    global serial_status

    if serial is None:
        serial_status = (
            "pyserial belum terpasang"
        )
        return

    while True:
        try:
            if (
                serial_conn is None
                or not serial_conn.is_open
            ):
                serial_status = (
                    f"Mencoba konek {SERIAL_PORT}..."
                )

                serial_conn = serial.Serial(
                    SERIAL_PORT,
                    SERIAL_BAUD,
                    timeout=1,
                )

                time.sleep(2)

                serial_status = (
                    f"Gateway terhubung: "
                    f"{SERIAL_PORT}"
                )

                print(serial_status)

            raw = serial_conn.readline()

            if raw:
                process_gateway_line(
                    raw.decode(
                        "utf-8",
                        errors="ignore",
                    )
                )

        except Exception as exc:
            serial_status = (
                f"Gateway error: {exc}"
            )

            print(serial_status)

            try:
                if serial_conn:
                    serial_conn.close()
            except Exception:
                pass

            serial_conn = None
            time.sleep(3)


def start_mqtt():
    if not MQTT_ENABLED:
        print("MQTT DISABLED")
        return

    if not MQTT_HOST:
        print(
            "MQTT DISABLED: "
            "MQTT_HOST belum diatur"
        )
        return

    try:
        mqtt_client.connect(
            MQTT_HOST,
            MQTT_PORT,
            keepalive=60,
        )

        mqtt_client.loop_start()

        print(
            f"MQTT STARTED: "
            f"{MQTT_HOST}:{MQTT_PORT}"
        )

    except Exception as exc:
        print(
            "MQTT START ERROR:",
            exc,
        )


def send_lora_command(
    department_id,
    command,
):
    """Kirim command Flask -> USB serial -> LoRa gateway -> node."""

    if not LORA_ENABLED:
        return (
            False,
            "Mode demo - LoRa belum diaktifkan",
        )

    if (
        serial_conn is None
        or not serial_conn.is_open
    ):
        return (
            False,
            "Gateway LoRa tidak terhubung",
        )

    line = (
        f"CMD|{department_id}|"
        f"{command}\n"
    )

    try:
        with serial_lock:
            serial_conn.write(
                line.encode("utf-8")
            )

            serial_conn.flush()

        return True, "OK"

    except Exception as exc:
        return False, str(exc)


@app.get("/health")
def health():
    """Health check tanpa ketergantungan SQLite."""

    try:
        result = (
            supabase
            .table("station_map")
            .select("station_id")
            .limit(1)
            .execute()
        )

        return jsonify(
            {
                "status": "ok",
                "supabase": True,
                "rows_checked": len(
                    result.data
                ),
            }
        )

    except Exception as exc:
        return jsonify(
            {
                "status": "error",
                "supabase": False,
                "error": str(exc),
            }
        ), 500


# ============================================================
# GATEWAY ESP32 (HTTP) - pengganti MQTT/LoRa serial.
# Gateway kirim status station via POST /api/gateway/ingest, dan ambil
# command (tombol Reset dari dashboard) via polling GET /api/gateway/commands.
# Tidak butuh broker MQTT atau proses tambahan yang harus selalu nyala -
# cocok untuk Vercel (serverless).
# ============================================================

def _check_gateway_key():
    if GATEWAY_KEY and request.headers.get("X-Gateway-Key") != GATEWAY_KEY:
        return jsonify({"error": "X-Gateway-Key salah atau tidak ada"}), 401
    return None


@app.post("/api/gateway/ingest")
def gateway_ingest():
    denied = _check_gateway_key()
    if denied:
        return denied

    payload = request.get_json(silent=True) or {}
    station_id = payload.get("station")

    try:
        station_id = int(station_id)
    except (TypeError, ValueError):
        return jsonify({"error": 'payload harus memuat "station" (angka)'}), 400

    if station_id <= 0:
        return jsonify({"error": 'payload harus memuat "station" (angka > 0)'}), 400

    changes = {
        key: payload[key]
        for key in ("machine", "quality", "material")
        if key in payload
    }

    if not changes:
        # Heartbeat tanpa perubahan lampu (Gateway masih hidup) - tidak ada
        # yang perlu diupdate di andon_current_state selain menandai
        # station-nya sudah pernah dikenal.
        return jsonify({"ok": True, "station_id": station_id, "note": "heartbeat"})

    try:
        ok = update_station_state(station_id, changes, source="HTTP Gateway")
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if not ok:
        return jsonify({"error": "tidak ada field machine/quality/material yang valid"}), 400

    return jsonify({"ok": True, "station_id": station_id, "changes": changes})


@app.get("/api/gateway/commands")
def gateway_commands():
    denied = _check_gateway_key()
    if denied:
        return denied

    ttl_cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=60)
    ).isoformat()

    try:
        result = (
            supabase
            .table("pending_commands")
            .select("id,station_id,category,value,created_at")
            .execute()
        )
    except Exception as exc:
        print("GATEWAY COMMANDS FETCH ERROR:", exc)
        return Response("", mimetype="text/plain")

    rows = result.data or []
    ids = [row["id"] for row in rows]

    if ids:
        try:
            supabase.table("pending_commands").delete().in_("id", ids).execute()
        except Exception as exc:
            print("GATEWAY COMMANDS DELETE ERROR:", exc)

    fresh = [row for row in rows if (row.get("created_at") or "") >= ttl_cutoff]
    lines = [
        f"{row['station_id']}|{row['category']}|{row['value']}"
        for row in fresh
    ]

    return Response("\n".join(lines), mimetype="text/plain")


# ============================================================
# WHATSAPP WEBHOOK
# ============================================================

WHATSAPP_VERIFY_TOKEN = os.getenv(
    "WHATSAPP_VERIFY_TOKEN",
    "andon-whatsapp-verify",
)


@app.route(
    "/webhook/whatsapp",
    methods=["GET", "POST"],
)
def whatsapp_webhook():
    if request.method == "GET":
        mode = request.args.get(
            "hub.mode"
        )

        token = request.args.get(
            "hub.verify_token"
        )

        challenge = request.args.get(
            "hub.challenge"
        )

        if (
            mode == "subscribe"
            and token == WHATSAPP_VERIFY_TOKEN
        ):
            return challenge, 200

        return "Forbidden", 403

    data = request.get_json(
        silent=True
    ) or {}

    print(
        "WHATSAPP WEBHOOK:",
        json.dumps(
            data,
            indent=2,
        ),
    )

    return jsonify(
        {
            "ok": True
        }
    ), 200


# ============================================================
# LOGIN
# ============================================================

@app.route(
    "/login",
    methods=["GET", "POST"],
)
def login():
    if is_logged_in():
        return redirect(
            url_for("index")
        )

    error = None

    if request.method == "POST":
        username = request.form.get(
            "username",
            "",
        ).strip()

        password = request.form.get(
            "password",
            "",
        )

        if (
            hmac.compare_digest(
                username,
                LOGIN_USERNAME,
            )
            and hmac.compare_digest(
                password,
                LOGIN_PASSWORD,
            )
        ):
            session.clear()

            session["logged_in"] = True
            session["username"] = username
            session.permanent = True

            return redirect(
                url_for("index")
            )

        error = (
            "Username atau password salah."
        )

    return render_template(
        "login.html",
        error=error,
    )


@app.get("/logout")
def logout():
    session.clear()

    return redirect(
        url_for("login")
    )

@app.route("/history")
def history_page():
    return render_template(
        "index.html",
        mode="history",
        supabase_url=SUPABASE_URL,
        supabase_key=SUPABASE_KEY,
    )

@app.route("/report")
def report_page():
    return render_template(
        "index.html",
        mode="report",
        supabase_url=SUPABASE_URL,
        supabase_key=SUPABASE_KEY,
    )

@app.route("/")
def index():
    return render_template(
        "index.html",
        mode="dashboard",
        supabase_url=SUPABASE_URL,
        supabase_key=SUPABASE_KEY,
    )


@app.route("/settings")
def settings():
    return render_template(
        "index.html",
        mode="settings",
        supabase_url=SUPABASE_URL,
        supabase_key=SUPABASE_KEY,
    )


@app.get("/api/supabase-config")
def supabase_config():
    return jsonify(
        {
            "url": SUPABASE_URL,
            "key": SUPABASE_KEY,
        }
    )


def supabase_execute_with_retry(
    query,
    retries=3,
    delay=0.5,
):
    last_error = None

    for attempt in range(retries):
        try:
            return query.execute()

        except Exception as exc:
            last_error = exc

            if attempt < retries - 1:
                time.sleep(delay)

    raise last_error


@app.get("/api/departments")
def departments():
    include_inactive = (
        request.args.get(
            "include_inactive",
            "0",
        )
        == "1"
    )

    query = (
        supabase
        .table("station_map")
        .select(
            "station_id,cluster,display_name,"
            "floor,position_x,position_y,is_active"
        )
    )

    if not include_inactive:
        query = query.eq(
            "is_active",
            True,
        )

    stations = (
        supabase_execute_with_retry(
            query.order("station_id")
        ).data
    )

    states_result = (
        supabase_execute_with_retry(
            supabase
            .table("andon_current_state")
            .select(
                "station_id,machine,"
                "quality,material,last_update"
            )
        )
    )

    states = {
        row["station_id"]: row
        for row in states_result.data
    }

    result = []

    for station in stations:
        station_id = station[
            "station_id"
        ]

        state = states.get(
            station_id,
            {},
        )

        machine = int(
            state.get(
                "machine",
                0,
            )
            or 0
        )

        quality = int(
            state.get(
                "quality",
                0,
            )
            or 0
        )

        material = int(
            state.get(
                "material",
                0,
            )
            or 0
        )

        if machine:
            status = "Machine Problem"
            priority = "High"

        elif material:
            status = "Material Problem"
            priority = "High"

        elif quality:
            status = "Quality Problem"
            priority = "High"

        else:
            status = "Berjalan Normal"
            priority = "Normal"

        result.append(
            {
                "id": station_id,
                "station_id": station_id,
                "station_name": station[
                    "display_name"
                ],
                "cluster": station[
                    "cluster"
                ],
                "department": station[
                    "display_name"
                ],
                "status": status,
                "priority": priority,
                "due_date": None,
                "issue": None,
                "target_output": 0,
                "operator": None,
                "last_update": state.get(
                    "last_update"
                ),
                "floor": station[
                    "floor"
                ],
                "position_left": station[
                    "position_x"
                ],
                "position_top": station[
                    "position_y"
                ],
                "is_active": station[
                    "is_active"
                ],
            }
        )

    return jsonify(result)


@app.get("/api/history")
def history():
    floor = request.args.get(
        "floor",
        type=int,
    )

    history_result = (
        supabase_execute_with_retry(
            supabase
            .table("status_history")
            .select(
                "id,station_id,problem_type,"
                "start_time,end_time,duration_seconds"
            )
            .order(
                "id",
                desc=True,
            )
            .limit(100)
        )
    )

    history_rows = history_result.data

    stations_result = (
        supabase
        .table("station_map")
        .select(
            "station_id,cluster,display_name,floor"
        )
        .execute()
    )

    stations = {
        row["station_id"]: row
        for row in stations_result.data
    }

    result = []

    for event in history_rows:
        station = stations.get(
            event["station_id"]
        )

        if not station:
            continue

        if (
            floor in (1, 2)
            and station["floor"] != floor
        ):
            continue

        result.append(
            {
                "id": event["id"],
                "cluster": station[
                    "cluster"
                ],
                "department": station[
                    "display_name"
                ],
                "floor": station[
                    "floor"
                ],
                "problem_type": event[
                    "problem_type"
                ],
                "start_time": event[
                    "start_time"
                ],
                "end_time": event[
                    "end_time"
                ],
                "duration_seconds": event[
                    "duration_seconds"
                ],
            }
        )

    return jsonify(result)


@app.get("/api/lora/status")
def lora_status():
    return jsonify(
        {
            "connected": (
                serial_conn is not None
                and serial_conn.is_open
            ),
            "status": serial_status,
        }
    )


@app.post(
    "/api/lora/command/<int:department_id>"
)
def lora_command(department_id):
    payload = (
        request.get_json(
            silent=True
        )
        or {}
    )

    command = str(
        payload.get(
            "command",
            "",
        )
    ).upper()

    allowed = {
        "MACHINE",
        "MATERIAL",
        "QUALITY",
        "RESET",
    }

    if command not in allowed:
        return jsonify(
            {
                "error": (
                    "Command harus MACHINE, "
                    "MATERIAL, QUALITY, atau RESET"
                )
            }
        ), 400

    # Update Supabase langsung agar dashboard responsif.
    ok = update_station_status_from_command(
        department_id,
        command,
    )

    if not ok:
        return jsonify(
            {
                "error": (
                    "Gagal memperbarui "
                    "status station"
                )
            }
        ), 500

    sent, message = send_lora_command(
        department_id,
        command,
    )

    return jsonify(
        {
            "ok": True,
            "sent_to_lora": sent,
            "message": message,
        }
    )


@app.post("/api/departments")
def create_department():
    payload = (
        request.get_json(
            silent=True
        )
        or {}
    )

    cluster = str(
        payload.get(
            "cluster",
            "",
        )
    ).strip()

    department = str(
        payload.get(
            "department",
            "",
        )
    ).strip()

    station_name = str(
        payload.get(
            "station_name",
            "",
        )
    ).strip()

    try:
        station_id = int(
            payload.get(
                "station_id"
            )
        )

        floor = int(
            payload.get(
                "floor",
                1,
            )
        )

        position_left = float(
            payload.get(
                "position_left",
                50,
            )
        )

        position_top = float(
            payload.get(
                "position_top",
                50,
            )
        )

    except (
        TypeError,
        ValueError,
    ):
        return jsonify(
            {
                "error": (
                    "Station ID, lantai, "
                    "atau posisi tidak valid"
                )
            }
        ), 400

    # ==========================================
    # VALIDASI DATA
    # ==========================================

    if station_id <= 0:
        return jsonify(
            {
                "error": (
                    "Station ID harus "
                    "lebih besar dari 0"
                )
            }
        ), 400

    if not cluster:
        return jsonify(
            {
                "error": "Cluster wajib diisi"
            }
        ), 400

    if not department:
        return jsonify(
            {
                "error": (
                    "Nama line wajib diisi"
                )
            }
        ), 400

    if not station_name:
        return jsonify(
            {
                "error": (
                    "Station Name wajib diisi"
                )
            }
        ), 400

    if floor not in (1, 2):
        return jsonify(
            {
                "error": (
                    "Floor harus 1 atau 2"
                )
            }
        ), 400

    if not (
        0 <= position_left <= 100
    ):
        return jsonify(
            {
                "error": (
                    "Posisi X harus antara "
                    "0 sampai 100"
                )
            }
        ), 400

    if not (
        0 <= position_top <= 100
    ):
        return jsonify(
            {
                "error": (
                    "Posisi Y harus antara "
                    "0 sampai 100"
                )
            }
        ), 400

    try:
        # ==========================================
        # CEK STATION ID
        # ==========================================

        duplicate = (
            supabase
            .table("station_map")
            .select("station_id")
            .eq(
                "station_id",
                station_id,
            )
            .limit(1)
            .execute()
        )

        if duplicate.data:
            return jsonify(
                {
                    "error": (
                        f"Station ID "
                        f"{station_id} "
                        "sudah digunakan"
                    )
                }
            ), 409

        # ==========================================
        # INSERT STATION MAP
        # ==========================================

        insert_data = {
            "station_id": station_id,
            "cluster": cluster,
            "display_name": department,
            "floor": floor,
            "position_x": position_left,
            "position_y": position_top,
            "is_active": True,
        }

        result = (
            supabase
            .table("station_map")
            .insert(insert_data)
            .execute()
        )

        if not result.data:
            return jsonify(
                {
                    "error": (
                        "Gagal menambahkan line "
                        "ke Supabase"
                    )
                }
            ), 500

        # ==========================================
        # BUAT CURRENT STATE
        # ==========================================

        (
            supabase
            .table("andon_current_state")
            .upsert(
                {
                    "station_id": station_id,
                    "machine": 0,
                    "quality": 0,
                    "material": 0,
                },
                on_conflict="station_id",
            )
            .execute()
        )

        # ==========================================
        # RESPONSE
        # ==========================================

        return jsonify(
            {
                "ok": True,
                "station": result.data[0],
                "station_id": station_id,
                "station_name": station_name,
                "department": department,
            }
        ), 201

    except Exception as exc:
        print(
            "CREATE DEPARTMENT ERROR:",
            exc,
        )

        return jsonify(
            {
                "error": (
                    "Gagal menambahkan line: "
                    f"{str(exc)}"
                )
            }
        ), 500


@app.put(
    "/api/departments/<int:department_id>"
)
def update_department(
    department_id
):
    payload = (
        request.get_json(
            silent=True
        )
        or {}
    )

    update_data = {}

    # -----------------------------
    # DATA STATION
    # -----------------------------

    new_station_id = department_id

    if "station_id" in payload:
        try:
            new_station_id = int(
                payload["station_id"]
            )

        except (
            TypeError,
            ValueError,
        ):
            return jsonify(
                {
                    "error": (
                        "STATION_ID harus "
                        "berupa angka"
                    )
                }
            ), 400

        if new_station_id <= 0:
            return jsonify(
                {
                    "error": (
                        "STATION_ID harus "
                        "lebih besar dari 0"
                    )
                }
            ), 400

        # Cek apakah ID baru sudah dipakai
        if (
            new_station_id
            != department_id
        ):
            duplicate = (
                supabase
                .table("station_map")
                .select("station_id")
                .eq(
                    "station_id",
                    new_station_id,
                )
                .limit(1)
                .execute()
            )

            if duplicate.data:
                return jsonify(
                    {
                        "error": (
                            f"STATION_ID "
                            f"{new_station_id} "
                            "sudah digunakan"
                        )
                    }
                ), 409

    if "station_name" in payload:
        station_name = str(
            payload["station_name"]
        ).strip()

        if not station_name:
            return jsonify(
                {
                    "error": (
                        "STATION_NAME "
                        "wajib diisi"
                    )
                }
            ), 400

        update_data[
            "display_name"
        ] = station_name

    # -----------------------------
    # DATA LINE
    # -----------------------------

    if "position_left" in payload:
        update_data[
            "position_x"
        ] = float(
            payload["position_left"]
        )

    if "position_top" in payload:
        update_data[
            "position_y"
        ] = float(
            payload["position_top"]
        )

    if "cluster" in payload:
        update_data[
            "cluster"
        ] = str(
            payload["cluster"]
        ).strip()

    # Kompatibilitas dengan form lama.
    if "department" in payload:
        update_data[
            "display_name"
        ] = str(
            payload["department"]
        ).strip()

    if "floor" in payload:
        floor = int(
            payload["floor"]
        )

        if floor not in (1, 2):
            return jsonify(
                {
                    "error": (
                        "Floor harus 1 atau 2"
                    )
                }
            ), 400

        update_data[
            "floor"
        ] = floor

    if "is_active" in payload:
        update_data[
            "is_active"
        ] = bool(
            payload["is_active"]
        )

    if (
        not update_data
        and new_station_id
        == department_id
    ):
        return jsonify(
            {
                "error": (
                    "Tidak ada data "
                    "yang diubah"
                )
            }
        ), 400

    try:
        # -----------------------------
        # UPDATE STATION MAP
        # -----------------------------

        if (
            new_station_id
            != department_id
        ):
            update_data[
                "station_id"
            ] = new_station_id

        result = (
            supabase
            .table("station_map")
            .update(update_data)
            .eq(
                "station_id",
                department_id,
            )
            .execute()
        )

        if not result.data:
            return jsonify(
                {
                    "error": (
                        "Station tidak "
                        "ditemukan"
                    )
                }
            ), 404

        # -----------------------------
        # PINDAHKAN CURRENT STATE
        # -----------------------------

        if (
            new_station_id
            != department_id
        ):
            state_result = (
                supabase
                .table(
                    "andon_current_state"
                )
                .select("*")
                .eq(
                    "station_id",
                    department_id,
                )
                .limit(1)
                .execute()
            )

            if state_result.data:
                old_state = (
                    state_result.data[0]
                )

                (
                    supabase
                    .table(
                        "andon_current_state"
                    )
                    .delete()
                    .eq(
                        "station_id",
                        department_id,
                    )
                    .execute()
                )

                (
                    supabase
                    .table(
                        "andon_current_state"
                    )
                    .upsert(
                        {
                            "station_id":
                                new_station_id,
                            "machine":
                                int(
                                    old_state.get(
                                        "machine",
                                        0,
                                    )
                                    or 0
                                ),
                            "quality":
                                int(
                                    old_state.get(
                                        "quality",
                                        0,
                                    )
                                    or 0
                                ),
                            "material":
                                int(
                                    old_state.get(
                                        "material",
                                        0,
                                    )
                                    or 0
                                ),
                            "last_update":
                                old_state.get(
                                    "last_update"
                                ),
                        },
                        on_conflict=(
                            "station_id"
                        ),
                    )
                    .execute()
                )

        return jsonify(
            {
                "ok": True,
                "station": result.data[0],
                "station_id": new_station_id,
                "station_name":
                    result.data[0].get(
                        "display_name"
                    ),
            }
        )

    except Exception as exc:
        print(
            "UPDATE DEPARTMENT ERROR:",
            exc,
        )

        return jsonify(
            {
                "error": (
                    "Gagal memperbarui "
                    f"station: {str(exc)}"
                )
            }
        ), 500


@app.delete(
    "/api/departments/<int:department_id>"
)
def deactivate_department(
    department_id
):
    try:
        # Hapus state Andon station terlebih dahulu.
        (
            supabase
            .table("andon_current_state")
            .delete()
            .eq(
                "station_id",
                department_id,
            )
            .execute()
        )

        # Hapus station dari station_map.
        result = (
            supabase
            .table("station_map")
            .delete()
            .eq(
                "station_id",
                department_id,
            )
            .execute()
        )

        if not result.data:
            return jsonify(
                {
                    "error": (
                        "Line tidak ditemukan"
                    )
                }
            ), 404

        return jsonify(
            {
                "ok": True,
                "message": (
                    "Line berhasil dihapus"
                ),
            }
        )

    except Exception as exc:
        print(
            "DELETE DEPARTMENT ERROR:",
            exc,
        )

        return jsonify(
            {
                "error": (
                    "Gagal menghapus line: "
                    f"{str(exc)}"
                )
            }
        ), 500


if __name__ == "__main__":
    if MQTT_ENABLED:
        start_mqtt()

    if (
        LORA_ENABLED
        and serial is not None
    ):
        threading.Thread(
            target=serial_reader,
            daemon=True,
        ).start()

    port = int(
        os.getenv(
            "PORT",
            "5000",
        )
    )

    debug = env_bool(
        "FLASK_DEBUG",
        False,
    )

    app.run(
        host="0.0.0.0",
        port=port,
        debug=debug,
        use_reloader=False,
    )