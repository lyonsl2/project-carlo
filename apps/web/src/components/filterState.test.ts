import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTER_STATE,
  MINUTES_PER_DAY,
  decodeFiltersFromParams,
  encodeFiltersToParams,
  filtersEqual,
  type FilterState,
} from "./filterState";

const MAX_TIME_MINUTE = MINUTES_PER_DAY - 1;

function state(overrides: Partial<FilterState> = {}): FilterState {
  return { ...DEFAULT_FILTER_STATE, ...overrides };
}

function encode(filters: FilterState, base = new URLSearchParams()): string {
  return encodeFiltersToParams(filters, base).toString();
}

describe("encode/decode round-trip", () => {
  const cases: Array<{ name: string; state: FilterState }> = [
    { name: "default state", state: state() },
    { name: "event type only", state: state({ eventType: "confession" }) },
    { name: "days only", state: state({ daysOfWeek: [0, 3, 6] }) },
    { name: "from only", state: state({ timeFrom: 8 * 60 }) },
    { name: "to only", state: state({ timeTo: 21 * 60 + 30 }) },
    {
      name: "all combined",
      state: state({
        eventType: "adoration",
        daysOfWeek: [1, 4, 5],
        timeFrom: 7 * 60 + 15,
        timeTo: 19 * 60 + 45,
      }),
    },
  ];

  it.each(cases)("round-trips $name", ({ state: original }) => {
    const decoded = decodeFiltersFromParams(
      encodeFiltersToParams(original, new URLSearchParams()),
    );
    expect(decoded).toEqual(original);
  });

  it("encodes the default state to zero params", () => {
    expect(encode(state())).toBe("");
  });

  it("encodes each non-default field to exactly one param", () => {
    expect(encode(state({ eventType: "confession" }))).toBe("type=confession");
    expect(encode(state({ daysOfWeek: [0, 3, 6] }))).toBe("days=mon%2Cthu%2Csun");
    expect(encode(state({ timeFrom: 8 * 60 }))).toBe("from=0800");
    expect(encode(state({ timeTo: 21 * 60 + 30 }))).toBe("to=2130");
  });
});

describe("encodeFiltersToParams param hygiene", () => {
  it("preserves unrelated params and deletes only its own four keys", () => {
    const base = new URLSearchParams(
      "foo=bar&q=1&type=stale&days=stale&from=9999&to=9999",
    );
    const result = encodeFiltersToParams(state({ daysOfWeek: [2] }), base);

    expect(result.get("foo")).toBe("bar");
    expect(result.get("q")).toBe("1");
    // Stale filter keys are dropped; only the keys for set fields are re-added.
    expect(result.get("days")).toBe("wed");
    expect(result.has("type")).toBe(false);
    expect(result.has("from")).toBe(false);
    expect(result.has("to")).toBe(false);
  });

  it("does not mutate the base params", () => {
    const base = new URLSearchParams("foo=bar");
    encodeFiltersToParams(state({ eventType: "confession" }), base);
    expect(base.toString()).toBe("foo=bar");
  });
});

describe("decode: parseMinute", () => {
  it("falls back when the param is missing", () => {
    const decoded = decodeFiltersFromParams(new URLSearchParams());
    expect(decoded.timeFrom).toBe(DEFAULT_FILTER_STATE.timeFrom);
    expect(decoded.timeTo).toBe(DEFAULT_FILTER_STATE.timeTo);
  });

  it.each([
    ["abc", "non-numeric"],
    ["8:00", "contains a colon"],
    ["800", "only three digits"],
    ["0860", "minutes >= 60"],
    ["2500", "hours > 24"],
  ])("falls back for invalid %s (%s)", (raw) => {
    const decoded = decodeFiltersFromParams(new URLSearchParams({ from: raw }));
    expect(decoded.timeFrom).toBe(DEFAULT_FILTER_STATE.timeFrom);
  });

  it("parses a valid zero-padded HHMM value", () => {
    expect(
      decodeFiltersFromParams(new URLSearchParams({ from: "0001" })).timeFrom,
    ).toBe(1);
    expect(
      decodeFiltersFromParams(new URLSearchParams({ to: "2345" })).timeTo,
    ).toBe(23 * 60 + 45);
  });

  it("clamps an in-range hour past the last minute of the day", () => {
    // 24:00 = 1440 minutes, hour 24 is allowed but clamped to MAX_TIME_MINUTE.
    // fallback for `from` is 0, so 1439 proves clamping (not fallback).
    expect(
      decodeFiltersFromParams(new URLSearchParams({ from: "2400" })).timeFrom,
    ).toBe(MAX_TIME_MINUTE);
  });
});

describe("decode: parseDays", () => {
  it("returns an empty array for missing or empty input", () => {
    expect(decodeFiltersFromParams(new URLSearchParams()).daysOfWeek).toEqual([]);
    expect(
      decodeFiltersFromParams(new URLSearchParams({ days: "" })).daysOfWeek,
    ).toEqual([]);
  });

  it("dedupes, sorts, and ignores junk tokens", () => {
    const decoded = decodeFiltersFromParams(
      new URLSearchParams({ days: "sun,mon,mon,xyz,tue, ,SAT" }),
    );
    // mon=0, tue=1, sat=5, sun=6 (deduped + sorted); xyz/blank ignored.
    expect(decoded.daysOfWeek).toEqual([0, 1, 5, 6]);
  });

  it("ignores input that is entirely junk", () => {
    expect(
      decodeFiltersFromParams(new URLSearchParams({ days: "foo,bar" }))
        .daysOfWeek,
    ).toEqual([]);
  });
});

describe("decode: parseEventType", () => {
  it("falls back to mass on unknown values", () => {
    expect(
      decodeFiltersFromParams(new URLSearchParams({ type: "bogus" })).eventType,
    ).toBe("mass");
  });

  it.each(["mass", "confession", "adoration"] as const)(
    "accepts the known event type %s",
    (type) => {
      expect(
        decodeFiltersFromParams(new URLSearchParams({ type })).eventType,
      ).toBe(type);
    },
  );
});

describe("filtersEqual", () => {
  it("returns true for the same reference", () => {
    const s = state();
    expect(filtersEqual(s, s)).toBe(true);
  });

  it("returns true for distinct but equal states", () => {
    expect(filtersEqual(state({ daysOfWeek: [1, 2] }), state({ daysOfWeek: [1, 2] }))).toBe(
      true,
    );
  });

  it("returns false when scalar fields differ", () => {
    expect(filtersEqual(state(), state({ eventType: "confession" }))).toBe(false);
    expect(filtersEqual(state(), state({ timeFrom: 60 }))).toBe(false);
    expect(filtersEqual(state(), state({ timeTo: 60 }))).toBe(false);
  });

  it("compares daysOfWeek by length and element order", () => {
    expect(
      filtersEqual(state({ daysOfWeek: [0, 1] }), state({ daysOfWeek: [0] })),
    ).toBe(false);
    expect(
      filtersEqual(state({ daysOfWeek: [0, 1] }), state({ daysOfWeek: [0, 2] })),
    ).toBe(false);
    expect(
      filtersEqual(state({ daysOfWeek: [0, 1] }), state({ daysOfWeek: [0, 1] })),
    ).toBe(true);
  });
});
