import { formatMinutesToTime, titleCase } from "../utils";
import type { FilterState } from "./filterState";
import { Badge } from "@/components/ui/badge";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_EVENT_TYPE = "mass";

interface FilterPillsProps {
  filters: FilterState;
}

export function FilterPills({ filters }: FilterPillsProps) {
  const pills: string[] = [];

  // Only show the event type pill when it deviates from the default.
  if (filters.eventType !== DEFAULT_EVENT_TYPE) {
    pills.push(titleCase(filters.eventType));
  }

  // Days of week — only show when specific days are selected.
  if (filters.daysOfWeek.length > 0) {
    filters.daysOfWeek.forEach((i) => pills.push(DAY_NAMES[i]));
  }

  // Time range — only show when not a full day.
  const isFullDay =
    filters.timeFrom <= 0 && filters.timeTo >= MINUTES_PER_DAY - 1;
  if (!isFullDay) {
    pills.push(
      `${formatMinutesToTime(filters.timeFrom)} – ${formatMinutesToTime(filters.timeTo)}`,
    );
  }

  if (pills.length === 0) return null;

  return (
    <div className="mt-3 flex min-h-0 flex-wrap gap-2">
      {pills.map((label) => (
        <Badge
          key={label}
          variant="outline"
          className="rounded-full bg-background/90 px-3 py-1 text-xs font-medium"
        >
          {label}
        </Badge>
      ))}
    </div>
  );
}
