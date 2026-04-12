import type { EventType } from "../types";

export const EVENT_TYPE_ORDER: EventType[] = [
  "mass",
  "confession",
  "adoration",
];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  mass: "Mass",
  confession: "Confession",
  adoration: "Adoration",
};

export const EVENT_TYPE_OPTIONS = EVENT_TYPE_ORDER.map((id) => ({
  id,
  label: EVENT_TYPE_LABELS[id],
}));
