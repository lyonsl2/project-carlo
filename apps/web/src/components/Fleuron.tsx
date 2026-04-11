import { FleuronIcon, RoseWindowIcon } from "@/components/icons";

interface FleuronProps {
  /** When true, draws the ornament alone without the flanking hairlines. */
  solo?: boolean;
  className?: string;
}

/** A centered fleuron ornament flanked by hairlines — used as a section
 *  divider throughout the app. Purely presentational. */
export function Fleuron({ solo = false, className = "" }: FleuronProps) {
  if (solo) {
    return (
      <div
        className={`flex items-center justify-center text-brass ${className}`}
        aria-hidden="true"
      >
        <div className="glass-chip inline-flex items-center justify-center rounded-full px-4 py-2 shadow-[0_0_20px_rgb(18_75_160/0.12)]">
          <RoseWindowIcon className="h-5 w-5" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center gap-4 text-brass ${className}`}
      aria-hidden="true"
    >
      <span className="window-divider flex-1" />
      <div className="glass-chip inline-flex items-center justify-center rounded-full px-4 py-2">
        <FleuronIcon className="h-4 w-16 shrink-0" />
      </div>
      <span className="window-divider flex-1" />
    </div>
  );
}
