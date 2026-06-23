/**
 * The map's camera (center + zoom) persisted in the URL query string, alongside
 * the filter params. Keeping it in the URL makes a given view shareable and —
 * more importantly — durable across navigation to a church page and back.
 */
export interface MapView {
  lat: number;
  lng: number;
  zoom: number;
}

export const MAP_VIEW_PARAM_KEYS = ["lat", "lng", "z"] as const;

// Five decimals of latitude/longitude is ~1m of precision, which is plenty for
// restoring a map view and keeps the URL from filling with noise digits.
const COORD_DECIMALS = 5;

function roundCoord(value: number): number {
  const factor = 10 ** COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

export function encodeMapViewToParams(
  view: MapView,
  base: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(base);
  next.set("lat", String(roundCoord(view.lat)));
  next.set("lng", String(roundCoord(view.lng)));
  // Leaflet's default zoomSnap is 1, so zoom is an integer; round defensively
  // in case a fractional zoom ever flows through.
  next.set("z", String(Math.round(view.zoom)));
  return next;
}

export function decodeMapViewFromParams(
  params: URLSearchParams,
): MapView | null {
  const lat = parseCoord(params.get("lat"), -90, 90);
  const lng = parseCoord(params.get("lng"), -180, 180);
  const zoom = parseZoom(params.get("z"));
  if (lat == null || lng == null || zoom == null) return null;
  return { lat, lng, zoom };
}

export function mapViewsEqual(a: MapView | null, b: MapView | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    roundCoord(a.lat) === roundCoord(b.lat) &&
    roundCoord(a.lng) === roundCoord(b.lng) &&
    Math.round(a.zoom) === Math.round(b.zoom)
  );
}

function parseCoord(
  raw: string | null,
  min: number,
  max: number,
): number | null {
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value;
}

function parseZoom(raw: string | null): number | null {
  if (raw == null) return null;
  const value = Number(raw);
  // Matches Leaflet's TileLayer maxZoom in ChurchMap; reject anything outside a
  // sane range so a hand-edited URL can't push the map to a broken zoom.
  if (!Number.isFinite(value) || value < 0 || value > 19) return null;
  return Math.round(value);
}
