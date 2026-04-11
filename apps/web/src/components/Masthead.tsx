import { formatMastheadDate } from "../utils";
import { RoseWindowIcon } from "./icons";

interface MastheadProps {
  /** Optional tagline rendered beneath the wordmark. */
  tagline?: string;
  /** Compact variant hides the rule + tagline, for tight header strips. */
  compact?: boolean;
  className?: string;
}

/** The "newspaper of record" masthead — wordmark on the left, issue date on
 *  the right, flanked by hairlines. Sets the missal / bulletin tone from the
 *  first pixel the user sees. */
export function Masthead({
  tagline = "Luminous parish hours for Mass, Confession and Adoration",
  compact = false,
  className = "",
}: MastheadProps) {
  const issueDate = formatMastheadDate();

  if (compact) {
    return (
      <div
        className={`flex items-center justify-between gap-4 ${className}`}
      >
        <span className="inline-flex items-center gap-2 text-brass">
          <RoseWindowIcon className="h-5 w-5 shrink-0" />
          <span className="font-display text-base leading-none font-normal tracking-[0.04em] text-paper">
            Project Carlo
          </span>
        </span>
        <span className="smallcaps text-[0.78rem] text-ink-faint">
          {issueDate}
        </span>
      </div>
    );
  }

  return (
    <header className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between gap-4 text-ink-faint">
        <div className="smallcaps text-[0.78rem]">Rose window edition</div>
        <div className="smallcaps text-[0.78rem] text-ink-soft">
          {issueDate}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="glass-chip inline-flex h-12 w-12 items-center justify-center rounded-full text-brass shadow-[0_0_24px_rgb(29_87_196/0.18)]">
          <RoseWindowIcon className="h-6 w-6" />
        </div>
        <div className="space-y-1">
          <h1 className="halo-title font-display text-[1.75rem] leading-none font-normal tracking-[0.03em] text-paper sm:text-[2.3rem]">
            Project Carlo
          </h1>
          <p className="smallcaps text-[0.8rem] text-brass">{tagline}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="window-divider flex-1" />
        <p className="smallcaps text-[0.76rem] text-ink-soft">
          Search the diocese by light and hour
        </p>
        <span className="window-divider flex-1" />
      </div>
    </header>
  );
}
