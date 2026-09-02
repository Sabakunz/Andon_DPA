PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS departments;

CREATE TABLE departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster TEXT NOT NULL,
    department TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('Berjalan Normal','Machine Problem','Material Problem','Quality Problem')),
    priority TEXT NOT NULL CHECK(priority IN ('Normal','Medium','High')),
    due_date TEXT NOT NULL,
    issue TEXT,
    target_output INTEGER DEFAULT 0,
    operator TEXT,
    last_update TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    floor INTEGER NOT NULL DEFAULT 1
);


CREATE TABLE IF NOT EXISTS andon_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    problem_type TEXT NOT NULL CHECK(problem_type IN ('Machine','Material','Quality')),
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration_seconds INTEGER,
    FOREIGN KEY (department_id) REFERENCES departments(id)
);

CREATE INDEX IF NOT EXISTS idx_andon_events_department ON andon_events(department_id);
CREATE INDEX IF NOT EXISTS idx_andon_events_start ON andon_events(start_time);
