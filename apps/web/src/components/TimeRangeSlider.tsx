import { formatMinutesToTime } from "../utils";

interface TimeRangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
}

function getPercent(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return ((value - min) / (max - min)) * 100;
}

export function TimeRangeSlider({
  min,
  max,
  step = 1,
  value,
  onValueChange,
}: TimeRangeSliderProps) {
  const [start, end] = value;
  const startPercent = getPercent(start, min, max);
  const endPercent = getPercent(end, min, max);
  const formatValue = (minutes: number) =>
    formatMinutesToTime(Math.min(minutes, max - 1));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border bg-muted/30 px-4 py-3">
          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            Start
          </p>
          <p className="mt-1 text-sm font-medium">{formatValue(start)}</p>
        </div>
        <div className="rounded-2xl border bg-muted/30 px-4 py-3">
          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
            End
          </p>
          <p className="mt-1 text-sm font-medium">{formatValue(end)}</p>
        </div>
      </div>

      <div className="relative h-8">
        <div className="pointer-events-none absolute top-1/2 h-2 w-full -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary"
          style={{
            left: `${startPercent}%`,
            width: `${Math.max(endPercent - startPercent, 0)}%`,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={start}
          aria-label="Start time"
          className="time-range-slider absolute inset-0 h-8 w-full"
          onChange={(event) => {
            const nextStart = Math.min(Number(event.target.value), end);
            onValueChange([nextStart, end]);
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={end}
          aria-label="End time"
          className="time-range-slider absolute inset-0 h-8 w-full"
          onChange={(event) => {
            const nextEnd = Math.max(Number(event.target.value), start);
            onValueChange([start, nextEnd]);
          }}
        />
      </div>
    </div>
  );
}
