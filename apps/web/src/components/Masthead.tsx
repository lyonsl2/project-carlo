import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface MastheadProps {
  /** Optional tagline rendered beneath the wordmark. */
  tagline?: string;
  /** Compact variant hides the tagline, for tight header strips. */
  compact?: boolean;
  className?: string;
}

/** Site title block — wordmark and optional tagline. The wordmark links
 *  back to the map at `/`. */
export function Masthead({
  tagline = "Mass, Confession & Adoration times near you",
  compact = false,
  className = "",
}: MastheadProps) {
  if (compact) {
    return (
      <div className={cn("flex items-baseline gap-4", className)}>
        <Link
          to="/"
          aria-label="Project Carlo — home"
          className="font-display text-lg leading-none font-normal tracking-tight text-ink"
        >
          Project <span className="italic text-rubric">Carlo</span>
        </Link>
      </div>
    );
  }

  return (
    <header className={cn("space-y-2", className)}>
      <h1 className="font-display text-[2rem] leading-none font-normal tracking-tight text-ink sm:text-[2.5rem]">
        <Link to="/" aria-label="Project Carlo — home">
          Project <span className="italic text-rubric">Carlo</span>
        </Link>
      </h1>
      <p className="smallcaps text-[0.875rem] text-ink-soft">{tagline}</p>
    </header>
  );
}
