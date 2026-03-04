from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from apps.api.main import app


def _seed_db(db_path: Path) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            CREATE TABLE church (
                id INTEGER PRIMARY KEY,
                parish_id INTEGER NOT NULL,
                name TEXT,
                address TEXT,
                name_normalized TEXT,
                created_at TEXT NOT NULL,
                latitude REAL,
                longitude REAL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE event (
                id INTEGER PRIMARY KEY,
                church_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                event_kind TEXT NOT NULL,
                day_of_week TEXT,
                date TEXT,
                start_time TEXT NOT NULL,
                end_time TEXT,
                cancelled INTEGER NOT NULL,
                raw_json TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT INTO church(id, parish_id, name, address, name_normalized, created_at, latitude, longitude)
            VALUES (1, 1, 'Test Church', '123 Main St', 'test church', '2026-01-01T00:00:00Z', 43.1, -77.5)
            """
        )
        conn.execute(
            """
            INSERT INTO event(
                id, church_id, event_type, event_kind, day_of_week, date, start_time, end_time, cancelled, raw_json
            )
            VALUES
                (1, 1, 'mass', 'weekly', 'Sunday', NULL, '9:00 AM', NULL, 0, '{}'),
                (2, 1, 'confession', 'specific_date', NULL, '2099-01-01', '3:00 PM', '4:00 PM', 0, '{}')
            """
        )
        conn.commit()
    finally:
        conn.close()


def test_api_endpoints(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "api_test.db"
    _seed_db(db_path)

    def connect_override():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn

    monkeypatch.setattr("apps.api.main._connect_db", connect_override)
    client = TestClient(app)

    health_resp = client.get("/health")
    assert health_resp.status_code == 200
    assert health_resp.json() == {"status": "ok"}

    churches_resp = client.get("/churches?types=mass,confession")
    assert churches_resp.status_code == 200
    churches = churches_resp.json()
    assert len(churches) == 1
    assert churches[0]["name"] == "Test Church"
    assert "mass" in churches[0]["event_types"]

    church_resp = client.get("/churches/1")
    assert church_resp.status_code == 200
    assert church_resp.json()["id"] == 1

    events_resp = client.get("/churches/1/events?types=mass")
    assert events_resp.status_code == 200
    events = events_resp.json()
    assert events
    assert all(event["type"] == "mass" for event in events)
