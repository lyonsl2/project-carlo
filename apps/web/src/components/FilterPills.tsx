import { formatMinutesMissal, titleCase } from "../utils";
import { MINUTES_PER_DAY, type FilterState } from "./filterState";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface FilterPillsProps {
  filters: FilterState;
}

/** Active filter summary: small-caps labels separated by middots. (Mobile only; see md:hidden on root.) */
export function FilterPills({ filters }: FilterPillsProps) {
  const isFullDay =
    filters.timeFrom <= 0 && filters.timeTo >= MINUTES_PER_DAY - 1;
  const isDefaultView =
    filters.eventType === "mass" &&
    filters.daysOfWeek.length === 0 &&
    isFullDay;

  if (isDefaultView) return null;

  const parts: string[] = [];

  parts.push(titleCase(filters.eventType));

  if (filters.daysOfWeek.length > 0) {
    if (filters.daysOfWeek.length <= 3) {
      filters.daysOfWeek.forEach((i) => parts.push(DAY_NAMES[i]));
    } else {
      parts.push(`${filters.daysOfWeek.length} days`);
    }
  }

  if (!isFullDay) {
    parts.push(
      `${formatMinutesMissal(filters.timeFrom)} – ${formatMinutesMissal(
        filters.timeTo,
      )}`,
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:hidden">
      <span className="smallcaps text-[0.8125rem] text-ink-faint">
        Showing
      </span>
      {parts.map((label, idx) => (
        <span key={`${idx}-${label}`} className="flex items-center gap-3">
          {idx > 0 ? (
            <span aria-hidden className="text-brass">
              ·
            </span>
          ) : null}
          <span className="smallcaps text-[0.875rem] text-rubric">
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}
