from flask import Flask, render_template, jsonify, request, redirect, url_for, session
import sqlite3
from pathlib import Path
import threading
import time
import os
import hmac

try:
    import serial
except ImportError:
    serial = None

BASE = Path(__file__).resolve().parent
# Railway: set DATABASE_PATH to a mounted persistent volume path such as
# /app/data/andon.db. Locally it falls back to data/andon.db.
DB = Path(os.getenv("DATABASE_PATH", str(BASE / "data" / "andon.db"))).expanduser()
DB.parent.mkdir(parents=True, exist_ok=True)

# ============================================================
# LORA GATEWAY SERIAL SETTINGS
# ============================================================
# Windows contoh: COM5 | Linux: /dev/ttyUSB0 | Raspberry Pi: /dev/ttyUSB0
def env_bool(name, default=False):
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


LORA_ENABLED = env_bool("LORA_ENABLED", False)
SERIAL_PORT = os.getenv("SERIAL_PORT", "COM5")
SERIAL_BAUD = int(os.getenv("SERIAL_BAUD", "115200"))

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "andon-dashboard-change-this-secret")
LOGIN_USERNAME = os.getenv("LOGIN_USERNAME", "admin")
LOGIN_PASSWORD = os.getenv("LOGIN_PASSWORD", "andon123")
serial_conn = None
serial_lock = threading.Lock()
serial_status = "Gateway belum terhubung"


def is_logged_in():
    return bool(session.get("logged_in"))


@app.before_request
def require_login():
    if request.endpoint in {"login", "health", "static"}:
        return None
    if is_logged_in():
        return None
    if request.path.startswith("/api/"):
        return jsonify({"error": "Login diperlukan"}), 401
    return redirect(url_for("login"))


def get_db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn


def init_history_table():
    conn = get_db()

    columns = [row["name"] for row in conn.execute("PRAGMA table_info(departments)").fetchall()]
    if "floor" not in columns:
        conn.execute("ALTER TABLE departments ADD COLUMN floor INTEGER NOT NULL DEFAULT 1")
    if "position_left" not in columns:
        conn.execute("ALTER TABLE departments ADD COLUMN position_left REAL")
    if "position_top" not in columns:
        conn.execute("ALTER TABLE departments ADD COLUMN position_top REAL")
    if "is_active" not in columns:
        conn.execute("ALTER TABLE departments ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")

    # Posisi default marker untuk line lama yang belum punya koordinat.
    # Nilai disimpan sebagai persentase agar tetap mengikuti ukuran denah.
    default_positions = {
        "Sleeve": (56.5, 60), "Coller Guide": (50, 60), "Valve KOJ": (45.5, 60),
        "3TF & 22MY": (50.5, 72), "Pipe Section": (46, 72), "Cap Header": (54, 81.5),
        "Tube Evaporator": (49, 81.5), "Tank Header": (45.3, 81.5),
        "Seat Valve HKZR & Boss Drive Face K2SA": (41.5, 74),
        "Pivot Camchain, Shaft In & Exh, Bus M Stand": (42, 60), "Rod HKZR": (39, 64.5),
        "Cutting": (37.5, 74), "Rod HKOJ": (37.5, 46), "Nut Hex Cap": (37.5, 35),
        "Cutting Size": (37.5, 29.5), "NC": (52, 52), "F Yoke 5D9": (64, 71),
        "Final Check": (61, 84),
    }
    for department_name, (left, top) in default_positions.items():
        conn.execute(
            "UPDATE departments SET position_left=?, position_top=? "
            "WHERE department=? AND (position_left IS NULL OR position_top IS NULL)",
            (left, top, department_name),
        )

    conn.execute("""
        CREATE TABLE IF NOT EXISTS andon_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            department_id INTEGER NOT NULL,
            problem_type TEXT NOT NULL CHECK(problem_type IN ('Machine','Material','Quality')),
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_seconds INTEGER,
            FOREIGN KEY (department_id) REFERENCES departments(id)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_andon_events_department ON andon_events(department_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_andon_events_start ON andon_events(start_time)")

    # Normalisasi nama line lantai 1 agar tanpa kata 'Line'.
    floor1_renames = {
        'Line Sleeve': 'Sleeve',
        'Line Coller Guide': 'Coller Guide',
        'Line Valve KOJ': 'Valve KOJ',
        'Line 3TF & 22MY': '3TF & 22MY',
        'Line Cap Header': 'Cap Header',
    }
    for old_name, new_name in floor1_renames.items():
        conn.execute(
            "UPDATE departments SET department=? WHERE department=? AND floor=1",
            (new_name, old_name),
        )

    # Lantai 2: Cluster E hanya NC. Cluster F hanya F Yoke 5D9.
    # Final Check berdiri sendiri.
    floor2 = [
        ("E", "NC"),
        ("F", "F Yoke 5D9"),
        ("Final Check", "Final Check"),
    ]
    for cluster, department in floor2:
        exists = conn.execute(
            "SELECT id FROM departments WHERE department=?", (department,)
        ).fetchone()
        if exists:
            conn.execute(
                "UPDATE departments SET cluster=?, floor=2 WHERE department=?",
                (cluster, department),
            )
        else:
            conn.execute("""
                INSERT INTO departments
                (cluster, department, status, priority, due_date, issue, target_output, operator, floor, position_left, position_top)
                VALUES (?, ?, 'Berjalan Normal', 'Normal', date('now','localtime'), NULL, 0, NULL, 2, NULL, NULL)
            """, (cluster, department))

    conn.commit()
    conn.close()

def _problem_type_from_status(status):
    return {
        "Machine Problem": "Machine",
        "Material Problem": "Material",
        "Quality Problem": "Quality",
    }.get(status)


def set_department_status(department_id, status, priority=None, issue=None, operator=None):
    conn = get_db()

    current = conn.execute(
        "SELECT status FROM departments WHERE id=?", (department_id,)
    ).fetchone()
    if current is None:
        conn.close()
        return False

    old_status = current["status"]
    updates = {"status": status}
    if priority is not None:
        updates["priority"] = priority
    if issue is not None:
        updates["issue"] = issue
    if operator is not None:
        updates["operator"] = operator

    sets = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [department_id]
    cur = conn.execute(
        f"UPDATE departments SET {sets}, last_update=datetime('now','localtime') WHERE id=?",
        values,
    )

    # Catat histori Andon hanya ketika status benar-benar berubah.
    old_problem = _problem_type_from_status(old_status)
    new_problem = _problem_type_from_status(status)
    now = conn.execute("SELECT datetime('now','localtime')").fetchone()[0]

    if old_problem != new_problem:
        # Tutup event masalah yang masih aktif (jika ada).
        active = conn.execute(
            "SELECT id, start_time FROM andon_events "
            "WHERE department_id=? AND end_time IS NULL "
            "ORDER BY id DESC LIMIT 1",
            (department_id,),
        ).fetchone()
        if active:
            duration = conn.execute(
                "SELECT CAST((julianday(?) - julianday(?)) * 86400 AS INTEGER)",
                (now, active["start_time"]),
            ).fetchone()[0] or 0
            conn.execute(
                "UPDATE andon_events SET end_time=?, duration_seconds=? WHERE id=?",
                (now, duration, active["id"]),
            )

        # Jika status baru adalah masalah, buka event baru.
        if new_problem:
            conn.execute(
                "INSERT INTO andon_events "
                "(department_id, problem_type, start_time) VALUES (?, ?, ?)",
                (department_id, new_problem, now),
            )

    conn.commit()
    conn.close()
    return cur.rowcount > 0


def send_lora_command(department_id, command):
    """Kirim command dari Flask -> USB serial -> LoRa gateway -> node."""
    if not LORA_ENABLED:
        return False, "Mode demo - LoRa belum diaktifkan"
    if serial_conn is None or not serial_conn.is_open:
        return False, "Gateway LoRa tidak terhubung"

    line = f"CMD|{department_id}|{command}\n"
    try:
        with serial_lock:
            serial_conn.write(line.encode("utf-8"))
            serial_conn.flush()
        return True, "OK"
    except Exception as exc:
        return False, str(exc)


def process_gateway_line(line):
    """Format yang diterima dari gateway: RX|NODE01|1|ANDON"""
    global serial_status
    line = line.strip()
    if not line:
        return

    print("<--", line)

    parts = line.split("|")
    if len(parts) < 4 or parts[0] != "RX":
        return

    _, node_id, department_id, command = parts[:4]
    try:
        department_id = int(department_id)
    except ValueError:
        return

    command = command.upper()

    if command == "MACHINE":
        ok = set_department_status(department_id, "Machine Problem")
    elif command == "MATERIAL":
        ok = set_department_status(department_id, "Material Problem")
    elif command == "QUALITY":
        ok = set_department_status(department_id, "Quality Problem")
    elif command == "RESET":
        ok = set_department_status(department_id, "Berjalan Normal")
    else:
        ok = False

    serial_status = f"Gateway OK | {node_id} | {command} | DB={'OK' if ok else 'ID tidak ditemukan'}"


def serial_reader():
    global serial_conn, serial_status

    if serial is None:
        serial_status = "pyserial belum terpasang"
        return

    while True:
        try:
            if serial_conn is None or not serial_conn.is_open:
                serial_status = f"Mencoba konek {SERIAL_PORT}..."
                serial_conn = serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=1)
                time.sleep(2)
                serial_status = f"Gateway terhubung: {SERIAL_PORT}"
                print(serial_status)

            raw = serial_conn.readline()
            if raw:
                process_gateway_line(raw.decode("utf-8", errors="ignore"))
        except Exception as exc:
            serial_status = f"Gateway error: {exc}"
            print(serial_status)
            try:
                if serial_conn:
                    serial_conn.close()
            except Exception:
                pass
            serial_conn = None
            time.sleep(3)


init_history_table()


@app.get("/health")
def health():
    """Lightweight health check for Railway."""
    try:
        conn = get_db()
        conn.execute("SELECT 1").fetchone()
        conn.close()
        return jsonify({"status": "ok"})
    except Exception as exc:
        return jsonify({"status": "error", "error": str(exc)}), 500


@app.route("/login", methods=["GET", "POST"])
def login():
    if is_logged_in():
        return redirect(url_for("index"))
    error = None
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if hmac.compare_digest(username, LOGIN_USERNAME) and hmac.compare_digest(password, LOGIN_PASSWORD):
            session.clear()
            session["logged_in"] = True
            session["username"] = username
            session.permanent = True
            return redirect(url_for("index"))
        error = "Username atau password salah."
    return render_template("login.html", error=error)


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
def index():
    return render_template("index.html", mode="dashboard")

@app.route("/settings")
def settings():
    return render_template("index.html", mode="settings")


@app.get("/api/departments")
def departments():
    include_inactive = request.args.get("include_inactive", "0") == "1"
    conn = get_db()
    where = "" if include_inactive else "WHERE is_active=1"
    rows = conn.execute(f"""
        SELECT id, cluster, department, status, priority, due_date,
               issue, target_output, operator, last_update, floor, position_left, position_top, is_active
        FROM departments
        {where}
        ORDER BY cluster, id
    """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.get("/api/history")
def history():
    floor = request.args.get("floor", type=int)
    conn = get_db()
    if floor in (1, 2):
        rows = conn.execute("""
            SELECT e.id, d.cluster, d.department, d.floor, e.problem_type,
                   e.start_time, e.end_time, e.duration_seconds
            FROM andon_events e
            JOIN departments d ON d.id = e.department_id
            WHERE d.floor=?
            ORDER BY e.id DESC
            LIMIT 100
        """, (floor,)).fetchall()
    else:
        rows = conn.execute("""
            SELECT e.id, d.cluster, d.department, d.floor, e.problem_type,
                   e.start_time, e.end_time, e.duration_seconds
            FROM andon_events e
            JOIN departments d ON d.id = e.department_id
            ORDER BY e.id DESC
            LIMIT 100
        """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.get("/api/lora/status")
def lora_status():
    return jsonify({"connected": serial_conn is not None and serial_conn.is_open, "status": serial_status})


@app.post("/api/lora/command/<int:department_id>")
def lora_command(department_id):
    payload = request.get_json(silent=True) or {}
    command = str(payload.get("command", "")).upper()
    allowed = {"MACHINE", "MATERIAL", "QUALITY", "RESET"}
    if command not in allowed:
        return jsonify({"error": "Command harus MACHINE, MATERIAL, QUALITY, atau RESET"}), 400

    # Update DB langsung agar dashboard responsif; lalu kirim command ke node.
    if command == "MACHINE":
        set_department_status(department_id, "Machine Problem")
    elif command == "MATERIAL":
        set_department_status(department_id, "Material Problem")
    elif command == "QUALITY":
        set_department_status(department_id, "Quality Problem")
    else:
        set_department_status(department_id, "Berjalan Normal")

    sent, message = send_lora_command(department_id, command)
    return jsonify({"ok": True, "sent_to_lora": sent, "message": message})


@app.post("/api/departments")
def create_department():
    payload = request.get_json(silent=True) or {}
    cluster = str(payload.get("cluster", "")).strip()
    department = str(payload.get("department", "")).strip()
    floor = payload.get("floor", 1)
    position_left = payload.get("position_left")
    position_top = payload.get("position_top")

    if not cluster or not department:
        return jsonify({"error": "Cluster dan nama line wajib diisi"}), 400
    try:
        floor = int(floor)
        if floor not in (1, 2):
            raise ValueError
        position_left = float(position_left) if position_left is not None else 50.0
        position_top = float(position_top) if position_top is not None else 50.0
        if not (0 <= position_left <= 100 and 0 <= position_top <= 100):
            raise ValueError
    except (TypeError, ValueError):
        return jsonify({"error": "Lantai harus 1/2 dan posisi X/Y harus 0-100%"}), 400

    conn = get_db()
    try:
        cur = conn.execute("""
            INSERT INTO departments
            (cluster, department, status, priority, due_date, issue, target_output, operator, floor, position_left, position_top, is_active)
            VALUES (?, ?, 'Berjalan Normal', 'Normal', date('now','localtime'), NULL, 0, NULL, ?, ?, ?, 1)
        """, (cluster, department, floor, position_left, position_top))
        conn.commit()
        row = conn.execute("""
            SELECT id, cluster, department, status, priority, due_date, issue,
                   target_output, operator, last_update, floor, position_left, position_top, is_active
            FROM departments WHERE id=?
        """, (cur.lastrowid,)).fetchone()
    except sqlite3.IntegrityError:
        conn.rollback()
        conn.close()
        return jsonify({"error": "Nama line sudah digunakan. Gunakan nama yang berbeda."}), 409
    conn.close()
    return jsonify({"ok": True, "department": dict(row)}), 201


@app.put("/api/departments/<int:department_id>")
def update_department(department_id):
    payload = request.get_json(silent=True) or {}
    allowed = {
        "status", "priority", "due_date", "issue", "target_output", "operator",
        "cluster", "department", "floor", "position_left", "position_top", "is_active"
    }
    updates = {k: payload[k] for k in allowed if k in payload}

    # Validasi field yang dipakai oleh editor Setting.
    if "cluster" in updates:
        updates["cluster"] = str(updates["cluster"]).strip()
        if not updates["cluster"]:
            return jsonify({"error": "Cluster wajib diisi"}), 400
    if "department" in updates:
        updates["department"] = str(updates["department"]).strip()
        if not updates["department"]:
            return jsonify({"error": "Nama line wajib diisi"}), 400
    if "floor" in updates:
        try:
            updates["floor"] = int(updates["floor"])
            if updates["floor"] not in (1, 2):
                raise ValueError
        except (TypeError, ValueError):
            return jsonify({"error": "Lantai harus 1 atau 2"}), 400
    for key in ("position_left", "position_top"):
        if key in updates:
            try:
                updates[key] = float(updates[key])
                if not 0 <= updates[key] <= 100:
                    raise ValueError
            except (TypeError, ValueError):
                return jsonify({"error": "Posisi X/Y harus 0-100%"}), 400
    if "is_active" in updates:
        updates["is_active"] = 1 if bool(updates["is_active"]) else 0

    if not updates:
        return jsonify({"error": "Tidak ada data yang diubah"}), 400

    sets = ", ".join(f"{k}=?" for k in updates)
    values = list(updates.values()) + [department_id]

    conn = get_db()
    try:
        cur = conn.execute(
            f"UPDATE departments SET {sets}, last_update=datetime('now','localtime') WHERE id=?",
            values,
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()
        conn.close()
        return jsonify({"error": "Nama line sudah digunakan. Gunakan nama yang berbeda."}), 409
    conn.close()

    if cur.rowcount == 0:
        return jsonify({"error": "Departemen tidak ditemukan"}), 404
    return jsonify({"ok": True})


@app.delete("/api/departments/<int:department_id>")
def deactivate_department(department_id):
    # Soft delete agar histori Andon lama tetap aman.
    conn = get_db()
    cur = conn.execute(
        "UPDATE departments SET is_active=0, last_update=datetime('now','localtime') WHERE id=?",
        (department_id,),
    )
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        return jsonify({"error": "Departemen tidak ditemukan"}), 404
    return jsonify({"ok": True})


if __name__ == "__main__":
    if LORA_ENABLED and serial is not None:
        threading.Thread(target=serial_reader, daemon=True).start()

    port = int(os.getenv("PORT", "5000"))
    debug = env_bool("FLASK_DEBUG", False)
    app.run(host="0.0.0.0", port=port, debug=debug, use_reloader=False)
