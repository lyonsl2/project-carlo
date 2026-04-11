import { FleuronIcon } from "@/components/icons";

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
        <FleuronIcon className="h-4 w-12" />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center gap-4 text-brass ${className}`}
      aria-hidden="true"
    >
      <span className="h-px flex-1 bg-rule-strong" />
      <FleuronIcon className="h-4 w-12 shrink-0" />
      <span className="h-px flex-1 bg-rule-strong" />
    </div>
  );
}
