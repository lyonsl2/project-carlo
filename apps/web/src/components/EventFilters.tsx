import type { EventType } from "../types";

const ORDERED_TYPES: EventType[] = ["mass", "confession", "adoration"];

interface EventFiltersProps {
  selected: EventType[];
  onChange: (value: EventType[]) => void;
}

function toLabel(value: EventType): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
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
            <span>{toLabel(eventType)}</span>
          </label>
        );
      })}
    </div>
  );
}
