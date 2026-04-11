import { formatMinutesMissal } from "../utils";

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
    formatMinutesMissal(Math.min(minutes, max - 1));

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between gap-4 font-serif text-base text-paper">
        <span className="tabular-nums">{formatValue(start)}</span>
        <span className="smallcaps text-[0.76rem] text-ink-faint">
          through
        </span>
        <span className="tabular-nums">{formatValue(end)}</span>
      </div>

      <div className="relative h-8 px-1">
        <div className="pointer-events-none absolute top-1/2 left-1 right-1 h-2 -translate-y-1/2 rounded-full border border-brass/15 bg-nave-blue/70 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]" />
        <div
          className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded-full border border-brass/30 bg-[linear-gradient(90deg,var(--ruby),var(--amethyst),var(--sapphire))] shadow-[0_0_18px_rgb(38_105_214/0.28)]"
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

      <div className="flex items-center justify-between font-serif text-[0.82rem] italic text-ink-faint">
        <span>midnight</span>
        <span>dawn</span>
        <span>noon</span>
        <span>dusk</span>
        <span>midnight</span>
      </div>
    </div>
  );
}
