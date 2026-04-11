import { formatMastheadDate } from "../utils";

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
  tagline = "A bulletin of Mass, Confession & Adoration",
  compact = false,
  className = "",
}: MastheadProps) {
  const issueDate = formatMastheadDate();

  if (compact) {
    return (
      <div
        className={`flex items-baseline justify-between gap-4 ${className}`}
      >
        <span className="font-display text-lg leading-none font-normal tracking-tight text-ink">
          Project <span className="italic text-rubric">Carlo</span>
        </span>
        <span className="smallcaps text-[0.8125rem] text-ink-faint">
          {issueDate}
        </span>
      </div>
    );
  }

  return (
    <header className={`space-y-2 ${className}`}>
      <div className="flex items-end justify-between gap-4">
        <div className="smallcaps text-[0.8125rem] text-ink-faint">
          Vol. I &nbsp;·&nbsp; No. 1
        </div>
        <div className="smallcaps text-[0.8125rem] text-ink-faint">
          {issueDate}
        </div>
      </div>
      <h1 className="font-display text-[2rem] leading-none font-normal tracking-tight text-ink sm:text-[2.5rem]">
        Project <span className="italic text-rubric">Carlo</span>
      </h1>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-rule-strong" />
        <p className="smallcaps text-[0.875rem] text-ink-soft">{tagline}</p>
        <span className="h-px flex-1 bg-rule-strong" />
      </div>
    </header>
  );
}
