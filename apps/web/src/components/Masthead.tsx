import { cn } from "@/lib/utils";

interface MastheadProps {
  /** Optional tagline rendered beneath the wordmark. */
  tagline?: string;
  /** Compact variant hides the tagline, for tight header strips. */
  compact?: boolean;
  className?: string;
}

/** Site title block — wordmark and optional tagline. */
export function Masthead({
  tagline = "Mass, Confession & Adoration times near you",
  compact = false,
  className = "",
}: MastheadProps) {
  if (compact) {
    return (
      <div className={cn("flex items-baseline gap-4", className)}>
        <span className="font-display text-lg leading-none font-normal tracking-tight text-ink">
          Project <span className="italic text-rubric">Carlo</span>
        </span>
      </div>
    );
  }

  return (
    <header className={cn("space-y-2", className)}>
      <h1 className="font-display text-[2rem] leading-none font-normal tracking-tight text-ink sm:text-[2.5rem]">
        Project <span className="italic text-rubric">Carlo</span>
      </h1>
      <p className="smallcaps text-[0.875rem] text-ink-soft">{tagline}</p>
    </header>
  );
}
