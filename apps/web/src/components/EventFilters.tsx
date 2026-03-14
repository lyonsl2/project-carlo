import type { EventType } from "../types";
import { titleCase } from "../utils";

const ORDERED_TYPES: EventType[] = ["mass", "confession", "adoration"];

interface EventFiltersProps {
  selected: EventType[];
  onChange: (value: EventType[]) => void;
}

export function EventFilters({ selected, onChange }: EventFiltersProps) {
  return (
    <div className="filters">
      {ORDERED_TYPES.map((eventType) => {
        const isChecked = selected.includes(eventType);
        return (
          <label key={eventType} className={`filter-chip ${isChecked ? "active" : ""}`}>
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(event) => {
                if (event.target.checked) {
                  onChange([...selected, eventType]);
                } else {
                  onChange(selected.filter((value) => value !== eventType));
                }
              }}
            />
            <span>{titleCase(eventType)}</span>
          </label>
        );
      })}
    </div>
  );
}
