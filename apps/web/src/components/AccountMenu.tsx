import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { UserIcon } from "@/components/icons";
import { isAccountsEnabled } from "@/lib/supabaseEnv";
import { cn } from "@/lib/utils";

/** Header entry point for accounts: a sign-in link, or a way into the account
 *  page once signed in. Renders nothing at all when accounts are switched off,
 *  which is what keeps the public site unchanged until Supabase is configured. */
export function AccountMenu({ className }: { className?: string }) {
  const { status } = useAuth();
  const location = useLocation();

  if (!isAccountsEnabled()) return null;

  // Resolving the stored session takes a moment on a cold load. Hold the space
  // rather than flashing "Sign in" at someone who is already signed in.
  if (status === "loading") {
    return (
      <span
        className={cn("smallcaps text-[0.75rem] text-ink-faint", className)}
        aria-hidden
      >
        &nbsp;
      </span>
    );
  }

  if (status === "signedOut") {
    const next = `${location.pathname}${location.search}`;
    return (
      <Link
        to={`/signin?next=${encodeURIComponent(next)}`}
        className={cn("rubric-link smallcaps text-[0.75rem]", className)}
      >
        Sign in
      </Link>
    );
  }

  return (
    <Link
      to="/account"
      className={cn(
        "rubric-link smallcaps inline-flex items-center gap-1.5 text-[0.75rem]",
        className,
      )}
    >
      <UserIcon className="size-3" />
      Account
    </Link>
  );
}
