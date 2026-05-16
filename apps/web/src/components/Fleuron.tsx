import type { CSSProperties } from "react";
import { FleuronIcon } from "@/components/icons";

interface FleuronProps {
  /** When true, draws the ornament alone without the flanking hairlines. */
  solo?: boolean;
  /** Width in pixels for the ornament. Height is half (the SVG has a 48×24 viewBox).
   *  Default behavior (omit) keeps the 48×16 Tailwind sizing used elsewhere in the app. */
  size?: number;
  className?: string;
}

/** A centered fleuron ornament flanked by hairlines — used as a section
 *  divider throughout the app. Purely presentational. */
export function Fleuron({ solo = false, size, className = "" }: FleuronProps) {
  const sizedStyle: CSSProperties | undefined =
    size != null ? { width: size, height: size / 2 } : undefined;
  const iconClass = size != null ? "shrink-0" : "h-4 w-12 shrink-0";

  if (solo) {
    return (
      <div
        className={`flex items-center justify-center text-brass ${className}`}
        aria-hidden="true"
      >
        <FleuronIcon className={iconClass} style={sizedStyle} />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center gap-4 text-brass ${className}`}
      aria-hidden="true"
    >
      <span className="h-px flex-1 bg-rule-strong" />
      <FleuronIcon className={iconClass} style={sizedStyle} />
      <span className="h-px flex-1 bg-rule-strong" />
    </div>
  );
}
