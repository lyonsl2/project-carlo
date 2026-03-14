import type { Database, SqlValue } from "sql.js";
import { getDb } from "./db";
import type {
  ChurchDetail,
  ChurchMapItem,
  EventSummary,
  EventType,
} from "./types";

const ALL_TYPES: EventType[] = ["mass", "confession", "adoration"];

const DAY_TO_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

interface RawEvent {
  id: number;
  church_id: number;
  event_type: EventType;
  event_kind: "weekly" | "specific_date";
  day_of_week: string | null;
  date: string | null;
  start_time: string;
  end_time: string | null;
  cancelled: boolean;
  occurrence: string | null;
}

function parseTime(value: string): { hours: number; minutes: number } | null {
  const raw = value.trim();
  const patterns: [RegExp, (m: RegExpMatchArray) => { hours: number; minutes: number }][] = [
    // 12:30 PM / 12:30PM
    [/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i, (m) => {
      let h = parseInt(m[1]);
      const min = parseInt(m[2]);
      const ampm = m[3].toUpperCase();
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return { hours: h, minutes: min };
    }],
    // 8 AM / 8AM
    [/^(\d{1,2})\s*(AM|PM)$/i, (m) => {
      let h = parseInt(m[1]);
      const ampm = m[2].toUpperCase();
      if (ampm === "PM" && h !== 12) h += 12;
      if (ampm === "AM" && h === 12) h = 0;
      return { hours: h, minutes: 0 };
    }],
    // 14:30
    [/^(\d{1,2}):(\d{2})$/, (m) => ({
      hours: parseInt(m[1]),
      minutes: parseInt(m[2]),
    })],
    // 1430
    [/^(\d{2})(\d{2})$/, (m) => ({
      hours: parseInt(m[1]),
      minutes: parseInt(m[2]),
    })],
  ];
  for (const [re, extract] of patterns) {
    const match = raw.match(re);
    if (match) return extract(match);
  }
  return null;
}

function todayDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function nextForWeekly(
  dayOfWeek: string,
  startTime: string,
  today: Date,
): Date | null {
  const dayIdx = DAY_TO_INDEX[dayOfWeek.toLowerCase()];
  if (dayIdx === undefined) return null;
  const parsed = parseTime(startTime);
  if (!parsed) return null;
  const jsDay = (dayIdx + 1) % 7; // Python: Monday=0; JS: Sunday=0
  const currentDay = today.getDay();
  const daysAhead = (jsDay - currentDay + 7) % 7;
  const target = new Date(today);
  target.setDate(target.getDate() + daysAhead);
  target.setHours(parsed.hours, parsed.minutes, 0, 0);
  return target;
}

function nextForSpecific(eventDate: string, startTime: string): Date | null {
  const parsed = parseTime(startTime);
  if (!parsed) return null;
  const parts = eventDate.split("-");
  if (parts.length !== 3) return null;
  const d = new Date(
    parseInt(parts[0]),
    parseInt(parts[1]) - 1,
    parseInt(parts[2]),
    parsed.hours,
    parsed.minutes,
  );
  if (isNaN(d.getTime())) return null;
  return d;
}

function computeOccurrence(event: {
  cancelled: boolean;
  event_kind: string;
  day_of_week: string | null;
  start_time: string;
  date: string | null;
}): string | null {
  if (event.cancelled) return null;
  const today = todayDate();
  let occ: Date | null = null;
  if (event.event_kind === "weekly" && event.day_of_week) {
    occ = nextForWeekly(event.day_of_week, event.start_time, today);
  } else if (event.event_kind === "specific_date" && event.date) {
    occ = nextForSpecific(event.date, event.start_time);
  }
  return occ ? occ.toISOString() : null;
}

function str(v: SqlValue): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: SqlValue): number | null {
  return typeof v === "number" ? v : null;
}

function queryEvents(
  db: Database,
  churchIds: number[],
  types: EventType[],
): RawEvent[] {
  if (churchIds.length === 0) return [];
  const effectiveTypes = types.length === 0 ? ALL_TYPES : types;
  const churchPh = churchIds.map(() => "?").join(",");
  const typePh = effectiveTypes.map(() => "?").join(",");
  const stmt = db.prepare(
    `SELECT id, church_id, event_type, event_kind,
            day_of_week, date, start_time, end_time, cancelled
     FROM event
     WHERE church_id IN (${churchPh})
       AND event_type IN (${typePh})`,
  );
  try {
    stmt.bind([...churchIds, ...effectiveTypes]);

    const results: RawEvent[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const ev: RawEvent = {
        id: row["id"] as number,
        church_id: row["church_id"] as number,
        event_type: row["event_type"] as EventType,
        event_kind: row["event_kind"] as "weekly" | "specific_date",
        day_of_week: str(row["day_of_week"]),
        date: str(row["date"]),
        start_time: row["start_time"] as string,
        end_time: str(row["end_time"]),
        cancelled: Boolean(row["cancelled"]),
        occurrence: null,
      };
      ev.occurrence = computeOccurrence(ev);
      results.push(ev);
    }
    return results;
  } finally {
    stmt.free();
  }
}

function toEventSummary(ev: RawEvent): EventSummary {
  return {
    id: ev.id,
    type: ev.event_type,
    kind: ev.event_kind,
    day_of_week: ev.day_of_week,
    date: ev.date,
    start_time: ev.start_time,
    end_time: ev.end_time,
    cancelled: ev.cancelled,
    next_occurrence: ev.occurrence,
  };
}

export async function fetchChurches(
  types: EventType[],
): Promise<ChurchMapItem[]> {
  const db = await getDb();

  const stmt = db.prepare(
    `SELECT id, parish_id, slug, name, address_line1, address_line2, city, state, postal_code,
            latitude, longitude FROM church ORDER BY name`,
  );
  const churches: ChurchDetail[] = [];
  try {
    while (stmt.step()) {
      const row = stmt.getAsObject();
      churches.push({
        id: row["id"] as number,
        parish_id: row["parish_id"] as number,
        slug: row["slug"] as string,
        name: str(row["name"]),
        address_line1: str(row["address_line1"]),
        address_line2: str(row["address_line2"]),
        city: str(row["city"]),
        state: str(row["state"]),
        postal_code: str(row["postal_code"]),
        latitude: num(row["latitude"]),
        longitude: num(row["longitude"]),
      });
    }
  } finally {
    stmt.free();
  }

  const churchIds = churches.map((c) => c.id);
  const events = queryEvents(db, churchIds, types);

  const grouped = new Map<number, RawEvent[]>();
  for (const ev of events) {
    let list = grouped.get(ev.church_id);
    if (!list) {
      list = [];
      grouped.set(ev.church_id, list);
    }
    list.push(ev);
  }

  const UPCOMING_LIMIT = 3;
  return churches.map((c) => {
    const churchEvents = grouped.get(c.id) ?? [];
    const upcomingSorted = churchEvents
      .filter((e) => e.occurrence !== null)
      .sort((a, b) => a.occurrence!.localeCompare(b.occurrence!))
      .slice(0, UPCOMING_LIMIT);
    const eventTypes = [
      ...new Set(churchEvents.map((e) => e.event_type)),
    ].sort() as EventType[];
    return {
      ...c,
      event_types: eventTypes,
      upcoming_events: upcomingSorted.map(toEventSummary),
    };
  });
}

export async function fetchChurch(slug: string): Promise<ChurchDetail> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT id, parish_id, slug, name, address_line1, address_line2, city, state, postal_code,
            latitude, longitude FROM church WHERE slug = ?`,
  );
  try {
    stmt.bind([slug]);
    if (!stmt.step()) {
      throw new Error("Church not found");
    }
    const row = stmt.getAsObject();
    return {
      id: row["id"] as number,
      parish_id: row["parish_id"] as number,
      slug: row["slug"] as string,
      name: str(row["name"]),
      address_line1: str(row["address_line1"]),
      address_line2: str(row["address_line2"]),
      city: str(row["city"]),
      state: str(row["state"]),
      postal_code: str(row["postal_code"]),
      latitude: num(row["latitude"]),
      longitude: num(row["longitude"]),
    };
  } finally {
    stmt.free();
  }
}

export async function fetchChurchEvents(
  slug: string,
  types: EventType[],
): Promise<EventSummary[]> {
  const db = await getDb();

  const idResult = db.exec("SELECT id FROM church WHERE slug = ?", [slug]);
  if (idResult.length === 0 || idResult[0].values.length === 0) {
    throw new Error("Church not found");
  }
  const churchId = idResult[0].values[0][0] as number;

  const events = queryEvents(db, [churchId], types);
  return events
    .filter((e) => e.occurrence !== null)
    .sort((a, b) => a.occurrence!.localeCompare(b.occurrence!))
    .map(toEventSummary);
}
