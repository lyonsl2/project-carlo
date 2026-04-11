import { useCallback, useEffect, useState } from "react";
import type { EventType } from "../types";
import type { FilterState } from "./filterState";
import { TimeRangeSlider } from "./TimeRangeSlider";
import { Fleuron } from "./Fleuron";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

interface EventTypeOption {
  id: EventType;
  label: string;
}

const EVENT_TYPE_OPTIONS: EventTypeOption[] = [
  {
    id: "mass",
    label: "Mass",
  },
  {
    id: "confession",
    label: "Confession",
  },
  {
    id: "adoration",
    label: "Adoration",
  },
];

const DAY_NAMES = [
  { full: "Monday", abbr: "Mon" },
  { full: "Tuesday", abbr: "Tue" },
  { full: "Wednesday", abbr: "Wed" },
  { full: "Thursday", abbr: "Thu" },
  { full: "Friday", abbr: "Fri" },
  { full: "Saturday", abbr: "Sat" },
  { full: "Sunday", abbr: "Sun" },
];

const MINUTES_PER_DAY = 24 * 60;
const TIME_STEP_MINUTES = 15;

interface FilterPanelProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  onApply: () => void;
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

export function FilterPanel({
  isOpen,
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
    onChange({
      eventType: "mass",
      daysOfWeek: [],
      timeFrom: 0,
      timeTo: MINUTES_PER_DAY - 1,
    });
  }, [onChange]);

  const isDesktop = useIsDesktop();

  const handleApply = useCallback(() => {
    onApply();
    if (!isDesktop) {
      onClose();
    }
  }, [isDesktop, onApply, onClose]);

  const panelBody = (
    <div className="flex flex-col">
      <div className="space-y-7 px-6 py-6">
        {/* Event type — typeset as a numbered service list */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="smallcaps text-[0.875rem] text-ink-faint">
              I. &nbsp; The service
            </h3>
          </div>
          <div className="divide-y divide-rule">
            {EVENT_TYPE_OPTIONS.map((option) => {
              const isSelected = filters.eventType === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectEventType(option.id)}
                  className="group flex w-full items-baseline gap-3 py-3 text-left transition-colors hover:bg-paper-deep/40"
                >
                  <span
                    aria-hidden
                    className={`mt-1 inline-block size-2 shrink-0 rounded-full transition-colors ${
                      isSelected ? "bg-rubric" : "bg-transparent ring-1 ring-rule-strong"
                    }`}
                  />
                  <span className="flex-1">
                    <span
                      className={`font-display text-[1.25rem] leading-tight ${
                        isSelected ? "text-rubric" : "text-ink"
                      }`}
                    >
                      {option.label}
                    </span>
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
              II. &nbsp; The day
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
              {isAnyDaySelected ? "Any day selected" : "Show every day"}
            </button>
          </div>
          <div className="flex items-center justify-between gap-1">
            {DAY_NAMES.map((day, dayIndex) => {
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
                      isSelected ? "text-rubric" : "text-ink-soft group-hover:text-ink"
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
          <p className="mt-2 font-serif text-[0.875rem] italic text-ink-faint">
            {isAnyDaySelected
              ? "Showing results from the whole week until you choose a day."
              : "Choose one or more days, or use 'Show every day' to clear the day filter."}
          </p>
        </section>

        {/* Time range */}
        <section>
          <div className="mb-3">
            <h3 className="smallcaps text-[0.875rem] text-ink-faint">
              III. &nbsp; The hour
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

      <div className="flex items-center gap-4 border-t border-rule-strong bg-paper-deep/30 px-6 py-4 pb-[calc(1rem+var(--safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={handleClear}
          className="rubric-link smallcaps text-[0.875rem]"
        >
          Reset
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleApply}
          className="smallcaps bg-rubric px-6 py-3 text-[0.875rem] text-paper transition-colors hover:bg-rubric-deep"
        >
          Apply filters
        </button>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <section className="rise-in overflow-hidden border border-rule-strong bg-paper/96 shadow-[0_20px_40px_-20px_rgb(22_18_16/0.35),0_3px_8px_-3px_rgb(22_18_16/0.14)] backdrop-blur-sm">
        <div className="border-b border-rule-strong px-6 pt-5 pb-4 text-left">
          <h2 className="font-display text-2xl font-normal tracking-tight text-ink">
              Narrow the search
          </h2>
          <p className="font-serif text-sm italic text-ink-faint">
            Refine by service, day, and hour.
          </p>
        </div>
        <ScrollArea className="max-h-[calc(100svh-14rem)]">
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
        <SheetHeader className="border-b border-rule-strong px-6 pt-4 pb-3 text-left">
          <SheetTitle className="font-display text-xl font-normal tracking-tight text-ink">
            Narrow the search
          </SheetTitle>
          <SheetDescription className="font-serif text-sm italic text-ink-faint">
            Refine by service, day, and hour.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">{panelBody}</ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
