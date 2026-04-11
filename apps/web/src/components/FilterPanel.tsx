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
      <div className="space-y-8 px-6 py-6">
        <section>
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="smallcaps text-[0.8rem] text-ink-faint">
              First pane · devotion
            </h3>
          </div>
          <div className="grid gap-3">
            {EVENT_TYPE_OPTIONS.map((option) => {
              const isSelected = filters.eventType === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectEventType(option.id)}
                  className={`came-frame relative overflow-hidden rounded-[1.35rem] border px-4 py-3 text-left transition-all ${
                    isSelected
                      ? "glass-panel-strong border-brass/30 text-paper shadow-[0_0_28px_rgb(25_84_194/0.18)]"
                      : "glass-panel border-brass/15 text-ink-soft hover:border-brass/25 hover:text-paper"
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className={`mt-1.5 inline-block size-2.5 shrink-0 rounded-full transition-colors ${
                        isSelected
                          ? "bg-brass shadow-[0_0_16px_rgb(241_210_136/0.55)]"
                          : "bg-transparent ring-1 ring-brass/35"
                      }`}
                    />
                    <span className="flex-1">
                      <span className="smallcaps block text-[0.72rem] text-ink-faint">
                        Window {option.id === "mass" ? "I" : option.id === "confession" ? "II" : "III"}
                      </span>
                      <span
                        className={`mt-1 block font-display text-[1.1rem] leading-tight ${
                          isSelected ? "text-paper halo-title" : "text-paper"
                        }`}
                      >
                        {option.label}
                      </span>
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-x-6 bottom-0 h-px transition-opacity ${
                      isSelected ? "bg-[linear-gradient(90deg,transparent,var(--brass),transparent)] opacity-100" : "opacity-0"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h3 className="smallcaps text-[0.8rem] text-ink-faint">
              Second pane · daylight
            </h3>
            <button
              type="button"
              onClick={selectAnyDay}
              aria-pressed={isAnyDaySelected}
              className={`smallcaps glass-chip rounded-full px-3 py-1.5 text-[0.75rem] transition-colors ${
                isAnyDaySelected
                  ? "text-brass"
                  : "text-ink-soft hover:text-brass"
              }`}
            >
              {isAnyDaySelected ? "All days open" : "Clear day filter"}
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {DAY_NAMES.map((day, dayIndex) => {
              const isSelected = filters.daysOfWeek.includes(dayIndex);
              return (
                <button
                  key={day.full}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={day.full}
                  onClick={() => selectDay(dayIndex)}
                  className={`rounded-2xl border px-2 py-3 text-center transition-all ${
                    isSelected
                      ? "glass-panel-strong border-brass/30 text-paper"
                      : "glass-panel border-brass/15 text-ink-soft hover:text-paper"
                  }`}
                >
                  <span
                    className={`smallcaps block text-[0.8rem] transition-colors ${
                      isSelected ? "text-brass" : "text-ink-soft"
                    }`}
                  >
                    {day.abbr}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 font-serif text-[0.9rem] italic text-ink-faint">
            {isAnyDaySelected
              ? "The whole week is illuminated until you choose a specific day."
              : "Choose one or more days, or clear the selection to reopen the full week."}
          </p>
        </section>

        <section>
          <div className="mb-4">
            <h3 className="smallcaps text-[0.8rem] text-ink-faint">
              Third pane · hour
            </h3>
          </div>
          <div className="glass-panel rounded-[1.5rem] p-4">
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
          </div>
        </section>

        <Fleuron />
      </div>

      <div className="flex items-center gap-4 border-t border-brass/15 bg-black/15 px-6 py-4 pb-[calc(1rem+var(--safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={handleClear}
          className="rubric-link smallcaps text-[0.8rem]"
        >
          Reset
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleApply}
          className="smallcaps rounded-full border border-brass/30 bg-[linear-gradient(135deg,var(--brass),color-mix(in_oklch,var(--ruby)_40%,var(--brass)_60%))] px-6 py-3 text-[0.8rem] text-nave-deep shadow-[0_12px_28px_-16px_rgb(241_210_136/0.65)] transition-transform hover:-translate-y-0.5"
        >
          Apply filters
        </button>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <section className="glass-panel-strong came-frame rise-in overflow-hidden rounded-[1.9rem]">
        <div className="border-b border-brass/15 px-6 pt-5 pb-4 text-left">
          <h2 className="font-display text-[1.35rem] font-normal tracking-[0.03em] text-paper">
            Tune the windows
          </h2>
          <p className="font-serif text-sm italic text-ink-faint">
            Refine by devotion, day, and hour.
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
        className="glass-panel-strong z-[1200] max-h-[88vh] gap-0 rounded-t-[2rem] border-x-0 border-brass/20 px-0 pb-0 text-paper"
        showCloseButton
      >
        <SheetHeader className="border-b border-brass/15 px-6 pt-4 pb-3 text-left">
          <SheetTitle className="font-display text-xl font-normal tracking-[0.03em] text-paper">
            Tune the windows
          </SheetTitle>
          <SheetDescription className="font-serif text-sm italic text-ink-faint">
            Refine by devotion, day, and hour.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">{panelBody}</ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
