from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DEFAULT_DB_PATH = Path("data/parish_events.db")
EVENT_TYPES = {"mass", "confession", "adoration"}
DAY_TO_INDEX = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


class EventSummary(BaseModel):
    id: int
    type: Literal["mass", "confession", "adoration"]
    kind: Literal["weekly", "specific_date"]
    day_of_week: str | None
    date: str | None
    start_time: str
    end_time: str | None
    cancelled: bool
    next_occurrence: str | None


class ChurchMapItem(BaseModel):
    id: int
    parish_id: int
    name: str | None
    address: str | None
    latitude: float | None
    longitude: float | None
    event_types: list[str]
    upcoming_events: list[EventSummary]


class ChurchDetail(BaseModel):
    id: int
    parish_id: int
    name: str | None
    address: str | None
    latitude: float | None
    longitude: float | None


@dataclass(frozen=True)
class EventWithOccurrence:
    event_id: int
    church_id: int
    event_type: str
    event_kind: str
    day_of_week: str | None
    event_date: str | None
    start_time: str
    end_time: str | None
    cancelled: bool
    occurrence: datetime | None


app = FastAPI(title="Project Carlo API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _connect_db(db_path: Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _parse_types(types: str | None) -> set[str]:
    if not types:
        return set(EVENT_TYPES)
    parts = {p.strip().lower() for p in types.split(",") if p.strip()}
    invalid = parts.difference(EVENT_TYPES)
    if invalid:
        raise HTTPException(status_code=400, detail=f"Unsupported event types: {sorted(invalid)}")
    return parts


def _parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    if bbox is None:
        return None
    try:
        min_lng_str, min_lat_str, max_lng_str, max_lat_str = bbox.split(",")
        min_lng = float(min_lng_str)
        min_lat = float(min_lat_str)
        max_lng = float(max_lng_str)
        max_lat = float(max_lat_str)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail="bbox must be minLng,minLat,maxLng,maxLat"
        ) from exc
    if min_lng > max_lng or min_lat > max_lat:
        raise HTTPException(status_code=400, detail="Invalid bbox bounds")
    return min_lng, min_lat, max_lng, max_lat


def _parse_time(value: str) -> time | None:
    raw = value.strip()
    for fmt in ("%I:%M %p", "%I %p", "%H:%M", "%H%M"):
        try:
            return datetime.strptime(raw, fmt).time()
        except ValueError:
            continue
    return None


def _next_for_weekly(day_of_week: str, start_time: str, today: date) -> datetime | None:
    day_idx = DAY_TO_INDEX.get(day_of_week.lower())
    if day_idx is None:
        return None
    parsed_time = _parse_time(start_time)
    if parsed_time is None:
        return None
    days_ahead = (day_idx - today.weekday()) % 7
    target_date = today + timedelta(days=days_ahead)
    return datetime.combine(target_date, parsed_time)


def _next_for_specific(event_date: str, start_time: str) -> datetime | None:
    parsed_time = _parse_time(start_time)
    if parsed_time is None:
        return None
    try:
        target_date = date.fromisoformat(event_date)
    except ValueError:
        return None
    return datetime.combine(target_date, parsed_time)


def _event_occurrence(row: sqlite3.Row, from_date: date) -> datetime | None:
    if bool(row["cancelled"]):
        return None
    kind = str(row["event_kind"])
    if kind == "weekly":
        day = row["day_of_week"]
        if not isinstance(day, str):
            return None
        return _next_for_weekly(day, str(row["start_time"]), from_date)
    if kind == "specific_date":
        event_date = row["date"]
        if not isinstance(event_date, str):
            return None
        return _next_for_specific(event_date, str(row["start_time"]))
    return None


def _load_church_events(
    conn: sqlite3.Connection,
    *,
    church_ids: list[int],
    event_types: set[str],
    from_date: date,
) -> dict[int, list[EventWithOccurrence]]:
    if not church_ids:
        return {}
    placeholders = ",".join("?" for _ in church_ids)
    type_placeholders = ",".join("?" for _ in event_types)
    rows = conn.execute(
        f"""
        SELECT
            id,
            church_id,
            event_type,
            event_kind,
            day_of_week,
            date,
            start_time,
            end_time,
            cancelled
        FROM event
        WHERE church_id IN ({placeholders})
          AND event_type IN ({type_placeholders})
        """,
        [*church_ids, *sorted(event_types)],
    ).fetchall()

    grouped: dict[int, list[EventWithOccurrence]] = {church_id: [] for church_id in church_ids}
    for row in rows:
        occurrence = _event_occurrence(row, from_date)
        event = EventWithOccurrence(
            event_id=int(row["id"]),
            church_id=int(row["church_id"]),
            event_type=str(row["event_type"]),
            event_kind=str(row["event_kind"]),
            day_of_week=str(row["day_of_week"]) if isinstance(row["day_of_week"], str) else None,
            event_date=str(row["date"]) if isinstance(row["date"], str) else None,
            start_time=str(row["start_time"]),
            end_time=str(row["end_time"]) if isinstance(row["end_time"], str) else None,
            cancelled=bool(row["cancelled"]),
            occurrence=occurrence,
        )
        grouped[int(row["church_id"])].append(event)

    for church_id in grouped:
        grouped[church_id].sort(
            key=lambda e: e.occurrence.isoformat() if e.occurrence is not None else "9999"
        )
    return grouped


def _serialize_event(event: EventWithOccurrence) -> EventSummary:
    return EventSummary(
        id=event.event_id,
        type=event.event_type,  # type: ignore[arg-type]
        kind=event.event_kind,  # type: ignore[arg-type]
        day_of_week=event.day_of_week,
        date=event.event_date,
        start_time=event.start_time,
        end_time=event.end_time,
        cancelled=event.cancelled,
        next_occurrence=event.occurrence.isoformat() if event.occurrence is not None else None,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/churches", response_model=list[ChurchMapItem])
def list_churches(
    types: str | None = Query(default=None),
    bbox: str | None = Query(default=None),
    from_date: date = Query(default_factory=date.today),
    upcoming_limit: int = Query(default=3, ge=1, le=10),
) -> list[ChurchMapItem]:
    event_types = _parse_types(types)
    bounds = _parse_bbox(bbox)
    conn = _connect_db()
    try:
        params: list[object] = []
        where = []
        if bounds is not None:
            min_lng, min_lat, max_lng, max_lat = bounds
            where.append("longitude BETWEEN ? AND ?")
            where.append("latitude BETWEEN ? AND ?")
            params.extend([min_lng, max_lng, min_lat, max_lat])
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""

        church_rows = conn.execute(
            f"""
            SELECT id, parish_id, name, address, latitude, longitude
            FROM church
            {where_sql}
            ORDER BY name
            """,
            params,
        ).fetchall()
        church_ids = [int(r["id"]) for r in church_rows]
        events_by_church = _load_church_events(
            conn, church_ids=church_ids, event_types=event_types, from_date=from_date
        )

        payload: list[ChurchMapItem] = []
        for row in church_rows:
            church_id = int(row["id"])
            events = events_by_church.get(church_id, [])
            filtered_events = [event for event in events if event.occurrence is not None][:upcoming_limit]
            payload.append(
                ChurchMapItem(
                    id=church_id,
                    parish_id=int(row["parish_id"]),
                    name=str(row["name"]) if isinstance(row["name"], str) else None,
                    address=str(row["address"]) if isinstance(row["address"], str) else None,
                    latitude=float(row["latitude"]) if row["latitude"] is not None else None,
                    longitude=float(row["longitude"]) if row["longitude"] is not None else None,
                    event_types=sorted({event.event_type for event in events}),
                    upcoming_events=[_serialize_event(e) for e in filtered_events],
                )
            )
        return payload
    finally:
        conn.close()


@app.get("/churches/{church_id}", response_model=ChurchDetail)
def get_church(church_id: int) -> ChurchDetail:
    conn = _connect_db()
    try:
        row = conn.execute(
            """
            SELECT id, parish_id, name, address, latitude, longitude
            FROM church
            WHERE id = ?
            """,
            (church_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Church not found")
        return ChurchDetail(
            id=int(row["id"]),
            parish_id=int(row["parish_id"]),
            name=str(row["name"]) if isinstance(row["name"], str) else None,
            address=str(row["address"]) if isinstance(row["address"], str) else None,
            latitude=float(row["latitude"]) if row["latitude"] is not None else None,
            longitude=float(row["longitude"]) if row["longitude"] is not None else None,
        )
    finally:
        conn.close()


@app.get("/churches/{church_id}/events", response_model=list[EventSummary])
def get_church_events(
    church_id: int,
    types: str | None = Query(default=None),
    from_date: date = Query(default_factory=date.today),
    to_date: date | None = Query(default=None),
) -> list[EventSummary]:
    event_types = _parse_types(types)
    conn = _connect_db()
    try:
        church_exists = conn.execute("SELECT 1 FROM church WHERE id = ?", (church_id,)).fetchone()
        if church_exists is None:
            raise HTTPException(status_code=404, detail="Church not found")

        events_by_church = _load_church_events(
            conn, church_ids=[church_id], event_types=event_types, from_date=from_date
        )
        events = [event for event in events_by_church.get(church_id, []) if event.occurrence is not None]
        if to_date is not None:
            cutoff = datetime.combine(to_date, time.max)
            events = [event for event in events if event.occurrence is not None and event.occurrence <= cutoff]
        return [_serialize_event(event) for event in events]
    finally:
        conn.close()
