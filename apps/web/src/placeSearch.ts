const GEOAPIFY_AUTOCOMPLETE_URL =
  "https://api.geoapify.com/v1/geocode/autocomplete";

const ROCHESTER_BIAS = "proximity:-77.6088,43.1566";
const PLACE_RESULT_LIMIT = "5";
export const PLACE_SEARCH_ZOOM = 12;

const SEARCHABLE_RESULT_TYPES = new Set([
  "building",
  "street",
  "suburb",
  "district",
  "postcode",
  "city",
  "county",
  "state",
]);

export type PlaceResultType =
  | "unknown"
  | "amenity"
  | "building"
  | "street"
  | "suburb"
  | "district"
  | "postcode"
  | "city"
  | "county"
  | "state"
  | "country";

interface GeoapifyResult {
  place_id?: string;
  formatted?: string;
  address_line1?: string;
  address_line2?: string;
  name?: string;
  city?: string;
  state?: string;
  postcode?: string;
  result_type?: PlaceResultType;
  lat?: number;
  lon?: number;
}

interface GeoapifyResponse {
  results?: GeoapifyResult[];
}

export interface PlaceSearchResult {
  id: string;
  title: string;
  subtitle: string | null;
  lat: number;
  lng: number;
  resultType: PlaceResultType;
}

export class PlaceSearchConfigurationError extends Error {
  constructor() {
    super("Geoapify place search is not configured.");
    this.name = "PlaceSearchConfigurationError";
  }
}

export function canSearchPlaces(query: string): boolean {
  const trimmed = query.trim();
  if (isZipCodeQuery(trimmed)) return true;
  return trimmed.length >= 3;
}

function isZipCodeQuery(query: string): boolean {
  return /^\d{2,5}(-\d{0,4})?$/.test(query);
}

function toPlaceSearchResult(result: GeoapifyResult): PlaceSearchResult | null {
  if (typeof result.lat !== "number" || typeof result.lon !== "number") {
    return null;
  }

  const resultType = result.result_type ?? "unknown";
  if (!SEARCHABLE_RESULT_TYPES.has(resultType)) {
    return null;
  }

  const title =
    result.result_type === "postcode"
      ? (result.postcode ?? result.formatted)
      : (result.address_line1 ?? result.name ?? result.formatted);
  if (!title) return null;

  const addressParts = [result.city, result.state, result.postcode]
    .filter(Boolean)
    .join(", ");
  const subtitle = result.address_line2 ?? addressParts;

  return {
    id: result.place_id ?? `${result.lat}-${result.lon}-${title}`,
    title,
    subtitle: subtitle || null,
    lat: result.lat,
    lng: result.lon,
    resultType,
  };
}

export async function searchPlaces(
  query: string,
  options: { signal?: AbortSignal } = {},
): Promise<PlaceSearchResult[]> {
  const apiKey = import.meta.env.VITE_GEOAPIFY_API_KEY;
  if (!apiKey) {
    throw new PlaceSearchConfigurationError();
  }

  const trimmed = query.trim();
  const params = new URLSearchParams({
    text: trimmed,
    format: "json",
    limit: PLACE_RESULT_LIMIT,
    lang: "en",
    filter: "countrycode:us",
    bias: ROCHESTER_BIAS,
    apiKey,
  });
  if (isZipCodeQuery(trimmed)) {
    params.set("type", "postcode");
  }

  const response = await fetch(`${GEOAPIFY_AUTOCOMPLETE_URL}?${params}`, {
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Place search failed with status ${response.status}.`);
  }

  const data = (await response.json()) as GeoapifyResponse;
  return (data.results ?? [])
    .map(toPlaceSearchResult)
    .filter((result): result is PlaceSearchResult => result !== null);
}
