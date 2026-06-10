import { DAY_ORDER, type WeekdayKey } from "../constants/days";

/**
 * Shared schedule logic for both the SPA and the prerenderer so that a static
 * church page and the live React page show the same set of events in the same
 * order.  Pure functions only; no DOM, React, or sql.js dependencies.
 */

const MONDAY_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

const EVENING_START_MINUTES = 16 * 60;

export interface OccurrenceInput {
  cancelled: boolean;
  event_kind: string;
  day_of_week: string | null;
  start_time: number;
  date: string | null;
}

export interface CompareInput {
  kind: "weekly" | "specific_date";
  day_of_week: string | null;
  date: string | null;
  start_time: number;
}

function todayDate(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseEventDate(value: string): Date | null {
  // Prefer explicit YYYY-MM-DD parsing to avoid timezone/date shifts.
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (isoMatch) {
    const year = Number.parseInt(isoMatch[1], 10);
    const month = Number.parseInt(isoMatch[2], 10);
    const day = Number.parseInt(isoMatch[3], 10);
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function nextForWeekly(
  dayOfWeek: string,
  startMinutes: number,
  today: Date,
): Date | null {
  const dayIdx = MONDAY_INDEX[dayOfWeek.toLowerCase()];
  if (dayIdx === undefined) return null;
  const hours = Math.floor(startMinutes / 60);
  const minutes = startMinutes % 60;
  const jsDay = (dayIdx + 1) % 7; // Python: Monday=0; JS: Sunday=0
  const daysAhead = (jsDay - today.getDay() + 7) % 7;
  const target = new Date(today);
  target.setDate(target.getDate() + daysAhead);
  target.setHours(hours, minutes, 0, 0);
  return target;
}

function nextForSpecific(
  eventDate: string,
  startMinutes: number,
  today: Date,
): Date | null {
  const parsed = parseEventDate(eventDate);
  if (!parsed) return null;
  // Drop events whose calendar day is already past; same-day events still show
  // (date-only comparison, so an earlier start_time today is not filtered out).
  const eventDay = new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
  );
  if (eventDay.getTime() < today.getTime()) return null;
  const d = new Date(parsed);
  d.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ISO timestamp of the next occurrence of `event`, or null if the event is
 * cancelled, unparseable, or (for specific_date events) already past.
 */
export function computeNextOccurrence(
  event: OccurrenceInput,
  today: Date = todayDate(),
): string | null {
  if (event.cancelled) return null;
  let occ: Date | null = null;
  if (event.event_kind === "weekly" && event.day_of_week) {
    occ = nextForWeekly(event.day_of_week, event.start_time, today);
  } else if (event.event_kind === "specific_date" && event.date) {
    occ = nextForSpecific(event.date, event.start_time, today);
  }
  return occ ? occ.toISOString() : null;
}

/**
 * Liturgical-week comparator used for map popups and the church page.
 *
 * Order: weekly Sunday, Saturday evening (>= 4 pm, vigil), Mon-Sat weekly by
 * weekday, then specific-date events by date.  Ties break on start_time.
 */
export function compareSchedule(a: CompareInput, b: CompareInput): number {
  const aIsSpecific = a.kind === "specific_date" && a.date;
  const bIsSpecific = b.kind === "specific_date" && b.date;

  if (aIsSpecific && bIsSpecific) {
    const dateCompare = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCompare !== 0) return dateCompare;
    return a.start_time - b.start_time;
  }
  if (aIsSpecific && !bIsSpecific) return 1;
  if (!aIsSpecific && bIsSpecific) return -1;

  const dayA = weekdayKeyFor(a);
  const dayB = weekdayKeyFor(b);
  if (!dayA) return 1;
  if (!dayB) return -1;

  const dayIdxA = DAY_ORDER.indexOf(dayA);
  const dayIdxB = DAY_ORDER.indexOf(dayB);
  const isSatEveA =
    dayA === "saturday" && a.start_time >= EVENING_START_MINUTES;
  const isSatEveB =
    dayB === "saturday" && b.start_time >= EVENING_START_MINUTES;

  return scheduleSortKey(dayA, dayIdxA, isSatEveA, a.start_time)
    - scheduleSortKey(dayB, dayIdxB, isSatEveB, b.start_time);
}

function weekdayKeyFor(e: CompareInput): WeekdayKey | null {
  if (e.kind === "weekly" && e.day_of_week) {
    return e.day_of_week.toLowerCase() as WeekdayKey;
  }
  if (e.date) {
    const d = new Date(e.date + "T12:00:00");
    return DAY_ORDER[d.getDay()];
  }
  return null;
}

function scheduleSortKey(
  day: WeekdayKey,
  dayIdx: number,
  isSatEve: boolean,
  startTime: number,
): number {
  if (day === "sunday") return startTime;
  if (isSatEve) return 1000 + startTime;
  return 2000 + dayIdx * 1000 + startTime;
}
