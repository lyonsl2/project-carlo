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

export interface ChurchFilters {
  types: EventType[];
  daysOfWeek?: number[];
  timeFrom?: number;
  timeTo?: number;
}

interface RawEvent {
  id: number;
  church_id: number;
  event_type: EventType;
  event_kind: "weekly" | "specific_date";
  day_of_week: string | null;
  date: string | null;
  start_time: number;
  end_time: number | null;
  cancelled: boolean;
  occurrence: string | null;
  page_number: number | null;
}

function todayDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function nextForWeekly(
  dayOfWeek: string,
  startMinutes: number,
  today: Date,
): Date | null {
  const dayIdx = DAY_TO_INDEX[dayOfWeek.toLowerCase()];
  if (dayIdx === undefined) return null;
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  const jsDay = (dayIdx + 1) % 7; // Python: Monday=0; JS: Sunday=0
  const currentDay = today.getDay();
  const daysAhead = (jsDay - currentDay + 7) % 7;
  const target = new Date(today);
  target.setDate(target.getDate() + daysAhead);
  target.setHours(hours, minutes, 0, 0);
  return target;
}

function nextForSpecific(eventDate: string, startMinutes: number): Date | null {
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  const parts = eventDate.split("-");
  if (parts.length !== 3) return null;
  const d = new Date(
    parseInt(parts[0]),
    parseInt(parts[1]) - 1,
    parseInt(parts[2]),
    hours,
    minutes,
  );
  if (isNaN(d.getTime())) return null;
  return d;
}

function computeOccurrence(event: {
  cancelled: boolean;
  event_kind: string;
  day_of_week: string | null;
  start_time: number;
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
            day_of_week, date, start_time, end_time, cancelled,
            page_number
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
        start_time: row["start_time"] as number,
        end_time: num(row["end_time"]),
        cancelled: Boolean(row["cancelled"]),
        occurrence: null,
        page_number: num(row["page_number"]),
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
    page_number: ev.page_number,
  };
}

function eventMatchesFilters(
  ev: RawEvent,
  filters: ChurchFilters,
): boolean {
  if (filters.daysOfWeek && filters.daysOfWeek.length > 0) {
    if (ev.event_kind === "weekly" && ev.day_of_week) {
      const dayIdx = DAY_TO_INDEX[ev.day_of_week.toLowerCase()];
      if (dayIdx === undefined || !filters.daysOfWeek.includes(dayIdx)) {
        return false;
      }
    }
    // For specific_date, check if the date falls on a selected weekday
    if (ev.event_kind === "specific_date" && ev.date) {
      const parts = ev.date.split("-");
      if (parts.length === 3) {
        const d = new Date(
          parseInt(parts[0]),
          parseInt(parts[1]) - 1,
          parseInt(parts[2]),
        );
        const jsDay = d.getDay();
        const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
        if (!filters.daysOfWeek.includes(dayIdx)) return false;
      }
    }
  }
  if (
    filters.timeFrom != null &&
    filters.timeTo != null &&
    (ev.start_time < filters.timeFrom || ev.start_time > filters.timeTo)
  ) {
    return false;
  }
  return true;
}

export async function fetchChurches(
  filters: ChurchFilters,
): Promise<ChurchMapItem[]> {
  const db = await getDb();
  const types = filters.types.length > 0 ? filters.types : ALL_TYPES;

  const stmt = db.prepare(
    `SELECT id, parish_id, slug, name, address_line1, address_line2, city, state, postal_code,
            latitude, longitude FROM church ORDER BY name`,
  );
  const churches: Omit<ChurchMapItem, "event_types" | "upcoming_events">[] = [];
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
    if (!eventMatchesFilters(ev, filters)) continue;
    let list = grouped.get(ev.church_id);
    if (!list) {
      list = [];
      grouped.set(ev.church_id, list);
    }
    list.push(ev);
  }

  const EVENING_START_MINUTES = 16 * 60; // 4:00 PM
  const POPUP_DAY_ORDER = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  function popupScheduleSortKey(ev: RawEvent): number {
    if (ev.event_kind !== "weekly" || !ev.day_of_week) return 99999;
    const day = ev.day_of_week.toLowerCase();
    const dayIdx = POPUP_DAY_ORDER.indexOf(day);
    if (dayIdx < 0) return 99999;
    const isSaturdayEvening = day === "saturday" && ev.start_time >= EVENING_START_MINUTES;
    if (day === "sunday") return ev.start_time;
    if (isSaturdayEvening) return 2000 + ev.start_time;
    return 3000 + dayIdx * 1000 + ev.start_time;
  }

  return churches
    .map((c) => {
      const churchEvents = grouped.get(c.id) ?? [];
      const weeklyEvents = churchEvents.filter(
        (e) => e.event_kind === "weekly" && e.day_of_week && !e.cancelled,
      );
      const seen = new Set<string>();
      let popupSchedule = weeklyEvents
        .filter((e) => {
          const key = `${e.day_of_week!.toLowerCase()}-${e.start_time}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => popupScheduleSortKey(a) - popupScheduleSortKey(b))
        .map(toEventSummary);
      if (popupSchedule.length === 0) {
        popupSchedule = churchEvents
          .filter((e) => e.occurrence !== null)
          .sort((a, b) => a.occurrence!.localeCompare(b.occurrence!))
          .slice(0, 5)
          .map(toEventSummary);
      }
      const eventTypes = [
        ...new Set(churchEvents.map((e) => e.event_type)),
      ].sort() as EventType[];
      return {
        ...c,
        event_types: eventTypes,
        upcoming_events: popupSchedule,
      };
    })
    .filter((church) => church.event_types.length > 0);
}

export interface ChurchSearchResult {
  id: number;
  slug: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

export async function fetchAllChurchesForSearch(): Promise<ChurchSearchResult[]> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT id, slug, name, latitude, longitude FROM church
     WHERE latitude IS NOT NULL AND longitude IS NOT NULL
     ORDER BY name`,
  );
  try {
    const results: ChurchSearchResult[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        id: row["id"] as number,
        slug: row["slug"] as string,
        name: str(row["name"]),
        latitude: num(row["latitude"]),
        longitude: num(row["longitude"]),
      });
    }
    return results;
  } finally {
    stmt.free();
  }
}

export async function fetchChurch(slug: string): Promise<ChurchDetail> {
  const db = await getDb();
  const stmt = db.prepare(
    `SELECT id, parish_id, slug, name, address_line1, address_line2, city, state, postal_code,
            latitude, longitude, homepage_url, bulletin_url FROM church WHERE slug = ?`,
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
      homepage_url: str(row["homepage_url"]),
      bulletin_url: str(row["bulletin_url"]),
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
