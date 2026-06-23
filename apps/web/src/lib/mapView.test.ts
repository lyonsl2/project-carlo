import { describe, expect, it } from "vitest";
import {
  decodeMapViewFromParams,
  encodeMapViewToParams,
  mapViewsEqual,
  type MapView,
} from "./mapView";

function params(init: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams(init);
}

describe("encode/decode round-trip", () => {
  it("round-trips a typical view", () => {
    const view: MapView = { lat: 43.1566, lng: -77.6088, zoom: 13 };
    const decoded = decodeMapViewFromParams(encodeMapViewToParams(view, params()));
    expect(decoded).toEqual(view);
  });

  it("rounds coordinates to five decimals", () => {
    const encoded = encodeMapViewToParams(
      { lat: 43.123456789, lng: -77.987654321, zoom: 11 },
      params(),
    );
    expect(encoded.get("lat")).toBe("43.12346");
    expect(encoded.get("lng")).toBe("-77.98765");
  });

  it("preserves unrelated params it doesn't own", () => {
    const encoded = encodeMapViewToParams(
      { lat: 1, lng: 2, zoom: 10 },
      params({ type: "confession", days: "mon,fri" }),
    );
    expect(encoded.get("type")).toBe("confession");
    expect(encoded.get("days")).toBe("mon,fri");
  });
});

describe("decodeMapViewFromParams", () => {
  it("returns null when any component is missing", () => {
    expect(decodeMapViewFromParams(params({ lat: "43", lng: "-77" }))).toBeNull();
    expect(decodeMapViewFromParams(params({ lat: "43", z: "11" }))).toBeNull();
    expect(decodeMapViewFromParams(params())).toBeNull();
  });

  it("rejects out-of-range coordinates and zoom", () => {
    expect(
      decodeMapViewFromParams(params({ lat: "120", lng: "-77", z: "11" })),
    ).toBeNull();
    expect(
      decodeMapViewFromParams(params({ lat: "43", lng: "-200", z: "11" })),
    ).toBeNull();
    expect(
      decodeMapViewFromParams(params({ lat: "43", lng: "-77", z: "99" })),
    ).toBeNull();
  });

  it("rejects non-numeric values", () => {
    expect(
      decodeMapViewFromParams(params({ lat: "abc", lng: "-77", z: "11" })),
    ).toBeNull();
  });
});

describe("mapViewsEqual", () => {
  it("treats views equal within coordinate rounding precision", () => {
    expect(
      mapViewsEqual(
        { lat: 43.123451, lng: -77.6, zoom: 11 },
        { lat: 43.123452, lng: -77.6, zoom: 11 },
      ),
    ).toBe(true);
  });

  it("distinguishes different zoom or position", () => {
    expect(
      mapViewsEqual(
        { lat: 43.1, lng: -77.6, zoom: 11 },
        { lat: 43.1, lng: -77.6, zoom: 12 },
      ),
    ).toBe(false);
    expect(mapViewsEqual(null, { lat: 43.1, lng: -77.6, zoom: 11 })).toBe(false);
    expect(mapViewsEqual(null, null)).toBe(true);
  });
});
