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
import { FeedbackTrigger } from "./FeedbackTrigger";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

const TIME_STEP_MINUTES = 15;

// Display order for the day strip: Sunday first. Values are indices into
// FILTER_DAY_LABELS, which is Monday-first (0=Mon..6=Sun) — keeping that
// underlying indexing avoids touching URL state or filter wire format.
const DAY_DISPLAY_ORDER: readonly number[] = [6, 0, 1, 2, 3, 4, 5];

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
  const isDaysDefault = filters.daysOfWeek.length === 0;
  const isTimeDefault =
    filters.timeFrom === DEFAULT_FILTER_STATE.timeFrom &&
    filters.timeTo === DEFAULT_FILTER_STATE.timeTo;
  const isEventTypeDefault =
    filters.eventType === DEFAULT_FILTER_STATE.eventType;
  const isAllDefault = isEventTypeDefault && isDaysDefault && isTimeDefault;

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

  const resetDays = useCallback(() => {
    onChange({ ...filters, daysOfWeek: [] });
  }, [filters, onChange]);

  const resetTime = useCallback(() => {
    onChange({
      ...filters,
      timeFrom: DEFAULT_FILTER_STATE.timeFrom,
      timeTo: DEFAULT_FILTER_STATE.timeTo,
    });
  }, [filters, onChange]);

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
        {/* Event type — Variant F chips */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="smallcaps text-[0.875rem] text-ink-faint">
              Service type
            </h3>
          </div>
          <div className="flex gap-2">
            {EVENT_TYPE_OPTIONS.map((option) => {
              const isSelected = filters.eventType === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectEventType(option.id)}
                  className={`min-w-0 flex-1 basis-0 border px-2 py-2.5 text-center font-display text-[0.95rem] transition-colors sm:text-[1.05rem] ${
                    isSelected
                      ? "border-rubric bg-rubric/5 text-rubric"
                      : "border-rule-strong bg-transparent text-ink-soft hover:bg-paper-deep/40 hover:text-ink"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Day of week — Variant F connected single-letter strip */}
        <section>
          <div className="mb-3 flex min-h-[1.125rem] items-baseline justify-between gap-3">
            <h3 className="smallcaps text-[0.875rem] text-ink-faint">
              Day of week
            </h3>
            <button
              type="button"
              onClick={resetDays}
              aria-hidden={isDaysDefault}
              tabIndex={isDaysDefault ? -1 : 0}
              className={`smallcaps text-[0.8125rem] text-ink-soft transition-colors hover:text-rubric ${
                isDaysDefault ? "invisible" : ""
              }`}
            >
              Reset
            </button>
          </div>
          <div className="grid grid-cols-7 border border-rule-strong">
            {DAY_DISPLAY_ORDER.map((dayIndex, position) => {
              const day = FILTER_DAY_LABELS[dayIndex];
              const isSelected = filters.daysOfWeek.includes(dayIndex);
              const isLast = position === DAY_DISPLAY_ORDER.length - 1;
              return (
                <button
                  key={day.full}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={day.full}
                  onClick={() => selectDay(dayIndex)}
                  className={`smallcaps py-2.5 text-center text-[0.8125rem] transition-colors ${
                    isLast ? "" : "border-r border-rule"
                  } ${
                    isSelected
                      ? "bg-rubric text-paper"
                      : "bg-transparent text-ink-soft hover:bg-paper-deep/50 hover:text-ink"
                  }`}
                >
                  {day.abbr}
                </button>
              );
            })}
          </div>
        </section>

        {/* Time range */}
        <section>
          <div className="mb-3 flex min-h-[1.125rem] items-baseline justify-between gap-3">
            <h3 className="smallcaps text-[0.875rem] text-ink-faint">
              Time of day
            </h3>
            <button
              type="button"
              onClick={resetTime}
              aria-hidden={isTimeDefault}
              tabIndex={isTimeDefault ? -1 : 0}
              className={`smallcaps text-[0.8125rem] text-ink-soft transition-colors hover:text-rubric ${
                isTimeDefault ? "invisible" : ""
              }`}
            >
              Reset
            </button>
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
      </div>

      <div
        className={`flex items-center gap-4 bg-paper-deep/30 px-6 py-4 ${
          isDesktop ? "" : "pb-[calc(1rem+var(--safe-area-inset-bottom))]"
        }`}
      >
        {!isAllDefault ? (
          <button
            type="button"
            onClick={handleClear}
            className="rubric-link smallcaps text-[0.875rem] text-rubric hover:text-rubric-deep"
          >
            Reset all
          </button>
        ) : null}
        <div className="flex-1" />
        <FeedbackTrigger
          label="Share feedback"
          className="text-[0.875rem] text-rubric hover:text-rubric-deep"
        />
        {!isDesktop ? (
          <>
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
