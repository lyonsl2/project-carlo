import { EVENT_TYPE_ORDER } from "../constants/eventTypes";
import type { EventType } from "../types";
import { titleCase } from "../utils";

interface EventFiltersProps {
  selected: EventType[];
  onChange: (value: EventType[]) => void;
}

export function EventFilters({ selected, onChange }: EventFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {EVENT_TYPE_ORDER.map((eventType) => {
        const isChecked = selected.includes(eventType);
        return (
          <label
            key={eventType}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
              isChecked
                ? "border-primary bg-primary/10 text-primary"
                : "border-input bg-background"
            }`}
          >
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
