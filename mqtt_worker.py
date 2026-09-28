import os
import json
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
import paho.mqtt.client as mqtt
from supabase import create_client
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError


load_dotenv()


# ============================================================
# SUPABASE
# ============================================================

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")


# ============================================================
# MQTT
# ============================================================

MQTT_HOST = os.getenv(
    "MQTT_HOST",
    "192.168.148.195"
)

MQTT_PORT = int(
    os.getenv(
        "MQTT_PORT",
        "1883"
    )
)

MQTT_USERNAME = os.getenv(
    "MQTT_USERNAME",
    "andon_gateway"
)

MQTT_PASSWORD = os.getenv(
    "MQTT_PASSWORD",
    ""
)

MQTT_TOPIC_PREFIX = os.getenv(
    "MQTT_TOPIC_PREFIX",
    "andon-system-demo"
)


# ============================================================
# TELEGRAM
# ============================================================

TELEGRAM_BOT_TOKEN = (
    os.getenv("TELEGRAM_BOT_TOKEN") or ""
).strip()

TELEGRAM_CHAT_ID = (
    os.getenv("TELEGRAM_CHAT_ID") or ""
).strip()


# ============================================================
# SUPABASE CLIENT
# ============================================================

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)


# ============================================================
# HELPER
# ============================================================

def _problem_type_from_field(field):
    return {
        "machine": "Machine",
        "material": "Material",
        "quality": "Quality",
    }.get(field)


def _normalize_state_value(value):
    try:
        return 1 if int(value) else 0

    except (TypeError, ValueError):
        raise ValueError(
            f"Nilai state tidak valid: {value}"
        )


# ============================================================
# TELEGRAM
# ============================================================

def send_telegram_message(message):
    if (
        not TELEGRAM_BOT_TOKEN
        or not TELEGRAM_CHAT_ID
    ):
        print(
            "TELEGRAM DISABLED: "
            "token/chat ID belum diatur"
        )
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

        with urlopen(
            req,
            timeout=10
        ) as response:

            result = (
                response
                .read()
                .decode("utf-8")
            )

        print(
            "TELEGRAM SENT:",
            result
        )

        return True

    except HTTPError as exc:

        error_body = (
            exc
            .read()
            .decode(
                "utf-8",
                errors="ignore"
            )
        )

        print(
            "TELEGRAM HTTP ERROR:",
            error_body
        )

        return False

    except Exception as exc:

        print(
            "TELEGRAM ERROR:",
            exc
        )

        return False


# ============================================================
# UPDATE STATION
# ============================================================

def update_station(
    station_id,
    changes
):
    # ========================================================
    # FIELD YANG DIIZINKAN
    # ========================================================

    allowed = {
        "machine",
        "quality",
        "material"
    }

    # Ambil hanya field yang diperbolehkan
    changes = {
        key: value
        for key, value in changes.items()
        if key in allowed
    }

    if not changes:
        print(
            "Tidak ada field "
            "machine/quality/material"
        )
        return

    # Normalisasi nilai menjadi 0 / 1
    normalized = {
        key: _normalize_state_value(value)
        for key, value in changes.items()
    }

    # ========================================================
    # AMBIL STATE LAMA
    # ========================================================

    result = (
        supabase
        .table("andon_current_state")
        .select(
            "station_id,"
            "machine,"
            "quality,"
            "material,"
            "last_update"
        )
        .eq(
            "station_id",
            station_id
        )
        .limit(1)
        .execute()
    )

    if result.data:
        old = result.data[0]
    else:
        old = {
            "station_id": station_id,
            "machine": 0,
            "quality": 0,
            "material": 0,
        }

    # ========================================================
    # STATE BARU
    # ========================================================

    next_state = {
        "station_id": station_id,

        "machine": int(
            old.get(
                "machine",
                0
            ) or 0
        ),

        "quality": int(
            old.get(
                "quality",
                0
            ) or 0
        ),

        "material": int(
            old.get(
                "material",
                0
            ) or 0
        ),
    }

    # Hanya update field yang dikirim
    next_state.update(
        normalized
    )

    # Database menggunakan UTC
    now = datetime.now(
        timezone.utc
    )

    now_iso = now.isoformat()

    # ========================================================
    # SIMPAN CURRENT STATE
    # ========================================================

    (
        supabase
        .table("andon_current_state")
        .upsert(
            {
                **next_state,
                "last_update": now_iso,
            },
            on_conflict="station_id"
        )
        .execute()
    )

    # ========================================================
    # HISTORY + TELEGRAM
    # ========================================================

    for field, new_value in normalized.items():

        old_value = int(
            old.get(
                field,
                0
            ) or 0
        )

        new_value = int(
            new_value
        )

        # Tidak ada perubahan
        if old_value == new_value:
            continue

        problem_type = (
            _problem_type_from_field(
                field
            )
        )

        # ====================================================
        # CARI HISTORY AKTIF
        # ====================================================

        active_result = (
            supabase
            .table("status_history")
            .select(
                "id,start_time"
            )
            .eq(
                "station_id",
                station_id
            )
            .eq(
                "problem_type",
                problem_type
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

        active = (
            active_result.data[0]
            if active_result.data
            else None
        )

        # ====================================================
        # 0 -> 1
        # MASALAH AKTIF
        # ====================================================

        if (
            new_value == 1
            and old_value == 0
        ):

            (
                supabase
                .table("status_history")
                .insert(
                    {
                        "station_id": station_id,

                        "problem_type":
                            problem_type,

                        "start_time":
                            now_iso,

                        "end_time":
                            None,

                        "duration_seconds":
                            None,
                    }
                )
                .execute()
            )

            print(
                f"[HISTORY START] "
                f"Station {station_id} - "
                f"{problem_type}"
            )

            # =================================================
            # JAM MULAI WIB
            # =================================================

            start_time_display = datetime.now(
                ZoneInfo("Asia/Jakarta")
            ).strftime(
                "%H:%M:%S"
            )

            # =================================================
            # TELEGRAM ALERT
            # =================================================

            send_telegram_message(
                f"🚨 ANDON ALERT\n"
                f"Station: {station_id}\n"
                f"Problem: {problem_type}\n"
                f"Status: AKTIF\n"
                f"Jam Mulai: "
                f"{start_time_display} WIB"
            )

        # ====================================================
        # 1 -> 0
        # MASALAH SELESAI
        # ====================================================

        elif (
            new_value == 0
            and old_value == 1
            and active
        ):

            start_time = (
                active.get(
                    "start_time"
                )
            )

            duration_seconds = None

            if start_time:

                try:

                    started = (
                        datetime
                        .fromisoformat(
                            start_time.replace(
                                "Z",
                                "+00:00"
                            )
                        )
                    )

                    duration_seconds = max(
                        0,
                        int(
                            (
                                now - started
                            ).total_seconds()
                        )
                    )

                except (
                    ValueError,
                    TypeError
                ):

                    duration_seconds = None

            # =================================================
            # UPDATE HISTORY
            # =================================================

            (
                supabase
                .table("status_history")
                .update(
                    {
                        "end_time":
                            now_iso,

                        "duration_seconds":
                            duration_seconds,
                    }
                )
                .eq(
                    "id",
                    active["id"]
                )
                .execute()
            )

            print(
                f"[HISTORY END] "
                f"Station {station_id} - "
                f"{problem_type} - "
                f"{duration_seconds}s"
            )

            # =================================================
            # FORMAT DURASI
            # =================================================

            duration_text = "N/A"

            if (
                duration_seconds
                is not None
            ):

                minutes = (
                    duration_seconds
                    // 60
                )

                seconds = (
                    duration_seconds
                    % 60
                )

                duration_text = (
                    f"{minutes:02d}:"
                    f"{seconds:02d}"
                )

            # =================================================
            # JAM SELESAI WIB
            # =================================================

            finish_time = datetime.now(
                ZoneInfo("Asia/Jakarta")
            ).strftime(
                "%H:%M:%S"
            )

            # =================================================
            # TELEGRAM RECOVERY
            # =================================================

            send_telegram_message(
                f"✅ ANDON RECOVERY\n"
                f"Station: {station_id}\n"
                f"Problem: {problem_type}\n"
                f"Status: SELESAI\n"
                f"Jam Selesai: "
                f"{finish_time} WIB\n"
                f"Durasi: {duration_text}"
            )

    # ========================================================
    # LOG STATE
    # ========================================================

    print(
        f"Station {station_id} updated:",
        next_state
    )


# ============================================================
# MQTT CONNECT
# ============================================================

def on_connect(
    client,
    userdata,
    flags,
    reason_code,
    properties
):

    print(
        "MQTT connected:",
        reason_code
    )

    if reason_code == 0:

        topic = (
            f"{MQTT_TOPIC_PREFIX}/#"
        )

        client.subscribe(
            topic
        )

        print(
            "Subscribed:",
            topic
        )

    else:

        print(
            "MQTT connection failed:",
            reason_code
        )


# ============================================================
# MQTT MESSAGE
# ============================================================

def on_message(
    client,
    userdata,
    msg
):

    try:

        payload = (
            msg.payload
            .decode("utf-8")
        )

        print(
            f"MQTT [{msg.topic}]: "
            f"{payload}"
        )

        data = json.loads(
            payload
        )

        # ====================================================
        # STATION ID
        # ====================================================

        station_id = (
            data.get("station")
        )

        if station_id is None:

            print(
                "Payload tidak "
                "memiliki station"
            )

            return

        # ====================================================
        # AMBIL FIELD STATUS
        # ====================================================

        changes = {}

        for field in (
            "machine",
            "quality",
            "material"
        ):

            if field in data:

                changes[field] = (
                    data[field]
                )

        # ====================================================
        # VALIDASI
        # ====================================================

        if not changes:

            print(
                "Payload tidak memiliki "
                "field "
                "machine/quality/material"
            )

            return

        # ====================================================
        # UPDATE STATION
        # ====================================================

        update_station(
            int(station_id),
            changes
        )

    except Exception as exc:

        print(
            "MQTT ERROR:",
            exc
        )


# ============================================================
# MQTT CLIENT
# ============================================================

client = mqtt.Client(
    mqtt.CallbackAPIVersion.VERSION2
)

client.username_pw_set(
    MQTT_USERNAME,
    MQTT_PASSWORD
)

client.on_connect = on_connect
client.on_message = on_message


# ============================================================
# START MQTT
# ============================================================

print(
    f"Connecting MQTT "
    f"{MQTT_HOST}:{MQTT_PORT}"
)

client.connect(
    MQTT_HOST,
    MQTT_PORT,
    60
)

client.loop_forever()