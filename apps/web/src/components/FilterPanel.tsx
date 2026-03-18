import { useCallback } from "react";
import type { EventType } from "../types";
import { titleCase } from "../utils";

export interface FilterState {
  eventType: EventType; // single selection: mass, adoration, or confession
  daysOfWeek: number[]; // 0=Mon, 6=Sun
  timeFrom: number; // minutes since midnight
  timeTo: number; // minutes since midnight
}

const EVENT_TYPES: EventType[] = ["mass", "adoration", "confession"];
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

function minutesToTimeValue(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function timeValueToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function getTimeRange(filters: FilterState): {
  from?: number;
  to?: number;
} {
  // If full range selected, no filter
  if (filters.timeFrom <= 0 && filters.timeTo >= MINUTES_PER_DAY - 1) {
    return {};
  }
  return { from: filters.timeFrom, to: filters.timeTo };
}

interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onApply: () => void;
}

export function FilterPanel({
  isOpen,
  onClose,
  filters,
  onChange,
  onApply,
}: FilterPanelProps) {
  const selectAnyDay = useCallback(() => {
    onChange({ ...filters, daysOfWeek: [] });
  }, [filters, onChange]);

  const selectDay = useCallback(
    (dayIndex: number) => {
      const current = filters.daysOfWeek;
      if (current.length === 0) {
        onChange({ ...filters, daysOfWeek: [dayIndex] });
        return;
      }
      const isSelected = current.includes(dayIndex);
      const next = isSelected
        ? current.filter((d) => d !== dayIndex)
        : [...current, dayIndex].sort((a, b) => a - b);
      onChange({ ...filters, daysOfWeek: next.length > 0 ? next : [] });
    },
    [filters, onChange],
  );

  const selectEventType = useCallback(
    (type: EventType) => {
      onChange({ ...filters, eventType: type });
    },
    [filters, onChange],
  );

  const handleTimeFromChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const minutes = timeValueToMinutes(e.target.value);
      const newFrom = Math.min(minutes, filters.timeTo);
      onChange({ ...filters, timeFrom: newFrom });
    },
    [filters, onChange],
  );

  const handleTimeToChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const minutes = timeValueToMinutes(e.target.value);
      const newTo = Math.max(minutes, filters.timeFrom);
      onChange({ ...filters, timeTo: newTo });
    },
    [filters, onChange],
  );

  const handleClear = useCallback(() => {
    onChange({
      eventType: "mass",
      daysOfWeek: [],
      timeFrom: 0,
      timeTo: MINUTES_PER_DAY - 1,
    });
  }, [onChange]);

  const handleApply = useCallback(() => {
    onApply();
    onClose();
  }, [onApply, onClose]);

  return (
    <>
      <div
        className={`filter-overlay ${isOpen ? "filter-overlay--open" : ""}`}
        onClick={onClose}
        aria-hidden={!isOpen}
      />
      <div
        className={`filter-panel ${isOpen ? "filter-panel--open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Refine search"
      >
        <div className="filter-panel__header">
          <h2 className="filter-panel__title">Find Mass</h2>
          <button
            type="button"
            className="filter-panel__close"
            onClick={onClose}
            aria-label="Close filter panel"
          >
            <span aria-hidden>×</span>
          </button>
        </div>

        <div className="filter-panel__body">
          <section className="filter-section">
            <h3 className="filter-section__label">EVENT TYPE</h3>
            <div className="filter-section__options filter-section__options--event-type">
              {EVENT_TYPES.map((type) => {
                const isSelected = filters.eventType === type;
                const icon =
                  type === "mass" ? "▲" : type === "adoration" ? "✶" : "🔒";
                return (
                  <button
                    key={type}
                    type="button"
                    className={`filter-option filter-option--event ${
                      isSelected ? "filter-option--selected" : ""
                    }`}
                    onClick={() => selectEventType(type)}
                  >
                    <span className="filter-option__icon">{icon}</span>
                    {titleCase(type)}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="filter-section">
            <h3 className="filter-section__label">DAY OF WEEK</h3>
            <div className="filter-section__options filter-section__options--days">
              <button
                type="button"
                className={`filter-option filter-option--day ${
                  filters.daysOfWeek.length === 0 ? "filter-option--selected" : ""
                }`}
                onClick={selectAnyDay}
              >
                Any day
              </button>
              {DAY_NAMES.map((name, dayIndex) => {
                const isSelected = filters.daysOfWeek.includes(dayIndex);
                return (
                  <button
                    key={dayIndex}
                    type="button"
                    className={`filter-option filter-option--day ${
                      isSelected ? "filter-option--selected" : ""
                    }`}
                    onClick={() => selectDay(dayIndex)}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="filter-section">
            <h3 className="filter-section__label">TIME RANGE</h3>
            <div className="time-pickers">
              <div className="time-picker">
                <label htmlFor="time-from" className="time-picker__label">
                  Start time
                </label>
                <input
                  id="time-from"
                  type="time"
                  value={minutesToTimeValue(filters.timeFrom)}
                  onChange={handleTimeFromChange}
                  className="time-picker__input"
                  aria-label="Start time"
                />
              </div>
              <div className="time-picker">
                <label htmlFor="time-to" className="time-picker__label">
                  End time
                </label>
                <input
                  id="time-to"
                  type="time"
                  value={minutesToTimeValue(filters.timeTo)}
                  onChange={handleTimeToChange}
                  className="time-picker__input"
                  aria-label="End time"
                />
              </div>
            </div>
          </section>
        </div>

        <div className="filter-panel__footer">
          <button
            type="button"
            className="filter-panel__apply"
            onClick={handleApply}
          >
            Apply Filters
          </button>
          <button
            type="button"
            className="filter-panel__clear"
            onClick={handleClear}
          >
            Clear All
          </button>
        </div>
      </div>
    </>
  );
}
