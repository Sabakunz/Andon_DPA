import os
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
import paho.mqtt.client as mqtt
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.148.195")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_USERNAME = os.getenv("MQTT_USERNAME", "andon_gateway")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", "")
MQTT_TOPIC_PREFIX = os.getenv(
    "MQTT_TOPIC_PREFIX",
    "andon-system-demo"
)

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)


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
        raise ValueError(f"Nilai state tidak valid: {value}")


def update_station(station_id, changes):
    allowed = {
        "machine",
        "quality",
        "material"
    }

    changes = {
        key: value
        for key, value in changes.items()
        if key in allowed
    }

    normalized = {
        key: _normalize_state_value(value)
        for key, value in changes.items()
    }

    result = (
        supabase
        .table("andon_current_state")
        .select(
            "station_id,machine,quality,material,last_update"
        )
        .eq("station_id", station_id)
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

    next_state = {
        "station_id": station_id,
        "machine": int(old.get("machine", 0) or 0),
        "quality": int(old.get("quality", 0) or 0),
        "material": int(old.get("material", 0) or 0),
    }

    next_state.update(normalized)

    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    supabase.table(
        "andon_current_state"
    ).upsert(
        {
            **next_state,
            "last_update": now_iso,
        },
        on_conflict="station_id"
    ).execute()

    for field, new_value in normalized.items():

        old_value = int(old.get(field, 0) or 0)
        new_value = int(new_value)

        if old_value == new_value:
            continue

        problem_type = _problem_type_from_field(field)

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

        if new_value == 1 and old_value == 0:

            supabase.table(
                "status_history"
            ).insert(
                {
                    "station_id": station_id,
                    "problem_type": problem_type,
                    "start_time": now_iso,
                    "end_time": None,
                    "duration_seconds": None,
                }
            ).execute()

            print(
                f"[HISTORY START] "
                f"Station {station_id} - {problem_type}"
            )

        elif new_value == 0 and old_value == 1 and active:

            start_time = active.get("start_time")
            duration_seconds = None

            if start_time:
                try:
                    started = datetime.fromisoformat(
                        start_time.replace("Z", "+00:00")
                    )

                    duration_seconds = max(
                        0,
                        int((now - started).total_seconds())
                    )

                except (ValueError, TypeError):
                    duration_seconds = None

            supabase.table(
                "status_history"
            ).update(
                {
                    "end_time": now_iso,
                    "duration_seconds": duration_seconds,
                }
            ).eq(
                "id",
                active["id"]
            ).execute()

            print(
                f"[HISTORY END] "
                f"Station {station_id} - "
                f"{problem_type} - "
                f"{duration_seconds}s"
            )

    print(
        f"Station {station_id} updated:",
        next_state
    )


def on_connect(client, userdata, flags, reason_code, properties):
    print("MQTT connected:", reason_code)

    topic = f"{MQTT_TOPIC_PREFIX}/#"

    client.subscribe(topic)

    print("Subscribed:", topic)


def on_message(client, userdata, msg):
    try:
        payload = msg.payload.decode("utf-8")

        print(
            f"MQTT [{msg.topic}]: {payload}"
        )

        data = json.loads(payload)

        station_id = data.get("station")

        if station_id is None:
            print("Payload tidak memiliki station")
            return

        changes = {}

        for field in (
            "machine",
            "quality",
            "material"
        ):
            if field in data:
                changes[field] = data[field]

        update_station(
            int(station_id),
            changes
        )

    except Exception as exc:
        print("MQTT ERROR:", exc)


client = mqtt.Client(
    mqtt.CallbackAPIVersion.VERSION2
)

client.username_pw_set(
    MQTT_USERNAME,
    MQTT_PASSWORD
)

client.on_connect = on_connect
client.on_message = on_message

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