import type { Database } from "sql.js";
import type { ChurchDetail, EventSummary, EventType } from "../types";

const ALL_TYPES: EventType[] = ["mass", "confession", "adoration"];

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}

export function getAllChurchSlugs(db: Database): string[] {
  const result = db.exec("SELECT slug FROM church ORDER BY name");
  if (result.length === 0) return [];
  return result[0].values.map((row) => row[0] as string);
}

export function getChurchDetail(db: Database, slug: string): ChurchDetail {
  const stmt = db.prepare(
    `SELECT id, parish_id, slug, name, address_line1, address_line2, city, state, postal_code,
            latitude, longitude, homepage_url, bulletin_url FROM church WHERE slug = ?`,
  );
  stmt.bind([slug]);
  if (!stmt.step()) {
    stmt.free();
    throw new Error(`Church not found: ${slug}`);
  }
  const row = stmt.getAsObject();
  stmt.free();
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
}

export function getChurchEvents(
  db: Database,
  slug: string,
  types: EventType[] = ALL_TYPES,
): EventSummary[] {
  const idResult = db.exec("SELECT id FROM church WHERE slug = ?", [slug]);
  if (idResult.length === 0 || idResult[0].values.length === 0) {
    throw new Error(`Church not found: ${slug}`);
  }
  const churchId = idResult[0].values[0][0] as number;

  const typePlaceholders = types.map(() => "?").join(",");
  const stmt = db.prepare(
    `SELECT id, event_type, event_kind, day_of_week, date, start_time, end_time, cancelled, page_number
     FROM event
     WHERE church_id = ? AND event_type IN (${typePlaceholders})`,
  );
  stmt.bind([churchId, ...types]);

  const events: EventSummary[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    events.push({
      id: row["id"] as number,
      type: row["event_type"] as EventType,
      kind: row["event_kind"] as "weekly" | "specific_date",
      day_of_week: str(row["day_of_week"]),
      date: str(row["date"]),
      start_time: row["start_time"] as number,
      end_time: num(row["end_time"]),
      cancelled: Boolean(row["cancelled"]),
      next_occurrence: null,
      page_number: num(row["page_number"]),
    });
  }
  stmt.free();
  return events;
}
