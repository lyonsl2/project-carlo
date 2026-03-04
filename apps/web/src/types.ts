export type EventType = "mass" | "confession" | "adoration";

export interface EventSummary {
  id: number;
  type: EventType;
  kind: "weekly" | "specific_date";
  day_of_week: string | null;
  date: string | null;
  start_time: string;
  end_time: string | null;
  cancelled: boolean;
  next_occurrence: string | null;
}

export interface ChurchMapItem {
  id: number;
  parish_id: number;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  event_types: EventType[];
  upcoming_events: EventSummary[];
}

export interface ChurchDetail {
  id: number;
  parish_id: number;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}
