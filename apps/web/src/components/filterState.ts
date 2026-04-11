import type { EventType } from "../types";

export interface FilterState {
  eventType: EventType; // single selection: mass, adoration, or confession
  daysOfWeek: number[]; // 0=Mon, 6=Sun
  timeFrom: number; // minutes since midnight
  timeTo: number; // minutes since midnight
}

const MINUTES_PER_DAY = 24 * 60;

export function getTimeRange(filters: FilterState): {
  from?: number;
  to?: number;
} {
  if (filters.timeFrom <= 0 && filters.timeTo >= MINUTES_PER_DAY - 1) {
    return {};
  }
  return { from: filters.timeFrom, to: filters.timeTo };
}
