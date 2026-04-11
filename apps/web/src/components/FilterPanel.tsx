import { useCallback, useEffect, useState } from "react";
import type { EventType } from "../types";
import { titleCase } from "../utils";
import type { FilterState } from "./filterState";
import { TimeRangeSlider } from "./TimeRangeSlider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

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
        timeTo:
          timeTo >= MINUTES_PER_DAY ? MINUTES_PER_DAY - 1 : timeTo,
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

  const handleApply = useCallback(() => {
    onApply();
    onClose();
  }, [onApply, onClose]);

  const isDesktop = useIsDesktop();

  const panelBody = (
    <>
      <div className="space-y-5 px-5 py-4">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Event type
          </h3>
          <div className="flex flex-wrap gap-2">
            {EVENT_TYPES.map((type) => {
              const isSelected = filters.eventType === type;
              return (
                <Button
                  key={type}
                  type="button"
                  variant={isSelected ? "default" : "outline"}
                  className="h-11 rounded-full px-5 text-sm"
                  aria-pressed={isSelected}
                  onClick={() => selectEventType(type)}
                >
                  {titleCase(type)}
                </Button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Day of week
          </h3>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={filters.daysOfWeek.length === 0 ? "default" : "outline"}
              className="h-11 rounded-full px-5 text-sm"
              aria-pressed={filters.daysOfWeek.length === 0}
              onClick={selectAnyDay}
            >
              Any day
            </Button>
            {DAY_NAMES.map((name, dayIndex) => {
              const isSelected = filters.daysOfWeek.includes(dayIndex);
              return (
                <Button
                  key={dayIndex}
                  type="button"
                  variant={isSelected ? "default" : "outline"}
                  className="h-11 rounded-full px-5 text-sm"
                  aria-pressed={isSelected}
                  onClick={() => selectDay(dayIndex)}
                >
                  {name}
                </Button>
              );
            })}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Time range
          </h3>
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
      <div className="border-t px-5 pt-3 pb-[calc(0.75rem+var(--safe-area-inset-bottom))]">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-12 px-4 text-sm"
            onClick={handleClear}
          >
            Clear all
          </Button>
          <Button
            type="button"
            className="h-12 flex-1 text-base"
            onClick={handleApply}
          >
            Apply filters
          </Button>
        </div>
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          className="z-[1200] max-w-[420px] gap-0 overflow-hidden p-0"
          showCloseButton
        >
          <DialogHeader className="border-b px-5 py-3 text-left">
            <DialogTitle className="text-base">Filters</DialogTitle>
            <DialogDescription className="sr-only">
              Filter churches by event type, day of week, and time.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">{panelBody}</ScrollArea>
        </DialogContent>
      </Dialog>
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
        className="z-[1200] max-h-[85vh] gap-0 rounded-t-[1.75rem] border-x-0 px-0 pb-0"
        showCloseButton
      >
        <SheetHeader className="border-b px-5 py-3 text-left">
          <SheetTitle className="text-base">Filters</SheetTitle>
          <SheetDescription className="sr-only">
            Filter churches by event type, day of week, and time.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">{panelBody}</ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
