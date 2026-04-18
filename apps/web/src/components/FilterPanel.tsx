import { useCallback } from "react";
import type { EventType } from "../types";
import {
  DEFAULT_FILTER_STATE,
  MINUTES_PER_DAY,
  type FilterState,
} from "./filterState";
import { FILTER_DAY_LABELS } from "../constants/days";
import { EVENT_TYPE_OPTIONS } from "../constants/eventTypes";
import { TimeRangeSlider } from "./TimeRangeSlider";
import { Fleuron } from "./Fleuron";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

const TIME_STEP_MINUTES = 15;

interface FilterPanelProps {
  isOpen: boolean;
  isDesktop: boolean;
  onClose: () => void;
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onApply: () => void;
}

export function FilterPanel({
  isOpen,
  isDesktop,
  onClose,
  filters,
  onChange,
  onApply,
}: FilterPanelProps) {
  const isAnyDaySelected = filters.daysOfWeek.length === 0;

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

  const handleTimeRangeChange = useCallback(
    ([timeFrom, timeTo]: [number, number]) => {
      onChange({
        ...filters,
        timeFrom,
        timeTo: timeTo >= MINUTES_PER_DAY ? MINUTES_PER_DAY - 1 : timeTo,
      });
    },
    [filters, onChange],
  );

  const handleClear = useCallback(() => {
    onChange({ ...DEFAULT_FILTER_STATE });
  }, [onChange]);

  const handleApply = useCallback(() => {
    onApply();
    if (!isDesktop) {
      onClose();
    }
  }, [isDesktop, onApply, onClose]);

  const panelBody = (
    <div className="flex flex-col">
      <div className="space-y-7 px-6 py-6">
        {/* Event type */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="smallcaps text-[0.875rem] text-ink-faint">
              Service type
            </h3>
          </div>
          <div className="flex divide-x divide-rule overflow-hidden rounded-md border border-rule-strong">
            {EVENT_TYPE_OPTIONS.map((option) => {
              const isSelected = filters.eventType === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectEventType(option.id)}
                  className={`group flex min-w-0 flex-1 basis-0 flex-col items-center gap-1.5 px-1 py-2.5 text-center transition-colors ${
                    isSelected ? "bg-paper-deep/80" : "hover:bg-paper-deep/40"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`inline-block size-2 shrink-0 rounded-full transition-colors ${
                      isSelected
                        ? "bg-rubric"
                        : "bg-transparent ring-1 ring-rule-strong"
                    }`}
                  />
                  <span
                    className={`font-display text-[0.95rem] leading-snug sm:text-[1.05rem] ${
                      isSelected ? "text-rubric" : "text-ink"
                    }`}
                  >
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Day of week — abbreviated row with underline-on-select */}
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="smallcaps text-[0.875rem] text-ink-faint">
              Day of week
            </h3>
            <button
              type="button"
              onClick={selectAnyDay}
              aria-pressed={isAnyDaySelected}
              className={`smallcaps text-[0.8125rem] transition-colors ${
                isAnyDaySelected
                  ? "text-rubric"
                  : "text-ink-soft hover:text-rubric-deep"
              }`}
            >
              {isAnyDaySelected ? "All days" : "Show every day"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-1">
            {FILTER_DAY_LABELS.map((day, dayIndex) => {
              const isSelected = filters.daysOfWeek.includes(dayIndex);
              return (
                <button
                  key={day.full}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={day.full}
                  onClick={() => selectDay(dayIndex)}
                  className="group relative flex-1 py-2 text-center"
                >
                  <span
                    className={`smallcaps block text-[0.875rem] transition-colors ${
                      isSelected
                        ? "text-rubric"
                        : "text-ink-soft group-hover:text-ink"
                    }`}
                  >
                    {day.abbr}
                  </span>
                  <span
                    className="absolute inset-x-2 bottom-0 h-[1.5px] origin-left bg-rubric transition-transform duration-300 ease-out"
                    style={{
                      transform: isSelected ? "scaleX(1)" : "scaleX(0)",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </section>

        {/* Time range */}
        <section>
          <div className="mb-3">
            <h3 className="smallcaps text-[0.875rem] text-ink-faint">
              Time of day
            </h3>
          </div>
          <TimeRangeSlider
            min={0}
            max={MINUTES_PER_DAY}
            step={TIME_STEP_MINUTES}
            value={[
              filters.timeFrom,
              filters.timeTo >= MINUTES_PER_DAY - 1
                ? MINUTES_PER_DAY
                : filters.timeTo,
            ]}
            onValueChange={handleTimeRangeChange}
          />
        </section>

        <Fleuron />
      </div>

      <div
        className={`flex items-center gap-4 border-t border-rule-strong bg-paper-deep/30 px-6 py-4 ${
          isDesktop ? "" : "pb-[calc(1rem+var(--safe-area-inset-bottom))]"
        }`}
      >
        <button
          type="button"
          onClick={handleClear}
          className="rubric-link smallcaps text-[0.875rem]"
        >
          Reset
        </button>
        {!isDesktop ? (
          <>
            <div className="flex-1" />
            <button
              type="button"
              onClick={handleApply}
              className="smallcaps bg-rubric px-6 py-3 text-[0.875rem] text-paper transition-colors hover:bg-rubric-deep"
            >
              Apply filters
            </button>
          </>
        ) : null}
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <section className="rise-in h-fit w-full overflow-hidden border border-rule-strong bg-paper/96 shadow-missal-panel backdrop-blur-sm">
        <ScrollArea className="max-h-[calc(100svh-12rem)]">
          {panelBody}
        </ScrollArea>
      </section>
    );
  }

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        className="z-[1200] max-h-[88vh] gap-0 border-x-0 border-rule-strong bg-paper px-0 pb-0"
        showCloseButton
      >
        <SheetTitle className="sr-only">Filters</SheetTitle>
        <ScrollArea className="flex-1">{panelBody}</ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
