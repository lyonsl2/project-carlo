import { formatMinutesMissal } from "../utils";

interface TimeRangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  /** Compact variant for narrow contexts: smaller digit row, no tick row, tighter gap. */
  compact?: boolean;
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
  compact = false,
}: TimeRangeSliderProps) {
  const [start, end] = value;
  const startPercent = getPercent(start, min, max);
  const endPercent = getPercent(end, min, max);
  const formatValue = (minutes: number) =>
    formatMinutesMissal(Math.min(minutes, max - 1));

  return (
    <div className={compact ? "space-y-3" : "space-y-5"}>
      <div
        className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-4 font-serif text-ink ${
          compact ? "text-[15px]" : "text-base"
        }`}
      >
        <span className="justify-self-start tabular-nums">{formatValue(start)}</span>
        <span className="smallcaps text-[0.8125rem] text-ink-faint">
          through
        </span>
        <span className="justify-self-end tabular-nums">{formatValue(end)}</span>
      </div>

      <div className="relative h-6 px-1">
        <div className="pointer-events-none absolute top-1/2 left-1 right-1 h-px -translate-y-1/2 bg-rule-strong" />
        <div
          className="pointer-events-none absolute top-1/2 h-[2px] -translate-y-1/2 bg-rubric"
          style={{
            left: `calc(${startPercent}% + 0.25rem)`,
            width: `calc(${Math.max(endPercent - startPercent, 0)}% - 0.5rem * ${
              (endPercent - startPercent) / 100
            })`,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={start}
          aria-label="Start time"
          className="time-range-slider absolute inset-0 h-6 w-full"
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
          className="time-range-slider absolute inset-0 h-6 w-full"
          onChange={(event) => {
            const nextEnd = Math.max(Number(event.target.value), start);
            onValueChange([start, nextEnd]);
          }}
        />
      </div>

      {compact ? null : (
        <div className="flex items-center justify-between font-serif text-[0.8125rem] tabular-nums text-ink-faint">
          <span>12a</span>
          <span>6a</span>
          <span>12p</span>
          <span>6p</span>
          <span>12a</span>
        </div>
      )}
    </div>
  );
}
