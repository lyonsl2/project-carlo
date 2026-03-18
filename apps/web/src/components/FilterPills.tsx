import { formatMinutesToTime, titleCase } from "../utils";
import type { FilterState } from "./FilterPanel";

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

interface FilterPillsProps {
  filters: FilterState;
}

export function FilterPills({ filters }: FilterPillsProps) {
  const pills: string[] = [];

  // Event type - always show (single selection)
  pills.push(titleCase(filters.eventType));

  // Days of week (empty = "Any day")
  if (filters.daysOfWeek.length === 0) {
    pills.push("Any day");
  } else {
    filters.daysOfWeek.forEach((i) => pills.push(DAY_NAMES[i]));
  }

  // Time range (only if not full day)
  const isFullDay =
    filters.timeFrom <= 0 && filters.timeTo >= MINUTES_PER_DAY - 1;
  if (!isFullDay) {
    pills.push(
      `${formatMinutesToTime(filters.timeFrom)} – ${formatMinutesToTime(filters.timeTo)}`,
    );
  }

  return (
    <div className="filter-pills">
      {pills.map((label) => (
        <span key={label} className="filter-pill">
          {label}
        </span>
      ))}
    </div>
  );
}
