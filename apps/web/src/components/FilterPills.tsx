import { formatMinutesMissal, titleCase } from "../utils";
import type { FilterState } from "./filterState";

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

/** A single line of small-caps labels separated by bullet points — styled
 *  like the standing heads beneath a newspaper masthead ("VOL. I · NO. 1 ·
 *  PRICE FIVE CENTS"). Replaces the chunkier pill badges of the old UI. */
export function FilterPills({ filters }: FilterPillsProps) {
  const parts: string[] = [];

  if (filters.eventType !== DEFAULT_EVENT_TYPE) {
    parts.push(titleCase(filters.eventType));
  }

  if (filters.daysOfWeek.length > 0) {
    if (filters.daysOfWeek.length <= 3) {
      filters.daysOfWeek.forEach((i) => parts.push(DAY_NAMES[i]));
    } else {
      parts.push(`${filters.daysOfWeek.length} days`);
    }
  }

  const isFullDay =
    filters.timeFrom <= 0 && filters.timeTo >= MINUTES_PER_DAY - 1;
  if (!isFullDay) {
    parts.push(
      `${formatMinutesMissal(filters.timeFrom)} – ${formatMinutesMissal(
        filters.timeTo,
      )}`,
    );
  }

  if (parts.length === 0) return null;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="smallcaps text-[0.78rem] text-ink-faint">Window set to</span>
      {parts.map((label, idx) => (
        <span key={label} className="flex items-center gap-2">
          {idx > 0 ? <span aria-hidden className="text-ink-faint/60">+</span> : null}
          <span className="glass-chip smallcaps rounded-full px-3 py-1.5 text-[0.78rem] text-brass">
            {label}
          </span>
        </span>
      ))}
    </div>
  );
}
