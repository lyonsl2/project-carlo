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
    next.set("days", filters.daysOfWeek.join(","));
  }
  if (filters.timeFrom > 0) {
    next.set("from", String(filters.timeFrom));
  }
  if (filters.timeTo < MAX_TIME_MINUTE) {
    next.set("to", String(filters.timeTo));
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
    const trimmed = part.trim();
    if (!/^\d+$/.test(trimmed)) continue;
    const n = Number(trimmed);
    if (n >= 0 && n <= 6) seen.add(n);
  }
  return [...seen].sort((a, b) => a - b);
}

function parseMinute(raw: string | null, fallback: number): number {
  if (raw == null || !/^-?\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw);
  if (n < 0) return 0;
  if (n > MAX_TIME_MINUTE) return MAX_TIME_MINUTE;
  return n;
}
