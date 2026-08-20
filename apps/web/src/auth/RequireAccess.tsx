import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { accountKeys } from "@/api/accountKeys";
import { fetchEntitlements } from "@/api/account";
import { InlineQueryError } from "@/components/InlineQueryError";
import { useAuth } from "./AuthContext";

function FullPageMessage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-paper px-4">
      {children}
    </main>
  );
}

/** Gate for everything behind the paywall.
 *
 *  This is a routing convenience, not a security control. Per-user rows are
 *  protected by row level security, and the parish snapshot the map reads is a
 *  static file on the CDN — see docs/auth-and-payments-setup.md for what that
 *  means and how to close it.
 *
 *  Default export so the router can load it lazily, which keeps the Supabase
 *  client out of the entry bundle.
 */
export default function RequireAccess({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  const here = `${location.pathname}${location.search}`;

  const entitlements = useQuery({
    queryKey: accountKeys.entitlements(),
    queryFn: fetchEntitlements,
    enabled: status === "signedIn",
  });

  if (status === "loading") {
    return (
      <FullPageMessage>
        <p className="font-serif text-sm text-ink-soft">Loading…</p>
      </FullPageMessage>
    );
  }

  // Somebody who has never signed in gets the pitch before the sign-in form.
  if (status === "signedOut") {
    return <Navigate to={`/landing?next=${encodeURIComponent(here)}`} replace />;
  }

  if (entitlements.isPending) {
    return (
      <FullPageMessage>
        <p className="font-serif text-sm text-ink-soft">Checking your account…</p>
      </FullPageMessage>
    );
  }

  if (entitlements.error) {
    return (
      <FullPageMessage>
        <InlineQueryError
          title="Couldn't check your account"
          message="Check your connection and try again."
          onRetry={() => void entitlements.refetch()}
          centered
        />
      </FullPageMessage>
    );
  }

  // Signed in but out of trial and not subscribed: the account page is where
  // the explanation and the subscribe buttons live.
  if (!entitlements.data?.hasAccess) {
    return <Navigate to="/account" replace />;
  }

  return <>{children}</>;
}
