import os
import json
from datetime import datetime, timezone
from dotenv import load_dotenv
import paho.mqtt.client as mqtt
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

MQTT_HOST = os.getenv("MQTT_HOST", "192.168.148.140")
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


def update_station(station_id, changes):
    allowed = {
        "machine",
        "quality",
        "material"
    }

    changes = {
        key: int(value)
        for key, value in changes.items()
        if key in allowed
    }

    # Ambil status terakhir
    result = (
        supabase
        .table("andon_current_state")
        .select("*")
        .eq("station_id", station_id)
        .limit(1)
        .execute()
    )

    if result.data:
        current = result.data[0]
    else:
        current = {
            "machine": 0,
            "quality": 0,
            "material": 0
        }

    # Field yang tidak dikirim tetap menggunakan status sebelumnya
    state = {
        "station_id": station_id,
        "machine": changes.get(
            "machine",
            current.get("machine", 0)
        ),
        "quality": changes.get(
            "quality",
            current.get("quality", 0)
        ),
        "material": changes.get(
            "material",
            current.get("material", 0)
        ),
        "last_update": datetime.now(timezone.utc).isoformat()
    }

    supabase.table(
        "andon_current_state"
    ).upsert(
        state,
        on_conflict="station_id"
    ).execute()

    print(
        f"Station {station_id} updated:",
        state
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