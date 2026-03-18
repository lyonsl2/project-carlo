export type EventType = "mass" | "confession" | "adoration";

export interface EventSummary {
  id: number;
  type: EventType;
  kind: "weekly" | "specific_date";
  day_of_week: string | null;
  date: string | null;
  start_time: number;
  end_time: number | null;
  cancelled: boolean;
  next_occurrence: string | null;
}

export interface ChurchMapItem {
  id: number;
  parish_id: number;
  slug: string;
  name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  event_types: EventType[];
  upcoming_events: EventSummary[];
}

export interface ChurchDetail {
  id: number;
  parish_id: number;
  slug: string;
  name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  homepage_url: string | null;
  bulletin_url: string | null;
}
