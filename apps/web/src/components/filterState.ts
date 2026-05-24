import { EVENT_TYPE_ORDER } from "../constants/eventTypes";
import type { EventType } from "../types";

export interface FilterState {
  eventType: EventType; // single selection: mass, adoration, or confession
  daysOfWeek: number[]; // 0=Mon, 6=Sun
  timeFrom: number; // minutes since midnight
  timeTo: number; // minutes since midnight
}

export const MINUTES_PER_DAY = 24 * 60;

export const DEFAULT_FILTER_STATE: FilterState = {
  eventType: "mass",
  daysOfWeek: [],
  timeFrom: 0,
  timeTo: MINUTES_PER_DAY - 1,
};

export function getTimeRange(filters: FilterState): {
  from?: number;
  to?: number;
} {
  if (filters.timeFrom <= 0 && filters.timeTo >= MINUTES_PER_DAY - 1) {
    return {};
  }
  return { from: filters.timeFrom, to: filters.timeTo };
}

const FILTER_PARAM_KEYS = ["type", "days", "from", "to"] as const;
const EVENT_TYPE_SET = new Set<EventType>(EVENT_TYPE_ORDER);
const MAX_TIME_MINUTE = MINUTES_PER_DAY - 1;

// Day-index <-> URL abbreviation. Indices match FilterState.daysOfWeek
// (0=Mon..6=Sun); the URL uses the lowercase 3-letter form.
const DAY_INDEX_TO_ABBR = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
const DAY_ABBR_TO_INDEX: Record<string, number> = Object.fromEntries(
  DAY_INDEX_TO_ABBR.map((abbr, i) => [abbr, i]),
);

function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}${String(m).padStart(2, "0")}`;
}

export function encodeFiltersToParams(
  filters: FilterState,
  base: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const key of FILTER_PARAM_KEYS) next.delete(key);

  if (filters.eventType !== DEFAULT_FILTER_STATE.eventType) {
    next.set("type", filters.eventType);
  }
  if (filters.daysOfWeek.length > 0) {
    next.set(
      "days",
      filters.daysOfWeek.map((i) => DAY_INDEX_TO_ABBR[i]).join(","),
    );
  }
  if (filters.timeFrom > 0) {
    next.set("from", formatTime(filters.timeFrom));
  }
  if (filters.timeTo < MAX_TIME_MINUTE) {
    next.set("to", formatTime(filters.timeTo));
  }
  return next;
}

export function decodeFiltersFromParams(params: URLSearchParams): FilterState {
  return {
    eventType: parseEventType(params.get("type")),
    daysOfWeek: parseDays(params.get("days")),
    timeFrom: parseMinute(params.get("from"), DEFAULT_FILTER_STATE.timeFrom),
    timeTo: parseMinute(params.get("to"), DEFAULT_FILTER_STATE.timeTo),
  };
}

export function filtersEqual(a: FilterState, b: FilterState): boolean {
  if (a === b) return true;
  if (
    a.eventType !== b.eventType ||
    a.timeFrom !== b.timeFrom ||
    a.timeTo !== b.timeTo
  ) {
    return false;
  }
  if (a.daysOfWeek.length !== b.daysOfWeek.length) return false;
  for (let i = 0; i < a.daysOfWeek.length; i++) {
    if (a.daysOfWeek[i] !== b.daysOfWeek[i]) return false;
  }
  return true;
}

function parseEventType(raw: string | null): EventType {
  if (raw && EVENT_TYPE_SET.has(raw as EventType)) {
    return raw as EventType;
  }
  return DEFAULT_FILTER_STATE.eventType;
}

function parseDays(raw: string | null): number[] {
  if (!raw) return [];
  const seen = new Set<number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim().toLowerCase();
    if (!trimmed) continue;
    const abbrIndex = DAY_ABBR_TO_INDEX[trimmed];
    if (abbrIndex !== undefined) seen.add(abbrIndex);
  }
  return [...seen].sort((a, b) => a - b);
}

function parseMinute(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  // HHMM 24-hour, zero-padded (e.g. 0800, 2345).
  const hhmm = /^(\d{2})(\d{2})$/.exec(trimmed);
  if (!hhmm) return fallback;
  const h = Number(hhmm[1]);
  const m = Number(hhmm[2]);
  if (h < 0 || h > 24 || m < 0 || m >= 60) return fallback;
  const total = h * 60 + m;
  if (total < 0) return 0;
  if (total > MAX_TIME_MINUTE) return MAX_TIME_MINUTE;
  return total;
}
