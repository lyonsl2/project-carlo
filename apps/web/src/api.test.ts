import { describe, expect, it } from "vitest";
import {
  eventMatchesFilters,
  parseEventDateForFilter,
  type ChurchFilters,
  type RawEvent,
} from "./api";

function rawEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    id: 1,
    church_id: 1,
    event_type: "mass",
    event_kind: "weekly",
    day_of_week: "monday",
    date: null,
    start_time: 9 * 60,
    end_time: null,
    cancelled: false,
    occurrence: null,
    page_number: null,
    note: null,
    ...overrides,
  };
}

describe("eventMatchesFilters", () => {
  it("rejects cancelled events regardless of other filters", () => {
    const filters: ChurchFilters = { types: [] };
    expect(eventMatchesFilters(rawEvent({ cancelled: true }), filters)).toBe(
      false,
    );
  });

  it("accepts an event when no day or time filters are set", () => {
    expect(eventMatchesFilters(rawEvent(), { types: [] })).toBe(true);
  });

  describe("weekly weekday filter", () => {
    it("accepts when the event weekday is selected", () => {
      const ev = rawEvent({ event_kind: "weekly", day_of_week: "monday" });
      expect(eventMatchesFilters(ev, { types: [], daysOfWeek: [0] })).toBe(true);
    });

    it("rejects when the event weekday is not selected", () => {
      const ev = rawEvent({ event_kind: "weekly", day_of_week: "monday" });
      expect(eventMatchesFilters(ev, { types: [], daysOfWeek: [1] })).toBe(false);
    });

    it("is case-insensitive on day_of_week", () => {
      const ev = rawEvent({ event_kind: "weekly", day_of_week: "MONDAY" });
      expect(eventMatchesFilters(ev, { types: [], daysOfWeek: [0] })).toBe(true);
    });

    it("rejects an unknown weekday string", () => {
      const ev = rawEvent({ event_kind: "weekly", day_of_week: "funday" });
      expect(eventMatchesFilters(ev, { types: [], daysOfWeek: [0, 1, 2] })).toBe(
        false,
      );
    });
  });

  describe("specific_date weekday filter", () => {
    it("maps a Sunday date to index 6 (Monday-first)", () => {
      // 2026-06-07 is a Sunday -> getDay() 0 -> index 6.
      const ev = rawEvent({
        event_kind: "specific_date",
        day_of_week: null,
        date: "2026-06-07",
      });
      expect(eventMatchesFilters(ev, { types: [], daysOfWeek: [6] })).toBe(true);
      expect(eventMatchesFilters(ev, { types: [], daysOfWeek: [0] })).toBe(false);
    });

    it("maps a Monday date to index 0 (Monday-first)", () => {
      // 2026-06-08 is a Monday -> getDay() 1 -> index 0.
      const ev = rawEvent({
        event_kind: "specific_date",
        day_of_week: null,
        date: "2026-06-08",
      });
      expect(eventMatchesFilters(ev, { types: [], daysOfWeek: [0] })).toBe(true);
      expect(eventMatchesFilters(ev, { types: [], daysOfWeek: [6] })).toBe(false);
    });

    it("rejects an unparseable date when a day filter is set", () => {
      const ev = rawEvent({
        event_kind: "specific_date",
        day_of_week: null,
        date: "not-a-date",
      });
      expect(eventMatchesFilters(ev, { types: [], daysOfWeek: [0] })).toBe(false);
    });
  });

  describe("time-window filter", () => {
    it("applies only when both timeFrom and timeTo are set", () => {
      const ev = rawEvent({ start_time: 60 }); // 01:00, well before any window
      // Only one bound set -> window check skipped, event passes.
      expect(eventMatchesFilters(ev, { types: [], timeFrom: 8 * 60 })).toBe(true);
      expect(eventMatchesFilters(ev, { types: [], timeTo: 8 * 60 })).toBe(true);
    });

    it("rejects events outside the window when both bounds are set", () => {
      const filters: ChurchFilters = {
        types: [],
        timeFrom: 8 * 60,
        timeTo: 12 * 60,
      };
      expect(eventMatchesFilters(rawEvent({ start_time: 7 * 60 }), filters)).toBe(
        false,
      );
      expect(
        eventMatchesFilters(rawEvent({ start_time: 13 * 60 }), filters),
      ).toBe(false);
      expect(eventMatchesFilters(rawEvent({ start_time: 10 * 60 }), filters)).toBe(
        true,
      );
    });

    it("treats the window bounds as inclusive", () => {
      const filters: ChurchFilters = {
        types: [],
        timeFrom: 8 * 60,
        timeTo: 12 * 60,
      };
      expect(eventMatchesFilters(rawEvent({ start_time: 8 * 60 }), filters)).toBe(
        true,
      );
      expect(
        eventMatchesFilters(rawEvent({ start_time: 12 * 60 }), filters),
      ).toBe(true);
    });
  });
});

describe("parseEventDateForFilter", () => {
  it("parses an ISO YYYY-MM-DD date in local time", () => {
    const d = parseEventDateForFilter("2026-06-07");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(7);
  });

  it("trims surrounding whitespace before parsing", () => {
    const d = parseEventDateForFilter("  2026-06-07  ");
    expect(d!.getDate()).toBe(7);
  });

  it("returns null for an unparseable string", () => {
    expect(parseEventDateForFilter("not-a-date")).toBeNull();
  });
});
